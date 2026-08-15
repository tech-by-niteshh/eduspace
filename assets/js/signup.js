/* ==========================================================================
   EduSpace — signup.js
   Posts to the existing FastAPI /signup route, then sends the student to
   the login page. No session is started here — signing up is not signing in.

   Requires common.js (API helper, session, storage keys).
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  const EduSpace = window.EduSpace;
  if (!EduSpace) {
    console.error("EduSpace: common.js must load before signup.js.");
    return;
  }

  const signupForm = document.getElementById("signup-form");
  if (!signupForm) return;

  const statusEl = document.getElementById("signup-status");
  const submitBtn = signupForm.querySelector('button[type="submit"]');

  const nameInput = document.getElementById("name");
  const emailInput = document.getElementById("email");
  const gradeInput = document.getElementById("grade");
  const passwordInput = document.getElementById("password");
  const termsCheckbox = document.getElementById("terms");

  const fieldName = document.getElementById("field-name");
  const fieldEmail = document.getElementById("field-email");
  const fieldGrade = document.getElementById("field-grade");
  const fieldPassword = document.getElementById("field-password");

  const showStatus = (message, type = "info") => {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = "form-status";
    if (type === "success") statusEl.classList.add("status-success");
    if (type === "error") statusEl.classList.add("status-error");
  };

  const setError = (fieldEl, show) => {
    fieldEl?.classList.toggle("has-error", show);
  };

  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const MIN_PASSWORD = 6;

  const validateForm = () => {
    const nameOk = Boolean(nameInput.value.trim());
    const emailOk = EMAIL_PATTERN.test(emailInput.value.trim());
    const gradeOk = Boolean(gradeInput.value);
    const passwordOk = passwordInput.value.length >= MIN_PASSWORD;

    setError(fieldName, !nameOk);
    setError(fieldEmail, !emailOk);
    setError(fieldGrade, !gradeOk);
    setError(fieldPassword, !passwordOk);

    if (!termsCheckbox.checked) {
      showStatus("Please agree to the Terms and Privacy Policy.", "error");
      return false;
    }
    return nameOk && emailOk && gradeOk && passwordOk;
  };

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showStatus("");

    if (!validateForm()) {
      if (termsCheckbox.checked) {
        showStatus("Check the highlighted fields and try again.", "error");
      }
      return;
    }

    const originalBtnText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Creating account…";
    showStatus("Connecting to EduSpace…", "info");

    const result = await EduSpace.api.post("/signup", {
      name: nameInput.value.trim(),
      email: emailInput.value.trim(),
      password: passwordInput.value,
      role: "Student",
      grade: gradeInput.value,
    });

    if (result.ok && result.data && result.data.success) {
      showStatus("Account created. Taking you to the login page…", "success");
      signupForm.reset();
      setTimeout(() => {
        window.location.href = "login.html";
      }, 1400);
      return;
    }

    showStatus(result.error || "Could not create the account. Please try again.", "error");
    submitBtn.disabled = false;
    submitBtn.textContent = originalBtnText;
  });

  [nameInput, emailInput, gradeInput, passwordInput].forEach((input) => {
    const evt = input && input.tagName === "SELECT" ? "change" : "input";
    input?.addEventListener(evt, () => {
      input.closest(".field")?.classList.remove("has-error");
    });
  });
});
