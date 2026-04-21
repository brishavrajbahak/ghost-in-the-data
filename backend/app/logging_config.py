import contextvars
import json
import logging
import os


REQUEST_ID_CTX: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)


class _RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003
        rid = REQUEST_ID_CTX.get() or "-"
        setattr(record, "request_id", rid)
        return True


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, datefmt="%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "rid": getattr(record, "request_id", "-"),
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def setup_logging() -> None:
    """
    Minimal structured-ish logging for Docker/dev.
    Keeps secrets out of logs; avoids overly chatty libraries.
    """
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    fmt = (os.getenv("LOG_FORMAT", "text") or "text").strip().lower()

    root = logging.getLogger()
    root.setLevel(level)
    for h in list(root.handlers):
        root.removeHandler(h)

    handler = logging.StreamHandler()
    handler.addFilter(_RequestIdFilter())
    if fmt == "json":
        handler.setFormatter(_JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s rid=%(request_id)s: %(message)s"))
    root.addHandler(handler)

    for noisy in ("httpx", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(level)
