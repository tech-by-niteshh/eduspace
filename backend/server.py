import os
import sys

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# The modules below are imported as top-level packages ("data", "learning",
# "ai"), which only resolves when this directory is on sys.path. Adding it
# explicitly means `python backend/server.py` works from the project root as
# well as from inside backend/.
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Apne banaye hue modules import karein
from data.login import router as login_router  # noqa: E402
from data.signup import router as signup_router  # noqa: E402
from learning.insights_router import router as insights_router  # noqa: E402
from learning.learning_router import router as learning_router  # noqa: E402
from quiz.quiz_router import router as quiz_router  # noqa: E402

app = FastAPI(
    title="EduSpace Core Server",
    description="Master Backend for EduSpace AI Learning Platform",
    version="1.0.0",
)

# CORS Setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes ko Master App me add karein
#
# Every router is nested under /api so a single Vercel rewrite ("/api/:path*"
# -> this function) can hand off all API traffic while static files (index.html,
# learning.html, assets/, ...) are served directly by Vercel at their own
# paths. This only adds a prefix — each router's own path is unchanged, e.g.
# data/login.py's "/login" becomes "/api/login", learning_router's
# "/learning/start" becomes "/api/learning/start". Local development
# (uvicorn/`python server.py`) picks up the same prefix automatically.
app.include_router(signup_router, prefix="/api")
app.include_router(login_router, prefix="/api")
# Integration point for the AI pipeline. Reports available: false until the
# modules in ai/ and learning/ are implemented.
app.include_router(insights_router, prefix="/api")
# AI-generated learning paths — see backend/learning/learning_router.py.
app.include_router(learning_router, prefix="/api")
# AI-powered adaptive quiz — see backend/quiz/quiz_router.py.
app.include_router(quiz_router, prefix="/api")


@app.get("/")
def home():
    return {
        "status": "Online",
        "message": "EduSpace Backend API is running successfully!",
    }


if __name__ == "__main__":
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
