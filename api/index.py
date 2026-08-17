"""
Vercel serverless entrypoint.

Vercel's Python runtime detects files under api/ that export a module-level
ASGI-compatible ``app`` and treats the whole file as a Serverless Function.
For an ASGI application specifically (as opposed to one function per file),
Vercel forwards every request under this function's mount point AS-IS and
lets the application do its own internal routing — so no rewrite, no path
stripping, and no second FastAPI() instance are needed here. This file
exists only to import the one real application object.

backend/server.py's routers already define their real, final paths
("/api/quiz/start", "/api/login", ...) — see that file's docstring — so
this is a direct, unmodified passthrough.
"""

import sys
from pathlib import Path

# Vercel's working directory for a serverless function is not guaranteed to
# be the repository root, so make it importable explicitly rather than
# relying on cwd (see backend/server.py's docstring for the same principle;
# this is the one place in the project where that isn't already guaranteed
# by normal package imports, since it's the actual process entrypoint).
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
from backend.server import app

__all__ = ["app"]
