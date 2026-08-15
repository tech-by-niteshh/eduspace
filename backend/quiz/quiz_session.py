"""
Stateless quiz sessions — an encrypted, tamper-proof token, not server memory.

WHY NOT AN IN-MEMORY DICT (what this file used to be): a serverless
deployment gives no guarantee that two requests for the same quiz land on
the same warm process. On Vercel, the POST /quiz/start that creates a quiz
and the POST /quiz/question that answers it a few seconds later may well be
handled by two different cold-started instances with two different empty
dicts — every quiz would 404 with QUIZ_NOT_FOUND in production. (This is
NOT a problem for backend/learning/learning_session.py: its in-memory store
is only an optional cache keyed by topic+part text, never read by session
id, so a cache miss just costs one extra AI call instead of breaking
anything. The quiz session below is load-bearing — it holds the
authoritative correct answers — so it gets a different design.)

Instead, the entire session (topic, questions with their correct answers,
and answers recorded so far) is encrypted with Fernet (AES128-CBC + HMAC,
authenticated and tamper-evident) and handed to the browser AS the
"quiz_id" string. The browser carries it around like an opaque token and
sends it back on every request; this file just decrypts+verifies it,
never trusts it blindly (a modified token fails the HMAC check and decrypts
to nothing), and re-encrypts an updated copy after each answer.

This keeps the same guarantee the in-memory version had — the frontend
can never determine or forge correctness, because it cannot decrypt the
token to read or edit the embedded correct_answer index — while working
identically on a single long-lived local dev process and on independent,
memory-isolated serverless invocations.
"""

import base64
import hashlib
import json
import logging
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

SESSION_TTL_SECONDS = 60 * 60


def _load_key() -> bytes:
    """Derive a Fernet key from QUIZ_SESSION_SECRET.

    Fernet requires a 32-byte urlsafe-base64 key; SHA-256 turns any plain
    passphrase from the environment into exactly that, so the env var stays
    a simple string instead of asking a developer to generate a Fernet key
    themselves.

    QUIZ_SESSION_SECRET MUST be set (and stable) in production — every
    serverless instance needs to derive the SAME key to decrypt tokens
    issued by any other instance. Locally, a per-process random fallback is
    fine: one `uvicorn` process serves the whole dev session, so encrypt
    and decrypt always happen with the same key even though it was never
    configured.
    """
    secret = os.getenv("QUIZ_SESSION_SECRET")
    if not secret:
        secret = base64.urlsafe_b64encode(os.urandom(32)).decode("ascii")
        # Vercel sets VERCEL=1 in every deployment's runtime environment —
        # if this fallback fires there, every quiz will intermittently
        # break with QUIZ_NOT_FOUND the moment two requests land on
        # different serverless instances, which is confusing to debug
        # without a loud, specific log line pointing at the actual cause.
        log = logger.error if os.getenv("VERCEL") else logger.warning
        log(
            "QUIZ_SESSION_SECRET is not set — using a random per-process key. "
            "This is fine for a single local dev server, but MUST be set to a "
            "stable value in production (e.g. Vercel) or quiz sessions will "
            "randomly fail with QUIZ_NOT_FOUND across serverless instances."
        )
    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


_FERNET = Fernet(_load_key())


def _encode(data: dict) -> str:
    payload = json.dumps(data, separators=(",", ":")).encode("utf-8")
    return _FERNET.encrypt(payload).decode("ascii")


def _decode(token: str) -> Optional[dict]:
    try:
        payload = _FERNET.decrypt(token.encode("ascii"), ttl=SESSION_TTL_SECONDS)
        return json.loads(payload)
    except (InvalidToken, ValueError, TypeError):
        return None


def create_session(topic: str, questions: list) -> str:
    """``questions`` is the full, authoritative list from ai_agent.generate_quiz.

    Returns the initial quiz_id token — JSON object keys must be strings,
    so question/answer ids are stored as strings and converted back to int
    by get_session().
    """
    return _encode(
        {
            "topic": topic,
            "questions": {str(q["id"]): q for q in questions},
            "answers": {},
        }
    )


def get_session(token: str) -> Optional[dict]:
    """Decrypt and verify ``token``. Returns None if it is invalid, tampered
    with, or older than SESSION_TTL_SECONDS."""
    data = _decode(token)
    if not data or "questions" not in data or "answers" not in data:
        return None
    data["questions"] = {int(k): v for k, v in data["questions"].items()}
    data["answers"] = {int(k): v for k, v in data["answers"].items()}
    return data


def record_answer(token: str, question_id: int, selected_answer: int, correct: bool, feedback: dict) -> Optional[str]:
    """Return a NEW token with this answer added — the caller (quiz_service.py)
    must send this new token back to the browser; the old token is untouched
    (there is nothing server-side left to mutate)."""
    session = get_session(token)
    if not session:
        return None
    session["answers"][question_id] = {
        "selected_answer": selected_answer,
        "correct": correct,
        "feedback": feedback,
    }
    return _encode(
        {
            "topic": session["topic"],
            "questions": {str(k): v for k, v in session["questions"].items()},
            "answers": {str(k): v for k, v in session["answers"].items()},
        }
    )
