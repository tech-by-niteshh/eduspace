"""
Vercel serverless entrypoint.

Vercel's Python runtime looks for a module-level ASGI-compatible ``app`` in
this file — see vercel.json, which rewrites every "/api/<rest>" request to
this function while leaving the browser-visible URL unchanged.

backend/server.py's routes are deliberately defined WITHOUT an "/api"
prefix (e.g. "/quiz/start", "/login") so the exact same route definitions
serve local development unchanged:

    uvicorn backend.server:app --reload   ->  http://127.0.0.1:8000/quiz/start

On Vercel, a request arrives here as "/api/quiz/start". The StripApiPrefix
wrapper below rewrites the ASGI scope's path to "/quiz/start" *before*
FastAPI's router ever sees it, so backend/server.py stays completely
unaware of where it is mounted — no duplicated routes, no "/api" baked into
every path operation, no risk of an "/api/api/..." mismatch.
"""

import sys
from pathlib import Path

# Vercel's working directory for a serverless function is not guaranteed to
# be the repository root, so make it importable explicitly rather than
# relying on cwd (see backend/server.py's docstring for the same principle).
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.server import app as _fastapi_app  # noqa: E402

API_PREFIX = "/api"


class StripApiPrefix:
    """Thin ASGI wrapper: rewrite "/api" + "/api/<rest>" -> "/" + "/<rest>".

    Runs before routing (it wraps the whole app), so backend/server.py's
    unprefixed route definitions match either way.
    """

    def __init__(self, inner_app):
        self._inner_app = inner_app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            path = scope.get("path", "")
            if path == API_PREFIX:
                scope = {**scope, "path": "/"}
            elif path.startswith(API_PREFIX + "/"):
                scope = {**scope, "path": path[len(API_PREFIX):]}
        await self._inner_app(scope, receive, send)


app = StripApiPrefix(_fastapi_app)
