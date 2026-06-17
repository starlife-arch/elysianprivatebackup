const DIGIT_COUNT = 6;
const EXPIRED_TEXT = "This code has expired. Please request a new one.";
const INCORRECT_TEXT = "Incorrect code. Please try again.";
const BLOCKED_TEXT = "Too many attempts. Try again in 24 hours or contact support.";
const BLOCKED_SERVER_TEXT = "Too many attempts. Please try again in 24 hours or contact support.";

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function normalizeCode(value) {
  return String(value || "").replace(/\D/g, "").slice(0, DIGIT_COUNT);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function escapeHTML(value) {
  return String(value || "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  })[char]);
}

async function postJSON(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Request failed");
    error.data = data;
    throw error;
  }
  return data;
}

export function createOtpVerification({ container, email, memberName = "Member", purpose, onVerified, onBack }) {
  if (!container) throw new Error("OTP container is required");

  const state = {
    email: normalizeEmail(email),
    memberName,
    purpose,
    expiresAt: 0,
    resendAvailableAt: 0,
    resendCount: 0,
    blockedUntil: 0,
    timer: null,
    sending: false,
    verifying: false
  };

  function render() {
    container.innerHTML = `
      <div class="otp-card glass-card fade-up">
        <div class="auth-logo otp-logo">DateVault</div>
        <h2 class="otp-title">Verify your email</h2>
        <p class="otp-copy">We sent a 6-digit verification code to <strong>${escapeHTML(state.email)}</strong>.</p>
        <div class="otp-inputs" role="group" aria-label="6 digit verification code">
          ${Array.from({ length: DIGIT_COUNT }, (_, index) => `<input class="otp-digit" inputmode="numeric" autocomplete="one-time-code" maxlength="1" aria-label="Digit ${index + 1}"/>`).join("")}
        </div>
        <div class="otp-error" id="otpError" aria-live="polite"></div>
        <div class="otp-success" id="otpSuccess" aria-live="polite"></div>
        <div class="otp-timer" id="otpExpiry">Code expires in --:--</div>
        <button class="btn btn-gold btn-full" type="button" id="otpVerifyBtn">Verify Code</button>
        <button class="btn btn-outline btn-full otp-resend" type="button" id="otpResendBtn" disabled>Resend code in --:--</button>
        <p class="otp-blocked" id="otpBlocked" style="display:none;">${BLOCKED_TEXT}</p>
        ${onBack ? `<button class="otp-back" type="button" id="otpBackBtn">Use a different email</button>` : ""}
      </div>
    `;

    digitInputs().forEach((input, index) => {
      input.addEventListener("input", () => handleDigitInput(input, index));
      input.addEventListener("keydown", event => handleDigitKeydown(event, input, index));
      input.addEventListener("paste", handlePaste);
    });
    byId("otpVerifyBtn").addEventListener("click", verifyCode);
    byId("otpResendBtn").addEventListener("click", () => sendCode(true));
    const backButton = byId("otpBackBtn");
    if (backButton) backButton.addEventListener("click", onBack);
  }

  function byId(id) {
    return container.querySelector(`#${id}`);
  }

  function digitInputs() {
    return [...container.querySelectorAll(".otp-digit")];
  }

  function codeValue() {
    return digitInputs().map(input => input.value).join("");
  }

  function setError(message) {
    const error = byId("otpError");
    const success = byId("otpSuccess");
    if (success) success.textContent = "";
    if (error) error.textContent = message || "";
  }

  function setSuccess(message) {
    const error = byId("otpError");
    const success = byId("otpSuccess");
    if (error) error.textContent = "";
    if (success) success.textContent = message || "";
  }

  function applyMetadata(data = {}) {
    state.expiresAt = Number(data.expiresAt || state.expiresAt || 0);
    state.resendAvailableAt = Number(data.resendAvailableAt || state.resendAvailableAt || 0);
    state.resendCount = Number(data.resendCount ?? state.resendCount ?? 0);
    state.blockedUntil = Number(data.blockedUntil || state.blockedUntil || 0);
    updateTimers();
  }

  function updateTimers() {
    const now = Date.now();
    const expiry = byId("otpExpiry");
    const resend = byId("otpResendBtn");
    const blocked = byId("otpBlocked");
    const verify = byId("otpVerifyBtn");

    if (expiry) {
      const expired = state.expiresAt && state.expiresAt <= now;
      expiry.textContent = expired ? EXPIRED_TEXT : `Code expires in ${formatDuration(state.expiresAt - now)}`;
      expiry.classList.toggle("expired", Boolean(expired));
    }

    const isBlocked = state.blockedUntil > now || state.resendCount >= 3;
    if (blocked) blocked.style.display = isBlocked ? "block" : "none";
    if (resend) {
      resend.style.display = isBlocked ? "none" : "inline-flex";
      const canResend = state.resendAvailableAt && state.resendAvailableAt <= now && !state.sending;
      resend.disabled = !canResend;
      resend.classList.toggle("available", Boolean(canResend));
      resend.textContent = canResend ? "Resend code" : `Resend code in ${formatDuration(state.resendAvailableAt - now)}`;
    }
    if (verify) verify.disabled = state.verifying;
  }

  function handleDigitInput(input, index) {
    const value = normalizeCode(input.value);
    input.value = value.slice(-1);
    setError("");
    if (input.value && index < DIGIT_COUNT - 1) digitInputs()[index + 1].focus();
    if (codeValue().length === DIGIT_COUNT) verifyCode();
  }

  function handleDigitKeydown(event, input, index) {
    if (event.key === "Backspace" && !input.value && index > 0) digitInputs()[index - 1].focus();
  }

  function handlePaste(event) {
    const pasted = normalizeCode(event.clipboardData.getData("text"));
    if (pasted.length !== DIGIT_COUNT) return;
    event.preventDefault();
    digitInputs().forEach((input, index) => input.value = pasted[index] || "");
    digitInputs()[DIGIT_COUNT - 1].focus();
    verifyCode();
  }

  async function sendCode(isResend = false) {
    if (state.sending) return;
    state.sending = true;
    setError("");
    setSuccess(isResend ? "Sending a new code..." : "Sending your verification code...");
    updateTimers();

    try {
      const data = await postJSON("/api/send-otp-email", {
        email: state.email,
        memberName: state.memberName,
        purpose: state.purpose
      });
      digitInputs().forEach(input => input.value = "");
      digitInputs()[0]?.focus();
      applyMetadata(data);
      setSuccess(isResend ? "A new code has been sent." : "Verification code sent. Check your inbox and spam folder.");
    } catch (error) {
      applyMetadata(error.data || {});
      const message = error.data?.blockedUntil ? BLOCKED_TEXT : (error.message || "Could not send verification code.");
      setError(message === BLOCKED_SERVER_TEXT ? BLOCKED_TEXT : message);
    } finally {
      state.sending = false;
      updateTimers();
    }
  }

  async function verifyCode() {
    if (state.verifying) return;
    const code = codeValue();
    if (code.length !== DIGIT_COUNT) { setError("Enter the 6-digit code."); return; }
    if (state.expiresAt && state.expiresAt <= Date.now()) { setError(EXPIRED_TEXT); return; }

    state.verifying = true;
    const button = byId("otpVerifyBtn");
    const originalText = button?.textContent;
    if (button) button.textContent = "Verifying...";
    setError("");

    try {
      await postJSON("/api/verify-otp", { email: state.email, purpose: state.purpose, code });
      setSuccess("Email verified. Continuing...");
      setTimeout(() => onVerified?.(), 700);
    } catch (error) {
      const reason = error.data?.reason;
      const message = reason === "expired" ? EXPIRED_TEXT : reason === "incorrect" ? INCORRECT_TEXT : (error.message || INCORRECT_TEXT);
      setError(message === BLOCKED_SERVER_TEXT ? BLOCKED_TEXT : message);
      digitInputs().forEach(input => input.value = "");
      digitInputs()[0]?.focus();
    } finally {
      state.verifying = false;
      if (button) button.textContent = originalText || "Verify Code";
      updateTimers();
    }
  }

  function start() {
    render();
    clearInterval(state.timer);
    state.timer = setInterval(updateTimers, 1000);
    sendCode(false);
  }

  function destroy() {
    clearInterval(state.timer);
  }

  return { start, destroy, sendCode };
}
