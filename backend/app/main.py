from contextlib import asynccontextmanager

import anyio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.types import ASGIApp
from sqlalchemy import text
from app.routers import upload, analysis, narrative, chat, context, sessions
from app.db import engine
from app.logging_config import REQUEST_ID_CTX, setup_logging
from app.rate_limit import limiter
import logging
import os
import uuid

setup_logging()
logger = logging.getLogger("ghost.api")


def _migrate_db_sync(*, stamp_baseline: bool) -> None:
    # Run migrations on startup (preferred) and fall back gracefully if DB is unavailable.
    if engine is None:
        logger.info("DATABASE_URL not set; running without persistence.")
        return
    from alembic import command
    from alembic.config import Config

    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    # alembic expects cwd-relative script_location; point it to backend/alembic
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
    cfg.set_main_option("sqlalchemy.url", os.getenv("DATABASE_URL", ""))

    if stamp_baseline:
        # If the DB was created before Alembic existed, tables may already exist but alembic_version doesn't.
        # Stamp the baseline revision (0001) first, then upgrade to head (0002+).
        logger.warning("DB pre-initialized (no alembic_version); stamping baseline before upgrade.")
        command.stamp(cfg, "0001_init")
    try:
        command.upgrade(cfg, "head")
        logger.info("Database migrated to head.")
    except Exception as e:
        # If this DB was created before Alembic existed (tables already present),
        # stamp the baseline revision then apply remaining migrations.
        msg = str(e).lower()
        if "already exists" in msg or "duplicate" in msg:
            logger.warning("DB appears pre-initialized; stamping baseline and retrying migrations.")
            command.stamp(cfg, "0001_init")
            command.upgrade(cfg, "head")
            logger.info("Database migrated to head after stamping.")
        else:
            raise


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        stamp_baseline = False
        if engine is not None:
            async with engine.connect() as conn:
                has_version = (await conn.execute(text("select to_regclass('public.alembic_version')"))).scalar_one()
                has_sessions = (await conn.execute(text("select to_regclass('public.analysis_sessions')"))).scalar_one()
        stamp_baseline = bool(has_sessions) and not bool(has_version)
        await anyio.to_thread.run_sync(lambda: _migrate_db_sync(stamp_baseline=stamp_baseline))
    except Exception:
        # If DB is misconfigured/unavailable, keep the app running (graceful degradation).
        logger.exception("Database init failed; running without persistence.")
    yield


app = FastAPI(
    title="Ghost in the Data",
    description="Anomaly detection and storytelling engine",
    lifespan=lifespan,
)


class RequestIdMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = rid
        token = REQUEST_ID_CTX.set(rid)
        try:
            response = await call_next(request)
        finally:
            REQUEST_ID_CTX.reset(token)
        response.headers["X-Request-ID"] = rid
        return response


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, *, max_bytes: int):
        super().__init__(app)
        self.max_bytes = int(max_bytes)

    async def dispatch(self, request: Request, call_next):
        # Prefer Content-Length when available (cheap).
        clen = request.headers.get("content-length")
        if clen is not None:
            try:
                if int(clen) > self.max_bytes:
                    return JSONResponse({"detail": "Request body too large."}, status_code=413)
            except Exception:
                pass

        # Fallback: read body once; Starlette caches it for downstream.
        body = await request.body()
        if len(body) > self.max_bytes:
            return JSONResponse({"detail": "Request body too large."}, status_code=413)
        return await call_next(request)


# Add CORS middleware
allowed = [o.strip() for o in (os.getenv("ALLOWED_ORIGINS", "http://localhost:5173") or "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(RequestIdMiddleware)
app.add_middleware(BodySizeLimitMiddleware, max_bytes=int(os.getenv("MAX_BODY_BYTES", str(10 * 1024 * 1024))))

# Rate limiting
try:
    from slowapi.errors import RateLimitExceeded
    from slowapi.middleware import SlowAPIMiddleware

    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)

    @app.exception_handler(RateLimitExceeded)
    async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
        return JSONResponse({"detail": "The Ghost is resting. Try again shortly."}, status_code=429)
except Exception:
    logger.warning("Rate limiting unavailable (slowapi not installed).")

app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(analysis.router, prefix="/api", tags=["analysis"])
app.include_router(narrative.router, prefix="/api", tags=["narrative"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(context.router, prefix="/api", tags=["context"])
app.include_router(sessions.router, prefix="/api", tags=["sessions"])

@app.get("/")
def read_root():
    return {"status": "Ghost in the Data API is active"}


@app.get("/health")
async def health():
    ok = True
    db_ok = None
    if engine is not None:
        try:
            async with engine.connect() as conn:
                await conn.execute(text("select 1"))
            db_ok = True
        except Exception:
            db_ok = False
            ok = False
    return {"status": "ok" if ok else "degraded", "db": db_ok}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
