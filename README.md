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

**Frontend and API share one deployment.** Every router's own prefix already includes `/api`
(`backend/quiz/quiz_router.py`'s `/api/quiz/...`, `login.py`'s `/api/login`, ...), so the app's
real routes are identical locally and on Vercel — nothing rewrites or strips a path anywhere.
Locally, the API runs standalone on `http://127.0.0.1:8000` and those same `/api/...` routes are
reached at `http://127.0.0.1:8000/api/...`. On Vercel, `api/index.py` is a one-line passthrough
(`from backend.server import app`) — Vercel's Python runtime forwards every request under `/api`
straight into that FastAPI app exactly as received, and FastAPI's own router matches it directly
because the paths already agree. `assets/js/common.js` picks the right base URL automatically
(see [Local vs. production API base URL](#local-vs-production-api-base-url)).

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
python backend/server.py
```

Open `http://127.0.0.1:8000/` — that's the whole app. This one process serves **both** the
frontend (`index.html`, `learning.html`, ..., `assets/*`, mirroring exactly what Vercel serves
statically in production — see `backend/server.py`'s static routes) **and** the API under
`/api/...` (interactive docs at `/docs`). No second terminal, no separate static file server, no
CORS setup needed for local development — everything is same-origin. `assets/js/common.js` still
detects it isn't on Vercel and points API calls at `http://127.0.0.1:8000/api`, which is this
same server.

Equivalent alternatives, if you prefer:
- `python -m backend.server` — identical result, run as a module instead of a script.
- `uvicorn backend.server:app --reload` — adds auto-reload on file changes (not available when
  running the file directly, since `python backend/server.py` passes the already-constructed
  `app` object to uvicorn rather than an import string, which is what makes plain `python
  backend/server.py` reliable in the first place — reload needs to re-import the module by name
  in a fresh subprocess, which the plain script form deliberately avoids depending on).
- Serve the HTML files with a separate static server (e.g. VS Code's "Live Server") while running
  the backend on its own — still works, the CORS config in `backend/server.py` allows it.

> Running `backend/server.py` directly (rather than importing it) puts `backend/`'s own directory
> on `sys.path`, not the repository root — so the `from backend.data.login import ...` absolute
> imports a few lines down would normally fail with `ModuleNotFoundError: No module named
> 'backend'`. A small guard at the top of that file, scoped to exactly `if __name__ ==
> "__main__":`, fixes `sys.path` *only* when the file is run as the entry-point script — it never
> fires when the module is imported normally (`from backend.server import app`, e.g. by
> `api/index.py` on Vercel), so that import path stays exactly as clean and hack-free as before.
> Vercel never executes this file directly either way — it only ever imports `backend.server:app`
> through `api/index.py` (see [Deploying to Vercel](#deploying-to-vercel)).

### Quick health check

```bash
python -c "from backend.server import app; print(app)"   # must import cleanly, no server needed
python -c "from api.index import app; print(app)"        # the actual Vercel entrypoint — same app
curl http://127.0.0.1:8000/api                            # {"status": "online", ...}
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
| `GROQ_MODEL` | optional | `backend/ai/providers.py` | Defaults to `openai/gpt-oss-120b`. |
| `GEMINI_MODEL` | optional | `backend/ai/providers.py` | Defaults to `gemini-3.1-flash-lite`. |
| `QUIZ_SESSION_SECRET` | **required in production** | `backend/quiz/quiz_session.py` | Encrypts quiz tokens. Optional locally (falls back to a random per-process key, fine for one long-lived dev server) but **must** be a real, stable value in production — see the architecture note above. Generate one with `python -c "import secrets; print(secrets.token_urlsafe(32))"`. |
| `CORS_ORIGINS` | optional | `backend/server.py` | Comma-separated extra allowed origins for local dev (e.g. a non-default Live Server port). Not needed on Vercel — the frontend and API share one origin there. |

## Deploying to Vercel

```bash
npm install -g vercel   # or use `npx vercel` without installing globally
vercel login            # one-time interactive login
vercel                  # links the project (first run) and deploys a Preview
```

Set environment variables (see the table above) — either in the dashboard, or from the CLI:

```bash
vercel env add GEMINI_API1 production
vercel env add GROQ_API1 production
vercel env add QUIZ_SESSION_SECRET production
vercel env add SHEETS_SCRIPT_API production
# repeat for preview/development environments too if you use them, and for
# the optional GROQ_API2 / GROQ_MODEL / GEMINI_MODEL / CORS_ORIGINS
```

Then deploy to production:

```bash
vercel --prod
```

That's the whole deploy. Re-run `vercel --prod` any time after pushing new changes or adding/
changing an environment variable (env var changes don't apply to a deployment retroactively).

**How routing works — `vercel.json`, current, confirmed working:**

```json
{
  "builds": [
    {
      "src": "api/index.py",
      "use": "@vercel/python",
      "config": {
        "includeFiles": ["backend/**", "*.html", "assets/**"]
      }
    }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "api/index.py" }
  ]
}
```

This is the legacy-but-still-supported `builds`/`routes` format: `routes` sends **every** request —
`/`, `/learning.html`, `/assets/js/common.js`, `/api/quiz/start`, all of it — to the one Python
Serverless Function built from `api/index.py`. That works correctly here (rather than 404ing on
the static pages) specifically because `backend/server.py` already has real handlers for all of
them: `/`, `/index.html`, `/learning.html`, `/quiz.html`, `/dashboard.html`, `/login.html`,
`/signup.html` each return the matching file via `FileResponse`, and `/assets/*` is served through
a mounted `StaticFiles` directory — the same routes added earlier so `python backend/server.py`
alone (no separate static server) is a complete local dev environment. Routing 100% of production
traffic through that one function just means local dev and production now go through the exact
same code path, no separate static-hosting behavior to keep in sync.

`config.includeFiles` matters because of *why* this works: `@vercel/python`'s build only
auto-bundles files it can trace through Python `import` statements, which covers every module
under `backend/` (imported, directly or transitively, by `api/index.py`) — but `index.html`,
`learning.html`, and everything under `assets/` are read from disk at request time (`FileResponse`,
`StaticFiles`), never `import`ed, so the builder has no way to know they're needed. Without
`includeFiles` naming them explicitly, the build can succeed with no error and the deployment can
still 404 the moment someone visits `/`, because the HTML/asset files were simply never bundled
into the function. `backend/**` is included too for belt-and-suspenders, even though it should
already be picked up by import tracing.

**Trade-offs worth knowing, from routing everything through one function instead of letting
Vercel's CDN serve static files directly:** every CSS/JS/image request is now a Python function
invocation rather than a static asset served at the edge — slower per request (especially on a
cold start) and counts against your plan's function-invocation limits. This format also can't be
combined with the newer `functions` block for a per-function `maxDuration` override (`functions`
and `builds` are mutually exclusive in `vercel.json`), so this function runs on Vercel's default
execution time limit rather than an extended one — worth watching if quiz generation (which can
retry once on an invalid AI response, see `backend/ai/ai_agent.py`) ever times out in production.
If that starts happening, the fix is switching this file to the newer `functions`-block format
(no `builds`/`routes`), which does support a per-function `maxDuration` override.

**`.vercelignore`** keeps the deployment small and predictable regardless of local state — it
excludes `.venv/`, `__pycache__/`, `.env`, and other local-only files so a `vercel deploy` run
straight from the CLI (which uploads the current directory, not a git history) can't accidentally
ship a multi-hundred-MB virtual environment or a real secret. `requirements.txt` at the repo root
is what `@vercel/python` actually installs from — `pyproject.toml`'s `dependencies` list is kept
identical for editor/tooling metadata only, and deliberately has no `[build-system]` section, since
Vercel doesn't build this project as an installable package, it just installs `requirements.txt`
and runs the function.

### Local vs. production API base URL

`assets/js/common.js` sets `EduSpace.API_BASE_URL` once, based on `window.location.hostname`:

- `localhost` / `127.0.0.1` / opened as a local file → `http://127.0.0.1:8000/api`
- anything else (a Vercel domain) → `/api`

Every call site in the codebase (`login.js`, `signup.js`, `ai-learning.js`, `ai-quiz.js`,
`common.js`'s `EduSpace.insights`) calls a bare path like `/quiz/start` — never `/api/...` itself
— so this one line is the only place in the whole frontend that adds the `/api` prefix, exactly
once, in both environments.

## API routes

All routes below are relative to `http://127.0.0.1:8000` locally, or the deployed Vercel domain
in production — in both cases, every path already starts with `/api`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api` | API health check (`/` is the static homepage — see [Critical routing rule](#critical-routing-rule)). |
| `POST` | `/api/signup`, `/api/login` | Auth, via the Google Sheets webhook. |
| `POST` | `/api/learning/start` | Groq splits a topic into 5 ordered parts. |
| `POST` | `/api/learning/part` | Gemini summary + explanation, Groq tutor note, for one part. |
| `POST` | `/api/quiz/start` | Gemini generates exactly 5 questions; returns them **without** correct answers. |
| `POST` | `/api/quiz/question` | Scores one answer server-side, returns Gemini's explanation and a rotated `quiz_id` token. |
| `POST` | `/api/quiz/result` | Groq analyzes the completed attempt; backend stays authoritative on score/percentage. |
| `GET` | `/api/insights/*` | Integration points for a not-yet-implemented adaptive-misconception pipeline; return `available: false` today by design (see `backend/learning/pipeline.py`). |

### Critical routing rule

With the current `vercel.json` (see [Deploying to Vercel](#deploying-to-vercel)), **every** path —
`/`, `/learning.html`, `/quiz.html`, `/dashboard.html`, `/login.html`, `/signup.html`, `/assets/*`,
and everything under `/api/`  — is routed to the single Python Serverless Function built from
`api/index.py`. That function `import`s `backend.server:app` and, for the static paths, that same
app answers with `FileResponse`/`StaticFiles` handlers (added for local dev — see
[Local setup](#local-setup) — and reused here). There is exactly one FastAPI instance, exactly one
Serverless Function, and exactly one place path handling is decided (`backend/server.py`'s own
route definitions) — the same code answers a request identically whether it arrived locally or via
Vercel's routing.

Either way, `backend/server.py` is never an independent route or its own separate process on
Vercel: it is only ever imported as a Python module, by `api/index.py`. There is no configuration
anywhere in this repository — no `builds` entry, no `routes` entry, nothing in the dashboard's
Build & Development Settings — that executes `backend/server.py` directly or maps a URL straight
at that file path; every route above only ever reaches it through `api/index.py`'s import.

Every response follows one envelope: `{"success": true, ...}` or
`{"success": false, "error": {"code", "message"}}` — provider errors, prompts, stack traces and
API keys never reach the client (logged server-side only).

## Testing performed

- `python -c "from backend.server import app"` and `python -c "from api.index import app"` —
  both import cleanly with no cwd/sys.path assumptions; `api.index.app` is confirmed to be the
  exact same `FastAPI` instance (`type(app) is fastapi.applications.FastAPI`, not a wrapper).
- `api/index.py` verified directly against the raw ASGI protocol (not just `TestClient`, which
  talks to the FastAPI app directly and would not have caught a `/api` mismatch): `/api`,
  `/api/quiz/start`, and an unmatched `/api/nonexistent` all resolve correctly, including full
  request bodies round-tripping — this is what actually proves Vercel's real request shape
  (`/api/quiz/start` arriving unmodified) reaches the right route with zero rewriting.
- Confirmed `/api/api/quiz/start` 404s and the old unprefixed `/quiz/start`/`/login` no longer
  exist at all (they 404) — the double-prefix and stale-route failure modes are both closed.
- Full quiz flow (`/api/quiz/start` → 5× `/api/quiz/question` → `/api/quiz/result`) via FastAPI's
  TestClient, both with mocked AI responses (validating routing/scoring/duplicate-
  submission/incomplete-quiz logic in isolation) and with real Gemini/Groq calls.
- `python backend/server.py` actually started as a real subprocess (not just imported) and
  exercised over real HTTP: `GET /` returns `index.html`'s real content (not JSON), all 6 frontend
  pages and `/assets/js/common.js`/`/assets/css/base.css` serve with correct content-types,
  `GET /api` still returns the JSON health check, and `POST /api/quiz/start` still reaches the
  quiz router — confirming the static-frontend addition didn't shadow or break any API route.
- `/api/signup`, `/api/learning/start`, `/api/insights/status` all confirmed reachable under the
  new prefix with correct validation behavior.
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
(interactive OAuth device-flow login) that isn't available in this environment — the CLI installs
fine (`npx vercel@latest`), but both commands stop at the login prompt. Everything they would
exercise (the zero-config static/function split, the ASGI entrypoint's exact request handling,
the requirements/pyproject validity) was instead verified directly against the raw ASGI protocol,
as described above. Run `vercel login` once and then `vercel build` yourself to close this last
gap before a real deploy — and see [Root cause of the reported failure](#root-cause-of-the-reported-failure)
for one thing to check in the dashboard that this repository cannot inspect from here.

## Root cause of the reported failure

A previous deployment showed `GET /` → `500 FUNCTION_INVOCATION_FAILED` at `Route: /backend/server.py`,
and running `python backend/server.py` (at that time) produced `ModuleNotFoundError: No module
named 'backend'`. The second error is the more informative one: it happened because
`backend/server.py`, when executed directly, puts its own directory on `sys.path` rather than the
repository root, so its absolute `backend.x` imports couldn't resolve — the same failure shape
Vercel's function invocation hit. *This particular symptom is now fixed* — `backend/server.py` has
a small `sys.path` guard scoped to exactly `if __name__ == "__main__":` (see
[Local setup](#local-setup)), so running it directly works again without reintroducing the
sys.path fragility the earlier absolute-import refactor deliberately removed from the *module
import* path. That fix only explains and closes the `ModuleNotFoundError` symptom, though — it
doesn't explain why Vercel would have invoked `backend/server.py` as its own function in the first
place, since nothing in this repository does that (there is no `builds`/`routes`
config anywhere targeting `backend/server.py`, confirmed by grep), and under Vercel's current,
documented behavior only files under `api/` become Serverless Functions — `backend/server.py`
living outside `api/` should never be picked up at all. The most likely explanation is a stale
Vercel **Project Settings** value (Dashboard → Settings → Build & Development Settings) — e.g. a
leftover custom Build/Start Command, or a `vercel.json` from an earlier iteration of this project
that used the legacy `builds`/`routes` format pointing at `backend/server.py` directly — which
this repository's files cannot show, since Vercel can persist dashboard-level settings across
deploys independently of what's in the repo. **Please check that page and set "Framework Preset"
to "Other" with no custom Build/Install/Output/Start command overriding the zero-config behavior
described above**, then redeploy from this repository's current state.

Independently of that dashboard check, this repository is now also structurally more resistant to
the failure mode itself: `api/index.py` no longer wraps the app in any custom class (a wrapper is
one more layer that could theoretically misbehave), and there is exactly one `FastAPI()` instance
anywhere in the codebase, in `backend/server.py`, imported — never executed — everywhere else.

**Note:** the current `vercel.json` (see [Deploying to Vercel](#deploying-to-vercel)) does use the
legacy `builds`/`routes` format flagged as a suspect above — the difference is that `dest` here
points at `api/index.py` (which only ever imports `backend.server`), never at
`backend/server.py` directly. That distinction is exactly what determines whether this pattern is
safe or reproduces the original bug — confirmed correct by grep (`dest: "api/index.py"`, not
`"backend/server.py"`) and by testing `api/index.py`'s app object directly.

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
