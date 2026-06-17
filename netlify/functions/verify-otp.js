const { json, parseBody, preflight } = require("./_helpers");
const {
  getEmailOtps,
  hashCode,
  latestForPurpose,
  normalizeEmail,
  timingSafeEqual,
  toMillis,
  validatePurpose
} = require("./otp-utils");

exports.handler = async function(event) {
  const options = preflight(event);
  if (options) return options;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const { email, code, purpose } = parseBody(event);
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = String(code || "").replace(/\D/g, "");
  if (!normalizedEmail || !purpose || normalizedCode.length !== 6) return json(400, { error: "Missing or invalid fields" });

  try {
    validatePurpose(purpose);
  } catch (e) {
    return json(400, { error: e.message });
  }

  try {
    const now = Date.now();
    const latest = latestForPurpose(await getEmailOtps(normalizedEmail), purpose);
    if (!latest || latest.used) return json(400, { error: "Incorrect code. Please try again.", reason: "incorrect" });
    if (toMillis(latest.expiresAt) <= now) return json(400, { error: "This code has expired. Please request a new one.", reason: "expired" });

    const expected = hashCode(normalizedEmail, purpose, normalizedCode);
    if (!timingSafeEqual(expected, latest.code)) return json(400, { error: "Incorrect code. Please try again.", reason: "incorrect" });

    await latest.ref.update({ used: true, verifiedAt: new Date() });
    return json(200, { success: true });
  } catch (e) {
    console.error("OTP verification error:", e);
    return json(500, { error: e.message });
  }
};
