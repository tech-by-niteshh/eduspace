"""
AI provider clients — Groq and Gemini.

This is the ONLY place that knows about API keys, model names, endpoint URLs
and HTTP-level provider details. Everything else in ai/ (ai_agent.py) calls
`groq_chat` / `gemini_generate` with a system prompt and user content and
gets back plain text (or None on failure) — it never touches requests,
headers or JSON envelopes itself.

Both functions fail closed: any network error, timeout, non-2xx response or
unexpected payload shape returns None rather than raising. Callers treat
None as "the provider could not produce this" and surface a friendly error;
raw provider exceptions and credentials are never allowed to reach the
frontend.
"""

import logging
import os
from typing import Optional

import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# Groq issues two keys in this project's .env (GROQ_API1 / GROQ_API2) so a
# rate-limited key can be swapped without touching code. The first non-empty
# one is used; ai_agent.py never needs to know either name.
GROQ_API_KEY = os.getenv("GROQ_API1") or os.getenv("GROQ_API2")
GEMINI_API_KEY = os.getenv("GEMINI_API1")

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite")

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

DEFAULT_TIMEOUT = 20


def groq_chat(
    system_prompt: str,
    user_content: str,
    *,
    json_mode: bool = False,
    temperature: float = 0.4,
    max_tokens: int = 1024,
    timeout: int = DEFAULT_TIMEOUT,
) -> Optional[str]:
    """Send one system+user turn to Groq. Returns the raw text reply, or None.

    ``user_content`` is always sent as a separate user message, never
    concatenated into the system prompt — the system prompt keeps priority
    over anything the student typed.
    """
    if not GROQ_API_KEY:
        logger.error("GROQ_API1/GROQ_API2 not set — check the .env file.")
        return None

    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}

    try:
        response = requests.post(
            GROQ_URL,
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=timeout,
        )
    except requests.exceptions.RequestException as exc:
        logger.error("Groq request failed: %s", exc.__class__.__name__)
        return None

    if not response.ok:
        logger.error("Groq returned HTTP %s.", response.status_code)
        return None

    try:
        data = response.json()
        return data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        logger.error("Groq returned an unexpected payload shape: %s", exc.__class__.__name__)
        return None


def gemini_generate(
    system_prompt: str,
    user_content: str,
    *,
    temperature: float = 0.5,
    max_tokens: int = 800,
    timeout: int = DEFAULT_TIMEOUT,
) -> Optional[str]:
    """Send one system+user turn to Gemini. Returns the raw text reply, or None."""
    if not GEMINI_API_KEY:
        logger.error("GEMINI_API1 not set — check the .env file.")
        return None

    url = GEMINI_URL.format(model=GEMINI_MODEL)
    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_content}]}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
            # Gemini's "thinking" models spend maxOutputTokens on an internal
            # reasoning pass by default, which can leave little or no budget
            # for the actual reply on short, simple prompts like these. These
            # are plain generation tasks with no multi-step reasoning to do,
            # so thinking is switched off rather than padding max_tokens to
            # compensate for a budget we don't need.
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }

    try:
        response = requests.post(
            url,
            params={"key": GEMINI_API_KEY},
            json=payload,
            timeout=timeout,
        )
    except requests.exceptions.RequestException as exc:
        logger.error("Gemini request failed: %s", exc.__class__.__name__)
        return None

    if not response.ok:
        logger.error("Gemini returned HTTP %s.", response.status_code)
        return None

    try:
        data = response.json()
        parts = data["candidates"][0]["content"]["parts"]
        return "".join(part.get("text", "") for part in parts)
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        logger.error("Gemini returned an unexpected payload shape: %s", exc.__class__.__name__)
        return None
