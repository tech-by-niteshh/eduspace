# EduSpace

EduSpace is an AI-powered personalized learning platform: students describe a topic in plain
English, and Gemini/Groq generate a five-part learning path, an adaptive five-question quiz with
worked explanations, and a performance report — instead of static, pre-written lessons.

## Features

- **Personalized learning paths** (`learning.html`) — a student names any topic; Groq splits it
  into five ordered learning parts, and Gemini generates a summary, an explanation, and a short
  AI tutor note for each part as the student opens it.
- **AI quiz** (`quiz.html`) — Gemini generates exactly five multiple-choice questions on a topic
  the student chooses, with a balanced easy → hard difficulty curve. Each answer is scored
  server-side and explained by Gemini (correct answer, why, and a learning tip). After the fifth
  question, Groq analyzes the whole attempt — strengths, weaknesses, topics to revisit, and a
  recommended next step — and a "Learn `<weak topic>`" link opens a real learning path for it.
- **Dashboard** (`dashboard.html`) — understanding %, a day streak, weak topics, and recent
  activity, computed entirely from what the student actually did (quiz/learning progress recorded
  in the browser's `localStorage`) — never fabricated placeholder numbers.
- **Auth** (`login.html`, `signup.html`) — backed by a Google Sheets Apps Script webhook (see
  [Authentication model](#authentication-model) below for what this does and doesn't guarantee).

## Architecture

```
Browser (static HTML/CSS/JS)
      |
      |  fetch()  — EduSpace.api in assets/js/common.js
      v
FastAPI app (backend/server.py)
      |
      |-- backend/data/          login, signup            -> Google Sheets webhook
      |-- backend/learning/      learning-path endpoints   -> AI functions below
      |-- backend/quiz/          quiz endpoints             -> AI functions below
      v
backend/ai/ai_agent.py  (validates every AI response; never trusts raw output)
      |
      +-- Gemini  — lesson summaries/explanations, quiz question generation, per-answer feedback
      +-- Groq    — curriculum decomposition, AI tutor notes, final quiz performance analysis
```

**Frontend and API share one deployment.** Locally the API runs standalone on
`http://127.0.0.1:8000`; on Vercel, `api/index.py` mounts the exact same FastAPI app behind a
thin ASGI wrapper that strips a leading `/api`, so the same route definitions
(`backend/server.py`'s `/quiz/start`, `/login`, ...) serve both environments unmodified.
`assets/js/common.js` picks the right base URL automatically (see
[Local vs. production API base URL](#local-vs-production-api-base-url)).

**No database.** Student accounts live in a Google Sheet; everything else the app "remembers" —
progress, streaks, weak topics — lives in the browser's `localStorage`
(`assets/js/common.js`'s `EduSpace.progress`). AI-generated content is ephemeral by design:

- Learning-path parts are cached in the FastAPI process's memory only as a *performance*
  shortcut (same topic + part reuses the last generation instead of calling Gemini/Groq again).
  A cache miss just costs one extra AI call — nothing breaks if it's empty.
- Quiz sessions are **not** cached in memory at all. A quiz's `quiz_id` is itself an encrypted,
  tamper-proof token (`backend/quiz/quiz_session.py`, via `cryptography.fernet`) carrying the
  topic, the questions with their correct answers, and the answers recorded so far. This is what
  makes the quiz correct on Vercel: two requests for the same quiz are not guaranteed to land on
  the same serverless instance, so anything held only in a Python dict in one process would
  vanish before the next request arrived. The token approach needs no server memory at all — see
  that file's docstring for the full reasoning. **This is why `QUIZ_SESSION_SECRET` is a required
  production environment variable** (below): every instance must derive the same encryption key.

## Local setup

Requires **Python 3.12+**.

```bash
pip install -r requirements.txt
cp .env.example .env   # then fill in the values below
python -m backend.server
```

The API is now running at `http://127.0.0.1:8000` (interactive docs at `/docs`). Open any of the
HTML files directly in a browser, or serve them with any static file server (e.g. VS Code's "Live
Server", or `python -m http.server 5500`) — `assets/js/common.js` detects it isn't on Vercel and
points API calls at `http://127.0.0.1:8000` automatically.

Alternative dev command (auto-reload, same result): `uvicorn backend.server:app --reload`.

> `python backend/server.py` (running the file directly, not as a module) **no longer works** —
> the package uses standard absolute imports (`from backend.ai import ...`) instead of a
> `sys.path` hack, which only resolve when Python is told to run it as part of the `backend`
> package. Use `python -m backend.server` instead.

### Quick health check

```bash
python -c "from backend.server import app; print(app)"   # must import cleanly, no server needed
curl http://127.0.0.1:8000/                               # {"status": "Online", ...}
```

## Environment variables

Copy `.env.example` to `.env` and fill in real values locally; set the same names in your Vercel
project's Environment Variables for production. The app **imports and starts successfully with
none of these set** — routes that need a missing key return a clean `503`/error JSON instead of
crashing the whole server.

| Variable | Required | Used by | Notes |
|---|---|---|---|
| `SHEETS_SCRIPT_API` | for login/signup | `backend/data/login.py`, `signup.py` | Google Apps Script Web App URL. |
| `GROQ_API1`, `GROQ_API2` | for learning + quiz results | `backend/ai/providers.py` | First non-empty one is used; two keys let you swap a rate-limited one without a deploy. |
| `GEMINI_API1` | for learning + quiz | `backend/ai/providers.py` | |
| `GROQ_MODEL` | optional | `backend/ai/providers.py` | Defaults to `llama-3.3-70b-versatile`. |
| `GEMINI_MODEL` | optional | `backend/ai/providers.py` | Defaults to `gemini-2.5-flash`. |
| `QUIZ_SESSION_SECRET` | **required in production** | `backend/quiz/quiz_session.py` | Encrypts quiz tokens. Optional locally (falls back to a random per-process key, fine for one long-lived dev server) but **must** be a real, stable value in production — see the architecture note above. Generate one with `python -c "import secrets; print(secrets.token_urlsafe(32))"`. |
| `CORS_ORIGINS` | optional | `backend/server.py` | Comma-separated extra allowed origins for local dev (e.g. a non-default Live Server port). Not needed on Vercel — the frontend and API share one origin there. |

## Deploying to Vercel

```bash
npm install -g vercel   # or use `npx vercel`
vercel login
vercel                  # first deploy — links the project, deploys a Preview
```

Then, in the Vercel dashboard for the project (Settings → Environment Variables), set at least
`GEMINI_API1`, `GROQ_API1`, `QUIZ_SESSION_SECRET`, and `SHEETS_SCRIPT_API` (Production + Preview),
and redeploy (`vercel --prod`) so the function picks them up.

**How routing works** (`vercel.json`):

```json
{ "rewrites": [{ "source": "/api/(.*)", "destination": "/api/index" }] }
```

- `/`, `/learning.html`, `/quiz.html`, `/dashboard.html`, `/login.html`, `/signup.html`,
  `/assets/*` — served as static files with zero extra config (they're already at the repo root).
- `/api/*` — rewritten to the Python serverless function at `api/index.py`, which imports the
  one and only FastAPI app from `backend/server.py` and strips the `/api` prefix before FastAPI's
  router sees the path — so `backend/server.py` needs no knowledge of being mounted under `/api`,
  and there is exactly one place (`api/index.py`) that could ever produce an `/api/api/...` bug.

### Local vs. production API base URL

`assets/js/common.js` sets `EduSpace.API_BASE_URL` once, based on `window.location.hostname`:

- `localhost` / `127.0.0.1` / opened as a local file → `http://127.0.0.1:8000`
- anything else (a Vercel domain) → `/api`

Every call site in the codebase (`login.js`, `signup.js`, `ai-learning.js`, `ai-quiz.js`,
`common.js`'s `EduSpace.insights`) calls a bare path like `/quiz/start` — never `/api/...` — so
this one line is the only place that needs to know which environment is running, and
`/api/api/...` is structurally impossible.

## API routes

All routes below are relative to `http://127.0.0.1:8000` locally, or `/api` in production.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | Health check. |
| `POST` | `/signup`, `/login` | Auth, via the Google Sheets webhook. |
| `POST` | `/learning/start` | Groq splits a topic into 5 ordered parts. |
| `POST` | `/learning/part` | Gemini summary + explanation, Groq tutor note, for one part. |
| `POST` | `/quiz/start` | Gemini generates exactly 5 questions; returns them **without** correct answers. |
| `POST` | `/quiz/question` | Scores one answer server-side, returns Gemini's explanation and a rotated `quiz_id` token. |
| `POST` | `/quiz/result` | Groq analyzes the completed attempt; backend stays authoritative on score/percentage. |
| `GET` | `/insights/*` | Integration points for a not-yet-implemented adaptive-misconception pipeline; return `available: false` today by design (see `backend/learning/pipeline.py`). |

Every response follows one envelope: `{"success": true, ...}` or
`{"success": false, "error": {"code", "message"}}` — provider errors, prompts, stack traces and
API keys never reach the client (logged server-side only).

## Testing performed

- `python -c "from backend.server import app"` — clean import, no cwd/sys.path assumptions.
- `api/index.py`'s ASGI wrapper — verified directly against the raw ASGI protocol that
  `/api`, `/api/quiz/start`, and an unmatched `/api/nonexistent` all resolve to the correct
  route (or a clean 404), including full request bodies round-tripping correctly.
- Full quiz flow (`/quiz/start` → 5× `/quiz/question` → `/quiz/result`) via FastAPI's TestClient,
  both with mocked AI responses (validating routing/scoring/duplicate-submission/incomplete-quiz
  logic in isolation) and with real Gemini/Groq calls.
- Quiz statelessness proven across **genuinely separate Python processes** (simulating
  independent serverless cold starts): a token encrypted in one process decrypts correctly in
  another when `QUIZ_SESSION_SECRET` matches, and safely fails closed when it doesn't.
- Verified the quiz token's ciphertext does not contain readable question text or answers
  (confirms answers aren't recoverable by a browser user decoding the token without the key).
- Failure-mode tests: Gemini down, malformed/short AI output, Groq down — all resolve to the
  generic `"Something went wrong..."` message with no key/prompt/traceback leakage.
- Static asset audit: every `href`/`src` in every HTML file resolves to a real file, with
  case-sensitive path matching (Windows is case-insensitive; Vercel's Linux filesystem is not).
- Security sweep: no hardcoded API keys/secrets in tracked files, no `eval`/`exec`/`subprocess`,
  no SQL (no database exists), all AI-generated text rendered via safe DOM construction
  (never `innerHTML` with AI or user-controlled content).

**Not completed:** `vercel build` / `vercel dev` require an authenticated Vercel account
(interactive OAuth device-flow login) that isn't available in this environment — the CLI is
installed and `vercel.json` is valid, but the actual build/dev commands couldn't be run to
completion. Everything they would exercise (the rewrite's routing behavior, the ASGI entrypoint,
the requirements/pyproject validity) was instead verified directly, as described above. Run
`vercel login` once and then `vercel build` yourself to close this last gap before a real deploy.

## Known limitations

- **Auth is demo-tier.** Passwords are sent to `/login`/`/signup` and forwarded as-is to the
  Google Apps Script webhook; this repository has no visibility into (and cannot verify or
  change) how that script stores them. Treat this as a prototype auth flow, not a
  production-grade credential store — do not reuse real passwords when testing it.
  Do not put a database or a second auth system in front of it without discussing the tradeoff
  first; the whole app is built around not needing one.
- **The adaptive misconception/knowledge-model pipeline is intentionally unimplemented**
  (`backend/ai/misconception.py`, `tutor.py`, `question_generator.py`,
  `backend/learning/knowledge_model.py`, `adaptive_engine.py`, `progress_predictor.py`). Every
  function returns `None`/`pass`; `/insights/*` reports `available: false` and the frontend shows
  an honest empty state rather than fabricated numbers. This is a separate, larger feature from
  the quiz/learning systems above, not a bug.
- **Free-tier AI quota.** Gemini's free tier caps at ~20 requests/day per key; Groq's free tier
  is more generous. Under heavy testing you may see `AI_PROVIDER_ERROR` from quiz/learning
  routes purely from quota exhaustion — this fails closed with a clean message, by design.
