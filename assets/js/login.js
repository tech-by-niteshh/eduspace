/* ==========================================================================
   EduSpace — login.js
   Posts to the existing FastAPI /login route, stores the session through
   EduSpace.session, then hands off to the learning page.

   Requires common.js (API helper, session, storage keys).
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const EduSpace = window.EduSpace;
  if (!EduSpace) {
    console.error("EduSpace: common.js must load before login.js.");
    return;
  }

  const loginForm = document.getElementById("login-form");
  if (!loginForm) return;

  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const statusEl = document.getElementById("login-status");
  const submitBtn = loginForm.querySelector('button[type="submit"]');

  const fieldEmail = document.getElementById("field-email");
  const fieldPassword = document.getElementById("field-password");

  /* Status colours come from .status-success / .status-error in base.css
     rather than inline styles set from here. */
  const setStatus = (message, type = "info") => {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = "form-status";
    if (type === "success") statusEl.classList.add("status-success");
    if (type === "error") statusEl.classList.add("status-error");
  };

  const toggleFieldError = (fieldEl, isError) => {
    fieldEl?.classList.toggle("has-error", isError);
  };

  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const MIN_PASSWORD = 6;

  const validateInputs = () => {
    const emailOk = EMAIL_PATTERN.test(emailInput.value.trim());
    const passwordOk = passwordInput.value.trim().length >= MIN_PASSWORD;
    toggleFieldError(fieldEmail, !emailOk);
    toggleFieldError(fieldPassword, !passwordOk);
    return emailOk && passwordOk;
  };

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setStatus("");

    if (!validateInputs()) {
      setStatus("Check the highlighted fields and try again.", "error");
      return;
    }

    const originalBtnText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Logging in…";
    setStatus("Verifying your credentials…", "info");

    const result = await EduSpace.api.post("/login", {
      email: emailInput.value.trim(),
      password: passwordInput.value,
    });

    if (result.ok && result.data && result.data.success) {
      setStatus("Login successful. Taking you to your learning path…", "success");
      EduSpace.session.start(result.data.user, { email: emailInput.value.trim() });
      setTimeout(() => {
        window.location.href = "learning.html";
      }, 900);
      return;
    }

    setStatus(result.error || "Invalid email or password.", "error");
    submitBtn.disabled = false;
    submitBtn.textContent = originalBtnText;
  });

  /* Clear the error outline as soon as the student starts correcting it. */
  [emailInput, passwordInput].forEach((input) => {
    input?.addEventListener("input", () => {
      input.closest(".field")?.classList.remove("has-error");
    });
  });
});
