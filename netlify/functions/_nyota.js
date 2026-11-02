const { fetchJSON } = require("./_helpers");
const crypto = require("crypto");

function normalizeKenyanPhone(value) {
  let phone = String(value || "").replace(/[^0-9]/g, "");
  if (phone.startsWith("00")) phone = phone.slice(2);
  if (phone.startsWith("+")) phone = phone.slice(1);
  if (/^0[17][0-9]{8}$/.test(phone)) phone = "254" + phone.slice(1);
  else if (/^[17][0-9]{8}$/.test(phone)) phone = "254" + phone;
  return /^254[17][0-9]{8}$/.test(phone) ? phone : null;
}

async function sendNyotaSms({ recipients, recipient, message, idempotencyKey }) {
  const apiKey = process.env.NYOTA_API_KEY;
  if (!apiKey) throw new Error("NYOTA_API_KEY is not configured in Netlify.");
  const normalized = [...new Set((recipients || [recipient]).map(normalizeKenyanPhone).filter(Boolean))];
  if (!normalized.length) return { successfulDispatches: 0, failedDispatches: 0, unitsDeducted: 0, skipped: true };
  const payload = normalized.length === 1
    ? { recipient: normalized[0], message, ...(process.env.NYOTA_SENDER_ID ? { senderId: process.env.NYOTA_SENDER_ID } : {}) }
    : { recipients: normalized, message, ...(process.env.NYOTA_SENDER_ID ? { senderId: process.env.NYOTA_SENDER_ID } : {}) };
  const response = await fetchJSON("https://backend.nyotaimara.com/v1/sms/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "x-nyota-api-key": apiKey,
      "x-idempotency-key": idempotencyKey || crypto.randomUUID()
    }
  }, payload);
  if (response.status < 200 || response.status >= 300) {
    throw new Error((response.data && (response.data.message || response.data.error)) || response.body || "Nyota SMS request failed.");
  }
  return response.data || {};
}

module.exports = { normalizeKenyanPhone, sendNyotaSms };
