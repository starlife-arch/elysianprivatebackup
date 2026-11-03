const crypto = require("crypto");

const NYOTA_URL = "https://backend.nyotaimara.com/v1/sms/send";
const TIMEOUT_MS = 8000; // Netlify cuts functions off at 10 s by default

function normalizeKenyanPhone(value) {
  let phone = String(value || "").replace(/[^0-9]/g, "");
  if (phone.startsWith("00")) phone = phone.slice(2);
  if (/^0[17][0-9]{8}$/.test(phone)) phone = "254" + phone.slice(1);
  else if (/^[17][0-9]{8}$/.test(phone)) phone = "254" + phone;
  return /^254[17][0-9]{8}$/.test(phone) ? phone : null;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Nyota only accepts a standard UUIDv4 as the idempotency key. Callers pass
// readable keys such as "dv-broadcast-<id>-0"; this turns any such text into a
// UUIDv4 deterministically, so retrying the same message still reuses the same
// key (and Nyota ignores the duplicate) instead of sending twice.
function toUuidV4(seed) {
  if (seed && UUID_V4.test(String(seed))) return String(seed).toLowerCase();
  if (!seed) return crypto.randomUUID();
  const h = crypto.createHash("sha256").update(String(seed)).digest("hex");
  const variant = "89ab"[parseInt(h[16], 16) % 4];
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Turns whatever Nyota (or the firewall in front of it) sent back into one
// short readable sentence. Never returns a whole HTML page.
function readableDetail(status, text, rayId) {
  const body = String(text || "").trim();
  if (/^\s*<(!doctype|html)/i.test(body)) {
    const title = body.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
    return `Nyota's server returned a web page instead of an API answer${title ? ` ("${title}")` : ""}` +
      `${rayId ? ` (Cloudflare Ray ID ${rayId})` : ""}. This usually means their firewall blocked the request.`;
  }
  try {
    const data = JSON.parse(body);
    const detail = data.message || data.error || data.detail;
    if (detail) return typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 300);
  } catch (_) {}
  return body.slice(0, 300) || "Nyota SMS request failed.";
}

async function sendNyotaSms({ recipients, recipient, message, idempotencyKey }) {
  const apiKey = process.env.NYOTA_API_KEY;
  if (!apiKey) {
    const error = new Error("NYOTA_API_KEY is not configured in Netlify.");
    error.code = "NYOTA_CONFIG_MISSING";
    throw error;
  }
  const normalized = [...new Set((recipients || [recipient]).map(normalizeKenyanPhone).filter(Boolean))];
  if (!normalized.length) return { successfulDispatches: 0, failedDispatches: 0, unitsDeducted: 0, skipped: true };

  // Always use the "recipients" array (the form shown in Nyota's REST docs),
  // even for one number. The single "recipient" field is an SDK convenience
  // and is not documented for the raw REST endpoint.
  const payload = { recipients: normalized, message };
  if (process.env.NYOTA_SENDER_ID) payload.senderId = process.env.NYOTA_SENDER_ID;

  let response, text;
  try {
    response = await fetch(NYOTA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // Some firewalls reject requests that have no User-Agent (Node sends none).
        "User-Agent": "DateVault-Netlify/1.0",
        "x-nyota-api-key": apiKey,
        "x-idempotency-key": toUuidV4(idempotencyKey)
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    text = await response.text();
  } catch (networkError) {
    const timedOut = networkError.name === "TimeoutError" || networkError.name === "AbortError";
    const error = new Error(timedOut
      ? `Nyota did not answer within ${TIMEOUT_MS / 1000} seconds.`
      : `Could not reach Nyota: ${networkError.cause?.code || networkError.message}`);
    error.code = timedOut ? "NYOTA_TIMEOUT" : "NYOTA_UNREACHABLE";
    error.provider = true;
    throw error;
  }

  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  if (response.status < 200 || response.status >= 300) {
    const rayId = response.headers.get("cf-ray") || "";
    const error = new Error(`Nyota returned HTTP ${response.status}: ${readableDetail(response.status, text, rayId)}`);
    error.code = response.status === 401 || response.status === 403 ? "NYOTA_AUTH_FAILED"
      : response.status === 402 ? "NYOTA_INSUFFICIENT_CREDIT"
      : response.status === 429 ? "NYOTA_RATE_LIMITED"
      : response.status >= 400 && response.status < 500 ? "NYOTA_REJECTED_REQUEST"
      : "NYOTA_PROVIDER_ERROR";
    error.statusCode = response.status;
    error.provider = true;
    throw error;
  }
  return data || {};
}

module.exports = { normalizeKenyanPhone, sendNyotaSms, toUuidV4 };
