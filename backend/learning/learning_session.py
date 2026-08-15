"""
In-memory storage for AI-generated learning sessions.

EduSpace has no database for learning content — student accounts live in a
Google Sheet (see data/login.py) and progress lives in the browser
(assets/js/common.js). AI-generated curricula are ephemeral in the same
spirit: kept in this process's memory only, addressed by a generated
session id, and never required for the app to keep working (the frontend
also holds its own copy in sessionStorage and can always ask for a part
again).

Generic part content (summary/explanation/tutor note generated with no
student context) is cached by topic+part so re-opening a part in the same
process reuses it instead of calling the AI providers again. Requests that
carry a student_id are never cached, since a future personalized tutor note
must stay specific to that student.
"""

import time
import uuid
from typing import Optional

_SESSIONS: dict = {}
_PART_CACHE: dict = {}

_CACHE_TTL_SECONDS = 60 * 60


def create_session(topic: str, parts: list) -> str:
    session_id = str(uuid.uuid4())
    _SESSIONS[session_id] = {
        "topic": topic,
        "parts": parts,
        "current_part": parts[0]["id"] if parts else 1,
        "completed_parts": [],
        "created_at": time.time(),
    }
    return session_id


def get_session(session_id: str) -> Optional[dict]:
    return _SESSIONS.get(session_id)


def _cache_key(topic: str, part_id: int):
    return (topic.strip().lower(), int(part_id))


def get_cached_part(topic: str, part_id: int) -> Optional[dict]:
    key = _cache_key(topic, part_id)
    entry = _PART_CACHE.get(key)
    if not entry:
        return None
    if time.time() - entry["at"] > _CACHE_TTL_SECONDS:
        _PART_CACHE.pop(key, None)
        return None
    return entry["data"]


def cache_part(topic: str, part_id: int, data: dict) -> None:
    _PART_CACHE[_cache_key(topic, part_id)] = {"data": data, "at": time.time()}
