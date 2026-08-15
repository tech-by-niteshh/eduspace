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
app.include_router(signup_router)
app.include_router(login_router)
# Integration point for the AI pipeline. Reports available: false until the
# modules in ai/ and learning/ are implemented.
app.include_router(insights_router)
# AI-generated learning paths — see backend/learning/learning_router.py.
app.include_router(learning_router)


@app.get("/")
def home():
    return {
        "status": "Online",
        "message": "EduSpace Backend API is running successfully!",
    }


if __name__ == "__main__":
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)
