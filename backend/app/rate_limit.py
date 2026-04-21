import os

from slowapi import Limiter
from slowapi.util import get_remote_address


def _is_enabled() -> bool:
    v = (os.getenv("RATE_LIMIT_ENABLED", "1") or "").strip().lower()
    return v not in {"0", "false", "off", "no"}


limiter = Limiter(key_func=get_remote_address, enabled=_is_enabled(), default_limits=["60/minute"])

