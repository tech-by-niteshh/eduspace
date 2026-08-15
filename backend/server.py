"""
EduSpace FastAPI application.

This is the ONE FastAPI app object in the project (``app`` below). Importing
it does no work beyond constructing the app and wiring routers together —
no server started, no network call made — which is what makes each of
these all work the same way:

    python backend/server.py                          (local dev — see note below)
    python -m backend.server                           (local dev, alternative)
    uvicorn backend.server:app --reload                 (local dev, alternative)
    python -c "from backend.server import app"          (import smoke test)
    from backend.server import app                      (api/index.py, on Vercel)

Every API route below is defined with its real, final path already baked
into its router's own prefix — "/api/quiz/...", "/api/learning/...",
"/api/login", etc. (see each router's own file). Nothing here or in
api/index.py rewrites or strips a path: Vercel's Python runtime forwards a
request under "/api/*" to api/index.py's ASGI app exactly as received, and
FastAPI's own router matches it directly, because the paths already agree.

On top of the API, this same app ALSO serves the static frontend
(index.html, learning.html, .../assets/*) when run locally, so
`python backend/server.py` alone — no separate static file server — gives
a fully working app at http://127.0.0.1:8000/. On Vercel this part is
inert: "/", "/*.html" and "/assets/*" are served by Vercel's static layer
before a request would ever reach this Python function, so these routes
just never get invoked there. It's a pure local-dev convenience, not a
second copy of the frontend-serving logic.

WHY "python backend/server.py" NEEDS THE __main__ GUARD BELOW: running a
file directly puts its own directory (backend/) on sys.path[0], not the
repository root — so the "from backend.data.login import ..." absolute
imports a few lines down would otherwise fail with "No module named
'backend'" (backend/'s own parent isn't importable from inside backend/).
The guard only fires when this exact file is executed as the entry-point
script (__name__ == "__main__"); it is never reached when this module is
imported normally (`from backend.server import app`, e.g. by api/index.py
on Vercel, where __name__ is "backend.server") — so the module stays
cleanly importable with zero sys.path assumptions in every other context.
"""

import sys
from pathlib import Path

if __name__ == "__main__":
    _REPO_ROOT = Path(__file__).resolve().parent.parent
    if str(_REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(_REPO_ROOT))

import os  # noqa: E402

import uvicorn  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from backend.data.login import router as login_router  # noqa: E402
from backend.data.signup import router as signup_router  # noqa: E402
from backend.learning.insights_router import router as insights_router  # noqa: E402
from backend.learning.learning_router import router as learning_router  # noqa: E402
from backend.quiz.quiz_router import router as quiz_router  # noqa: E402

app = FastAPI(
    title="EduSpace Core Server",
    description="Master Backend for EduSpace AI Learning Platform",
    version="1.0.0",
)

# ---------------------------------------------------------------------------
# CORS
#
# In production the frontend and API share one Vercel origin (static files
# at "/", API under "/api"), so same-origin requests never hit this
# middleware at all. Locally, this server now serves the frontend itself
# (see the static routes below), so http://127.0.0.1:8000 is also
# same-origin — this middleware only matters if you choose to serve the
# frontend separately instead (e.g. VS Code "Live Server" on a different
# port), which still works.
#
# The app uses no cookies (auth state lives in the browser's localStorage —
# see assets/js/common.js), so allow_credentials stays False and origins can
# stay an explicit list instead of "*" — a routing bug should show up as a
# 404, not get silently masked by an overly-permissive CORS policy.
# ---------------------------------------------------------------------------
DEFAULT_DEV_ORIGINS = [
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://127.0.0.1:5500",  # VS Code "Live Server" default port
    "http://localhost:5500",
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "null",  # the Origin header a browser sends for a page opened via file://
]
_extra_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=DEFAULT_DEV_ORIGINS + _extra_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# API routes — each router already owns its full "/api/..." path (see each
# router file's own prefix=). No prefix is added here, to keep there being
# exactly one place that decides a route's real path.
app.include_router(signup_router)
app.include_router(login_router)
# Integration point for the AI pipeline. Reports available: false until the
# modules in ai/ and learning/ are implemented.
app.include_router(insights_router)
# AI-generated learning paths — see backend/learning/learning_router.py.
app.include_router(learning_router)
# AI-powered adaptive quiz — see backend/quiz/quiz_router.py.
app.include_router(quiz_router)


@app.get("/api")
def api_health():
    """Health check for the API itself. "/" is the frontend homepage, not
    the API — do not use it for health checks."""
    return {
        "status": "online",
        "message": "EduSpace Backend API is running successfully",
    }


# ---------------------------------------------------------------------------
# Static frontend — local-dev convenience only (see module docstring).
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = REPO_ROOT / "assets"

if ASSETS_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")

FRONTEND_PAGES = ["index.html", "learning.html", "quiz.html", "dashboard.html", "login.html", "signup.html"]


def _serve_page(filename: str):
    def handler():
        return FileResponse(REPO_ROOT / filename)

    return handler


for _page in FRONTEND_PAGES:
    app.get(f"/{_page}")(_serve_page(_page))

# "/" is the homepage, same as production — visiting the backend directly
# shows the real app instead of a bare JSON status.
app.get("/")(_serve_page("index.html"))


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
