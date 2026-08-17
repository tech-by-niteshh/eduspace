"""
Vercel serverless entrypoint.

vercel.json builds this file with @vercel/python and routes every request
— "/", "/learning.html", "/assets/*", "/api/*", all of it — to the
resulting function (see vercel.json's "routes": [{"src": "/(.*)", "dest":
"api/index.py"}]). Vercel forwards each request to this module's ``app``
AS-IS, full original path included, and lets it do its own internal
routing — so no rewrite, no path stripping, and no second FastAPI()
instance are needed here. This file exists only to import the one real
application object.

backend/server.py's routers already define their real, final paths
("/api/quiz/start", "/api/login", ...), and it also has its own handlers
for the static frontend paths ("/", "/learning.html", "/assets/*", ...) —
see that file's docstring for both. This is a direct, unmodified
passthrough to it either way.

vercel.json's "builds.config.includeFiles" is what makes the static paths
actually work here, not just locally: index.html, the other pages, and
assets/ are read from disk at request time rather than Python-imported, so
without naming them there explicitly the build wouldn't know to bundle
them into this function.
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