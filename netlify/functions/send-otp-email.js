const { json, parseBody, preflight } = require("./_helpers");
const {
  BLOCK_MS,
  MAX_GENERATIONS_PER_EMAIL,
  MAX_RESENDS_PER_SESSION,
  OTP_TTL_MS,
  RATE_LIMIT_WINDOW_MS,
  RESEND_WAIT_MS,
  generateOtp,
  getAdminDb,
  getEmailOtps,
  hashCode,
  latestForPurpose,
  normalizeEmail,
  timestampFromMillis,
  toMillis,
  validatePurpose
} = require("./otp-utils");

const PURPOSE_COPY = {
  signup: {
    subject: "Verify your email — DateVault",
    intro: "Enter this code to confirm your email address and complete your application."
  },
  payment: {
    subject: "Confirm your identity — DateVault",
    intro: "Enter this code to verify your identity before proceeding to payment."
  },
  password_reset: {
    subject: "Password reset verification — DateVault",
    intro: "Enter this code to confirm it's you before resetting your password."
  }
};

function escapeHTML(value) {
  return String(value || "").replace(/[&<>'"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  })[char]);
}

function emailTemplate({ code, intro, memberName }) {
  const safeName = escapeHTML(memberName || "Member");
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#060810;font-family:Arial,sans-serif;color:#f0f2f8;">
  <div style="max-width:560px;margin:0 auto;background:#060810;">
    <div style="background:#0d1120;padding:40px;text-align:center;border-bottom:1px solid rgba(201,168,76,0.2);">
      <div style="font-family:Georgia,serif;font-size:32px;color:#e8cb7a;letter-spacing:0.2em;">DateVault</div>
      <div style="color:#6b7a99;font-size:13px;letter-spacing:0.1em;margin-top:8px;">PRIVATE MEMBERSHIP</div>
    </div>
    <div style="padding:40px;">
      <h1 style="font-family:Georgia,serif;font-weight:400;color:#f0f2f8;">Hi ${safeName}.</h1>
      <p style="color:rgba(240,242,248,0.75);font-size:15px;line-height:1.7;">${intro}</p>
      <div style="background:rgba(201,168,76,0.1);border:2px solid rgba(201,168,76,0.4);border-radius:16px;padding:24px;text-align:center;margin:24px 0;">
        <div style="color:#6b7a99;font-size:12px;letter-spacing:0.1em;margin-bottom:8px;">YOUR VERIFICATION CODE</div>
        <div style="font-family:Georgia,serif;font-size:40px;color:#c9a84c;letter-spacing:0.18em;font-weight:600;">${code}</div>
        <div style="color:#6b7a99;font-size:13px;margin-top:8px;">This code expires in 10 minutes.</div>
      </div>
      <p style="color:rgba(240,242,248,0.75);font-size:15px;line-height:1.7;">If you did not request this code, please ignore this email. If you believe someone is attempting to access your account, contact our support team immediately.</p>
    </div>
  </div>
</body>
</html>`;
}

exports.handler = async function(event) {
  const options = preflight(event);
  if (options) return options;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const { email, memberName, purpose } = parseBody(event);
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !purpose) return json(400, { error: "Missing required fields" });

  try {
    validatePurpose(purpose);
  } catch (e) {
    return json(400, { error: e.message });
  }

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const FROM_EMAIL = process.env.EMAIL_VERIFY || process.env.FROM_EMAIL || "noreply@datevault.com";
  const FROM_NAME = process.env.FROM_NAME || "DateVault";
  if (!BREVO_API_KEY) return json(500, { error: "Brevo not configured" });

  try {
    const now = Date.now();
    const records = await getEmailOtps(normalizedEmail);
    const recentGenerations = records.filter(record => toMillis(record.createdAt) > now - RATE_LIMIT_WINDOW_MS).length;
    if (recentGenerations >= MAX_GENERATIONS_PER_EMAIL) return json(429, { error: "Too many OTP requests. Please try again later." });

    const latest = latestForPurpose(records, purpose);
    const blockedUntil = toMillis(latest?.blockedUntil);
    if (blockedUntil > now) {
      return json(429, {
        error: "Too many attempts. Please try again in 24 hours or contact support.",
        blockedUntil
      });
    }

    const resendCount = latest && !latest.used && toMillis(latest.expiresAt) > now ? Number(latest.resendCount || 0) : 0;
    if (latest && !latest.used && toMillis(latest.createdAt) + RESEND_WAIT_MS > now) {
      return json(429, {
        error: "Please wait before requesting another code.",
        resendAvailableAt: toMillis(latest.createdAt) + RESEND_WAIT_MS,
        expiresAt: toMillis(latest.expiresAt),
        resendCount
      });
    }

    if (resendCount >= MAX_RESENDS_PER_SESSION) {
      const until = now + BLOCK_MS;
      if (latest?.ref) await latest.ref.update({ blockedUntil: timestampFromMillis(until) });
      return json(429, {
        error: "Too many attempts. Please try again in 24 hours or contact support.",
        blockedUntil: until
      });
    }

    const nextResendCount = latest && !latest.used && toMillis(latest.expiresAt) > now ? resendCount + 1 : 0;
    const code = generateOtp();
    const expiresAt = now + OTP_TTL_MS;
    const deleteAt = now + BLOCK_MS;

    if (latest && !latest.used && latest.ref) await latest.ref.update({ used: true });

    const resendBlockedUntil = nextResendCount >= MAX_RESENDS_PER_SESSION ? now + BLOCK_MS : null;

    await getAdminDb().collection("otp_verifications").add({
      email: normalizedEmail,
      purpose,
      code: hashCode(normalizedEmail, purpose, code),
      createdAt: timestampFromMillis(now),
      expiresAt: timestampFromMillis(expiresAt),
      deleteAt: timestampFromMillis(deleteAt),
      used: false,
      resendCount: nextResendCount,
      blockedUntil: resendBlockedUntil ? timestampFromMillis(resendBlockedUntil) : null
    });

    const copy = PURPOSE_COPY[purpose];
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "api-key": BREVO_API_KEY
      },
      body: JSON.stringify({
        sender: {
          email: process.env.EMAIL_VERIFY,
          name: process.env.EMAIL_VERIFY_NAME
        },
        to: [{ email: normalizedEmail, name: memberName || "Member" }],
        subject: copy.subject,
        htmlContent: emailTemplate({ code, intro: copy.intro, memberName })
      })
    });
    const data = await response.json();
    if (!response.ok) return json(500, { error: data.message || "Email send failed", details: data });

    return json(200, {
      success: true,
      expiresAt,
      resendAvailableAt: now + RESEND_WAIT_MS,
      resendCount: nextResendCount,
      blockedUntil: resendBlockedUntil
    });
  } catch (e) {
    console.error("OTP email error:", e);
    return json(500, { error: e.message });
  }
};
