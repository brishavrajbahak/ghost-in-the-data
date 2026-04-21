import sys
import os
from pathlib import Path

# Disable rate limiting in tests (avoids slowapi decorators interfering with local test clients).
os.environ.setdefault("RATE_LIMIT_ENABLED", "0")

# Ensure the backend root (which contains the `app/` namespace package) is importable,
# even when pytest changes import modes or working directories.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
