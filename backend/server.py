"""
EduSpace FastAPI application.

This is the ONE FastAPI app object in the project (``app`` below). It is
safe to import from anywhere on a clean ``sys.path`` — no cwd assumptions,
no sys.path mutation, no work performed at import time beyond wiring
routers together — which is what makes each of these all work the same way:

    python -m backend.server                          (local dev)
    uvicorn backend.server:app --reload                (local dev, alternative)
    python -c "from backend.server import app"         (import smoke test)
    from backend.server import app                     (api/index.py, on Vercel)

Locally the app is served directly on http://127.0.0.1:8000 with routes at
their bare paths ("/login", "/quiz/start", ...). On Vercel, api/index.py
mounts this same app behind an ASGI wrapper that strips a leading "/api" —
see that file for why routes here are deliberately NOT prefixed with /api.
"""

import os

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.data.login import router as login_router
from backend.data.signup import router as signup_router
from backend.learning.insights_router import router as insights_router
from backend.learning.learning_router import router as learning_router
from backend.quiz.quiz_router import router as quiz_router

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
# middleware at all — it only matters for local development, where the
# frontend may be opened as a file:// page or served by a separate dev
# server on a different port than the API's 127.0.0.1:8000.
#
# The app uses no cookies (auth state lives in the browser's localStorage —
# see assets/js/common.js), so allow_credentials stays False and origins can
# stay an explicit list instead of "*".
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

# Routes
app.include_router(signup_router)
app.include_router(login_router)
# Integration point for the AI pipeline. Reports available: false until the
# modules in ai/ and learning/ are implemented.
app.include_router(insights_router)
# AI-generated learning paths — see backend/learning/learning_router.py.
app.include_router(learning_router)
# AI-powered adaptive quiz — see backend/quiz/quiz_router.py.
app.include_router(quiz_router)


@app.get("/")
def home():
    return {
        "status": "Online",
        "message": "EduSpace Backend API is running successfully!",
    }


if __name__ == "__main__":
    uvicorn.run(
        "backend.server:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=False,
    )
