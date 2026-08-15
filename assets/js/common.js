/* ==========================================================================
   EduSpace — common.js
   Loaded first on every page. Two jobs:
     1. Shared UI behaviour (nav toggle, header scroll state, scroll reveal).
     2. A small shared data layer on window.EduSpace that page scripts use
        instead of touching localStorage directly.

   IMPORTANT: elements with class "reveal" are opacity:0 in CSS until this
   file adds "is-visible". If this file fails to load, those pages render
   blank. base.css / dashboard.css now also carry an html:not(.js) fallback
   so a missing script can never blank a page again.
   ========================================================================== */

(() => {
  "use strict";

  /* ------------------------------------------------------------------
     Namespace
     ------------------------------------------------------------------ */
  const EduSpace = (window.EduSpace = window.EduSpace || {});

  /* API base for the FastAPI server in backend/server.py.
     Declared once here — login.js and signup.js used to hardcode their own
     copy of this string.

     Every call site in the codebase (login.js, signup.js, ai-learning.js,
     ai-quiz.js, this file's EduSpace.insights, ...) calls EduSpace.api with
     an unprefixed path like "/quiz/start" — backend/server.py's routes are
     defined the same way, with no "/api" prefix. This one line is the only
     place that needs to know which environment is running:

       - Local dev: the FastAPI server listens on 127.0.0.1:8000 directly,
         so "/quiz/start" must resolve to "http://127.0.0.1:8000/quiz/start".
       - Vercel: the frontend and API share one origin, and api/index.py is
         reached under "/api" (see vercel.json) — so the base becomes "/api"
         and the same "/quiz/start" call resolves to "/api/quiz/start".

     This never produces "/api/api/..." because no call site ever includes
     "/api" itself — only this prefix does. */
  EduSpace.API_BASE_URL = (() => {
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
    return isLocal ? "http://127.0.0.1:8000" : "/api";
  })();

  /* ------------------------------------------------------------------
     API helper
     Wraps fetch so every caller gets the same error handling. Never throws
     a raw network error at the UI: callers get {ok, status, data, error}
     and decide what to show.
     ------------------------------------------------------------------ */
  EduSpace.api = {
    /**
     * @param {string} path   e.g. "/login"
     * @param {object} [opts] {method, body, timeoutMs}
     */
    async request(path, opts = {}) {
      const { method = "GET", body, timeoutMs = 12000 } = opts;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${EduSpace.API_BASE_URL}${path}`, {
          method,
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        let data = null;
        try {
          data = await response.json();
        } catch (err) {
          /* Non-JSON response (HTML error page, empty body). Not fatal. */
          data = null;
        }

        return {
          ok: response.ok,
          status: response.status,
          data,
          error: response.ok
            ? null
            : (data && (data.detail || data.message)) || `Request failed (${response.status}).`,
        };
      } catch (err) {
        const aborted = err && err.name === "AbortError";
        return {
          ok: false,
          status: 0,
          data: null,
          error: aborted
            ? "The server took too long to respond. Please try again."
            : "Unable to reach the EduSpace server. Make sure backend/server.py is running.",
        };
      } finally {
        clearTimeout(timer);
      }
    },

    post(path, body, opts) {
      return this.request(path, { ...opts, method: "POST", body });
    },

    /** Is the FastAPI server reachable? Used to decide what to show, never to block. */
    async isOnline() {
      const res = await this.request("/", { timeoutMs: 3000 });
      return res.ok;
    },
  };

  /* Storage keys — declared once so no page invents its own spelling. */
  const KEYS = {
    loggedIn: "eduspace_logged_in",
    user: "eduspace_user",
    progress: "eduspace_progress",
  };
  EduSpace.STORAGE_KEYS = KEYS;

  /* ------------------------------------------------------------------
     Safe localStorage helpers
     localStorage throws in private mode and on file:// in some browsers,
     and stored JSON can be corrupt. Never let that break a page.
     ------------------------------------------------------------------ */
  function readJSON(key, fallback = null) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (err) {
      console.warn(`EduSpace: could not read "${key}" from storage.`, err);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.warn(`EduSpace: could not write "${key}" to storage.`, err);
      return false;
    }
  }

  /* ------------------------------------------------------------------
     Session
     Wraps the keys login.js already writes. Do not change those key names
     without updating login.js and signup.js.
     ------------------------------------------------------------------ */
  const session = {
    /**
     * Begin a session from whatever the backend returned.
     *
     * /login forwards the Google Sheet webhook's "user" object verbatim, so
     * its shape is not guaranteed — it may be missing, partial, or use
     * capitalised keys. Normalise it here and fall back to what the student
     * typed, so the dashboard always has at least an email to show.
     *
     * @param {object|null|undefined} user     backend user object
     * @param {object} [fallback]              values known client-side
     */
    start(user, fallback = {}) {
      const source = user && typeof user === "object" ? user : {};
      const pick = (...keys) => {
        for (const key of keys) {
          const match = Object.keys(source).find((k) => k.toLowerCase() === key);
          if (match && source[match]) return String(source[match]).trim();
        }
        return "";
      };

      const normalised = {
        name: pick("name", "fullname", "student") || (fallback.name || ""),
        email: pick("email", "mail") || (fallback.email || ""),
        role: pick("role") || "Student",
        grade: pick("grade", "level") || (fallback.grade || ""),
      };

      try {
        window.localStorage.setItem(KEYS.loggedIn, "true");
      } catch (err) {
        console.warn("EduSpace: could not persist the session.", err);
      }
      writeJSON(KEYS.user, normalised);
      return normalised;
    },

    /** @returns {object|null} the stored user object, or null if signed out. */
    getUser() {
      const user = readJSON(KEYS.user, null);
      if (!user || typeof user !== "object") return null;
      /* signup.js caches a user object before login; only treat it as a
         session when the login flag is also set. */
      return this.isLoggedIn() ? user : null;
    },

    isLoggedIn() {
      try {
        return window.localStorage.getItem(KEYS.loggedIn) === "true";
      } catch (err) {
        return false;
      }
    },

    /** First name if we have one, else the part before @, else null. */
    displayName() {
      const user = this.getUser();
      if (!user) return null;
      const name = (user.name || user.fullName || "").trim();
      if (name) return name.split(/\s+/)[0];
      const email = (user.email || "").trim();
      return email ? email.split("@")[0] : null;
    },

    email() {
      const user = this.getUser();
      return user && user.email ? String(user.email).trim() : null;
    },

    clear() {
      try {
        window.localStorage.removeItem(KEYS.loggedIn);
        window.localStorage.removeItem(KEYS.user);
      } catch (err) {
        console.warn("EduSpace: could not clear session.", err);
      }
    },
  };
  EduSpace.session = session;

  /* ------------------------------------------------------------------
     Progress store
     The single source of truth the dashboard reads from. Nothing writes to
     it yet — quiz.js and learning.js are still to be built. When they are,
     they should call recordQuizAttempt() / recordTopicOpened() below and
     the dashboard will pick the data up with no further changes.

     Shape:
     {
       version: 1,
       topics: {
         "<topic id>": {
           name: string,
           opened: number,          // times the lesson was opened
           completed: boolean,
           correct: number,         // questions answered correctly
           answered: number         // questions answered in total
         }
       },
       activity: [                  // newest first, capped
         { type: "quiz"|"lesson",   // which page produced it
           kind: "answer"|"session"|"open"|"complete",  // what happened
           topic: string, detail: string, at: ISO8601 }
       ]
     }
     ------------------------------------------------------------------ */
  const ACTIVITY_LIMIT = 20;

  function emptyProgress() {
    return { version: 1, topics: {}, activity: [] };
  }

  function normaliseTopic(entry, name) {
    return {
      name: (entry && entry.name) || name || "Untitled topic",
      opened: Number(entry && entry.opened) || 0,
      completed: Boolean(entry && entry.completed),
      flagged: Boolean(entry && entry.flagged),
      correct: Number(entry && entry.correct) || 0,
      answered: Number(entry && entry.answered) || 0,
    };
  }

  /**
   * Push an activity entry, newest first.
   *
   * @param {object}  entry
   * @param {boolean} [collapseRepeat]  replace an identical consecutive entry
   *   instead of stacking. Used for lesson opens, which the student may
   *   trigger repeatedly. NOT used for answers — each answer is a distinct
   *   event and collapsing them would undercount questions answered.
   */
  function pushActivity(state, entry, collapseRepeat = false) {
    const previous = state.activity[0];
    const isRepeat =
      collapseRepeat &&
      previous &&
      previous.type === entry.type &&
      previous.topic === entry.topic &&
      previous.detail === entry.detail;
    if (isRepeat) state.activity.shift();
    state.activity.unshift(entry);
    state.activity = state.activity.slice(0, ACTIVITY_LIMIT);
  }

  const progress = {
    /** Always returns a valid, normalised progress object. */
    read() {
      const stored = readJSON(KEYS.progress, null);
      if (!stored || typeof stored !== "object") return emptyProgress();

      const topics = {};
      const rawTopics = stored.topics && typeof stored.topics === "object" ? stored.topics : {};
      Object.keys(rawTopics).forEach((id) => {
        topics[id] = normaliseTopic(rawTopics[id], id);
      });

      const activity = Array.isArray(stored.activity)
        ? stored.activity.filter((item) => item && typeof item === "object")
        : [];

      return { version: 1, topics, activity };
    },

    save(data) {
      return writeJSON(KEYS.progress, data);
    },

    /** True when there is nothing worth rendering yet. */
    isEmpty(data) {
      const state = data || this.read();
      return Object.keys(state.topics).length === 0 && state.activity.length === 0;
    },

    /** Internal: fetch-or-create a topic record and keep its name current. */
    _topic(state, topicId, topicName) {
      const topic = state.topics[topicId] || normaliseTopic(null, topicName);
      topic.name = topicName || topic.name;
      state.topics[topicId] = topic;
      return topic;
    },

    /**
     * Record one answered question.
     * Call site: quiz.js, after the student submits an answer.
     */
    recordQuizAttempt({ topicId, topicName, isCorrect, detail } = {}) {
      if (!topicId) return null;
      const state = this.read();
      const topic = this._topic(state, topicId, topicName);
      topic.answered += 1;
      if (isCorrect) topic.correct += 1;

      pushActivity(state, {
        type: "quiz",
        kind: "answer",
        topic: topic.name,
        detail: detail || (isCorrect ? "Answered correctly" : "Answered incorrectly"),
        at: new Date().toISOString(),
      });

      this.save(state);
      return state;
    },

    /**
     * Record the end of a practice session.
     * Call site: quiz.js, when the student reaches the summary.
     */
    recordQuizSession({ topicId, topicName, correct, total } = {}) {
      if (!topicId) return null;
      const state = this.read();
      const topic = this._topic(state, topicId, topicName);

      pushActivity(state, {
        type: "quiz",
        kind: "session",
        topic: topic.name,
        detail: `Finished a practice set — ${correct} of ${total} correct`,
        at: new Date().toISOString(),
      });

      this.save(state);
      return state;
    },

    /**
     * Record that a lesson was opened.
     * Call site: learning.js, when a topic is selected.
     */
    recordTopicOpened({ topicId, topicName } = {}) {
      if (!topicId) return null;
      const state = this.read();
      const topic = this._topic(state, topicId, topicName);
      topic.opened += 1;

      pushActivity(
        state,
        {
          type: "lesson",
          kind: "open",
          topic: topic.name,
          detail: "Opened the lesson",
          at: new Date().toISOString(),
        },
        true,
      );

      this.save(state);
      return state;
    },

    /**
     * Mark a topic finished, or unfinished.
     * Call site: learning.js ("Mark complete").
     */
    markTopicCompleted({ topicId, topicName, completed = true } = {}) {
      if (!topicId) return null;
      const state = this.read();
      const topic = this._topic(state, topicId, topicName);
      topic.completed = Boolean(completed);

      if (topic.completed) {
        pushActivity(state, {
          type: "lesson",
          kind: "complete",
          topic: topic.name,
          detail: "Marked the topic complete",
          at: new Date().toISOString(),
        });
      }

      this.save(state);
      return state;
    },

    /**
     * Flag a topic for review, or clear the flag. Not an activity event —
     * it is a bookmark, not something the student did.
     * Call site: learning.js ("Mark for review").
     */
    setTopicFlag({ topicId, topicName, flagged = true } = {}) {
      if (!topicId) return null;
      const state = this.read();
      this._topic(state, topicId, topicName).flagged = Boolean(flagged);
      this.save(state);
      return state;
    },

    clear() {
      try {
        window.localStorage.removeItem(KEYS.progress);
      } catch (err) {
        console.warn("EduSpace: could not clear progress.", err);
      }
    },
  };
  EduSpace.progress = progress;

  /* ------------------------------------------------------------------
     Insights — integration seam for the AI engine (NOT IMPLEMENTED)

     Every method returns null, meaning "no analysis available". The
     dashboard treats null as an empty state and never fabricates numbers.
     When the backend modules are ready, replace each body with a fetch to
     the matching endpoint; the dashboard needs no changes.

       knowledgeState()      -> backend/learning/knowledge_model.py
       misconceptions()      -> backend/ai/misconception.py
       nextRecommendation()  -> backend/learning/adaptive_engine.py
       generatedQuestions()  -> backend/ai/question_generator.py
       predictedProgress()   -> backend/learning/progress_predictor.py
       tutorNote()           -> backend/ai/tutor.py
     ------------------------------------------------------------------ */
  EduSpace.insights = {
    /* Flipped to true by refresh() once the backend reports that at least
       one pipeline stage is implemented. Until then every method below
       resolves to null and the UI shows an empty state. */
    available: false,
    status: null,

    /**
     * Ask the backend which pipeline stages exist.
     *
     * Only called when a session exists — a logged-in student means the
     * FastAPI server was reachable a moment ago. Probing from a signed-out
     * page would just log a connection error for a server that is optional
     * for browsing.
     */
    async refresh() {
      const res = await EduSpace.api.request("/insights/status", { timeoutMs: 3000 });
      this.status = res.ok ? res.data : null;
      this.available = Boolean(res.ok && res.data && res.data.available);
      return this.available;
    },

    /** Internal: return payload only when the backend says it is real. */
    async _get(path) {
      if (!this.available) return null;
      const res = await EduSpace.api.request(path, { timeoutMs: 6000 });
      if (!res.ok || !res.data || !res.data.available) return null;
      return res.data.data ?? null;
    },

    /* -> backend/learning/knowledge_model.py */
    knowledgeState(email) {
      return this._get(`/insights/knowledge?student_id=${encodeURIComponent(email || "")}`);
    },

    /* -> backend/ai/misconception.py */
    misconceptions(email) {
      return this._get(`/insights/misconceptions?student_id=${encodeURIComponent(email || "")}`);
    },

    /* -> backend/learning/adaptive_engine.py (served by POST /insights/answer) */
    async nextRecommendation() {
      return null;
    },

    /* -> backend/ai/question_generator.py */
    generatedQuestions(topicId) {
      return this._get(`/insights/questions?topic_id=${encodeURIComponent(topicId || "")}`);
    },

    /* -> backend/learning/progress_predictor.py */
    async predictedProgress() {
      return null;
    },

    /* -> backend/ai/tutor.py */
    tutorNote(topicId, email) {
      return this._get(
        `/insights/tutor-note?student_id=${encodeURIComponent(email || "")}` +
          `&topic_id=${encodeURIComponent(topicId || "")}`,
      );
    },

    /**
     * Send one answered question through the pipeline.
     * Call site: quiz.js, alongside the local progress write.
     */
    async submitAnswer(payload) {
      if (!this.available) return null;
      const res = await EduSpace.api.post("/insights/answer", payload, { timeoutMs: 6000 });
      return res.ok ? res.data : null;
    },
  };

  /* ------------------------------------------------------------------
     Small formatting helpers shared by page scripts
     ------------------------------------------------------------------ */
  EduSpace.formatRelativeTime = (isoString) => {
    const then = new Date(isoString);
    if (Number.isNaN(then.getTime())) return "";
    const seconds = Math.round((Date.now() - then.getTime()) / 1000);
    if (seconds < 60) return "Just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.round(hours / 24);
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  /* ------------------------------------------------------------------
     Shared UI behaviour
     ------------------------------------------------------------------ */
  function initNav() {
    const header = document.querySelector(".site-header");
    if (!header) return;

    const toggle = header.querySelector(".nav-toggle");
    toggle?.addEventListener("click", () => {
      const open = header.classList.toggle("nav-open");
      toggle.setAttribute("aria-expanded", String(open));
    });

    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    /* Mark the current page in the nav. */
    const here = window.location.pathname.split("/").pop() || "index.html";
    header.querySelectorAll(".nav-links a").forEach((link) => {
      if (link.getAttribute("href") === here) link.setAttribute("aria-current", "page");
    });
  }

  /* When a session exists, the header should offer Log out rather than
     Log in / Get started. Purely presentational; no page depends on it. */
  function initNavAuthState() {
    const actions = document.querySelector(".site-header .nav-actions");
    if (!actions || !session.isLoggedIn()) return;

    const name = session.displayName();
    actions.innerHTML = "";

    if (name) {
      const greeting = document.createElement("span");
      greeting.className = "nav-user";
      greeting.textContent = name;
      actions.appendChild(greeting);
    }

    const logout = document.createElement("button");
    logout.type = "button";
    logout.className = "btn btn-ghost";
    logout.textContent = "Log out";
    logout.addEventListener("click", () => {
      session.clear();
      window.location.href = "index.html";
    });
    actions.appendChild(logout);
  }

  function initReveal() {
    const items = document.querySelectorAll(".reveal");
    if (!items.length) return;

    const showAll = () => items.forEach((el) => el.classList.add("is-visible"));

    if (!("IntersectionObserver" in window)) {
      showAll();
      return;
    }

    const reveal = (el, delay) => {
      if (el.classList.contains("is-visible")) return;
      if (delay) el.style.setProperty("--reveal-delay", `${delay}ms`);
      el.classList.add("is-visible");
      io.unobserve(el);
    };

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry, i) => {
          if (!entry.isIntersecting) return;
          reveal(entry.target, i * 90);
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px" },
    );
    items.forEach((el) => io.observe(el));

    /* Safety sweep.
       During a fast flick, a mouse-wheel spin, or a jump to the bottom of the
       page, the browser coalesces IntersectionObserver callbacks and can skip
       elements entirely — leaving them at opacity 0 permanently, which reads
       as blank sections. This rAF-throttled pass reveals anything that has
       already crossed the same trigger line the observer uses, so nothing can
       stay invisible once the reader has reached it. It detaches itself once
       every element is shown. */
    const TRIGGER_OFFSET = 60; /* mirrors the observer's rootMargin */

    const sweep = () => {
      ticking = false;
      let remaining = 0;
      items.forEach((el) => {
        if (el.classList.contains("is-visible")) return;
        if (el.getBoundingClientRect().top < window.innerHeight - TRIGGER_OFFSET) reveal(el);
        else remaining += 1;
      });
      if (remaining === 0) {
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
      }
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(sweep);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
  }

  /* ------------------------------------------------------------------
     Boot
     Scripts sit at the end of <body>, so the DOM is normally parsed
     already; the guard keeps this correct if a page ever moves them.
     ------------------------------------------------------------------ */
  /* Resolves once we know whether the AI pipeline is available.
     Page scripts await this before deciding between real analysis and an
     empty state. Signed-out visitors skip the probe entirely. */
  EduSpace.insightsReady = Promise.resolve(false);

  function init() {
    initNav();
    initNavAuthState();
    initReveal();

    if (session.isLoggedIn()) {
      EduSpace.insightsReady = EduSpace.insights.refresh().catch(() => false);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
