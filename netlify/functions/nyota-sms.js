const { json, parseBody, preflight, getAdmin } = require("./_helpers");
const crypto = require("crypto");
const { normalizeKenyanPhone, sendNyotaSms } = require("./_nyota");

const BROADCAST_CHUNK = 500; // keeps each request well inside Netlify's 10 s limit

function eventMessage(event, data = {}) {
  const name = String(data.name || "Member").slice(0, 50);
  const plan = String(data.plan || "your plan").slice(0, 30);
  const amount = data.amountKes ? " KES " + Number(data.amountKes).toLocaleString("en-KE") : "";
  const messages = {
    user_banned: `DateVault: Hello ${name}, your account has been suspended. Contact support if you believe this is an error.`,
    user_unbanned: `DateVault: Hello ${name}, your account suspension has been lifted. You can sign in again.`,
    plan_assigned: `DateVault: ${name}, an administrator has assigned you the ${plan} plan. Sign in to enjoy your membership.`,
    access_granted: `DateVault: Hello ${name}, an administrator has granted you membership access. Sign in to get started.`,
    kyc_approved: `DateVault: Hello ${name}, your identity verification has been approved. Thank you.`,
    purchase_plan: `DateVault: Payment confirmed. Your ${plan} plan is active.${amount} Thank you.`,
    purchase_tokens: `DateVault: Payment confirmed. ${Number(data.tokens || 0).toLocaleString()} tokens have been added to your wallet.${amount}`,
    purchase_other: `DateVault: Your purchase was confirmed.${amount} Thank you.`
  };
  return messages[event] || null;
}

async function authenticatedAdmin(event) {
  const authorization = event.headers?.authorization || event.headers?.Authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Authentication required.");
  const admin = getAdmin();
  const decoded = await admin.auth().verifyIdToken(match[1]);
  const user = await admin.firestore().collection("users").doc(decoded.uid).get();
  if (!user.exists || user.data().role !== "admin") throw new Error("Administrator access required.");
  return { admin, uid: decoded.uid, email: user.data().email || "" };
}

exports.handler = async event => {
  const options = preflight(event); if (options) return options;
  if (event.httpMethod !== "POST") return json(405, { error: "POST required" });
  try {
    const { admin, uid: adminUid, email: adminEmail } = await authenticatedAdmin(event);
    const body = parseBody(event);
    const db = admin.firestore();
    if (body.action === "health") {
      return json(200, { success: true, firebaseAdmin: true, nyotaApiKeyConfigured: Boolean(process.env.NYOTA_API_KEY), senderIdConfigured: Boolean(process.env.NYOTA_SENDER_ID), senderId: process.env.NYOTA_SENDER_ID ? 'configured' : 'Nyota default' });
    }
    if (body.action === "send") {
      const allowed = ["user_banned", "user_unbanned", "plan_assigned", "access_granted", "kyc_approved"];
      if (!allowed.includes(body.event) || !body.uid) return json(400, { error: "Invalid notification event or user." });
      const snap = await db.collection("users").doc(String(body.uid)).get();
      if (!snap.exists) return json(404, { error: "User not found." });
      const user = snap.data();
      const recipient = normalizeKenyanPhone(user.phone);
      if (!recipient) return json(200, { success: true, skipped: true, reason: "No valid phone number on account." });
      const message = eventMessage(body.event, { name: user.displayName || user.name, plan: body.plan });
      const result = await sendNyotaSms({ recipient, message, idempotencyKey: `dv-${body.event}-${body.uid}-${body.eventId || Date.now()}` });
      return json(200, { success: true, result });
    }
    if (body.action === "history") {
      const history = await db.collection("sms_broadcasts").orderBy("createdAt", "desc").limit(25).get();
      return json(200, { success: true, broadcasts: history.docs.map(doc => ({ id: doc.id, ...doc.data(), createdAt: doc.data().createdAt?.toDate?.().toISOString?.() || null })) });
    }
    if (body.action === "diagnose") {
      // Calls Nyota with no recipients: nothing is sent and no units are used, but
      // the answer shows whether the key is accepted and whether Nyota is reachable.
      const apiKey = process.env.NYOTA_API_KEY;
      if (!apiKey) return json(200, { success: false, code: "NYOTA_CONFIG_MISSING", error: "NYOTA_API_KEY is not configured in Netlify." });
      try {
        const res = await fetch("https://backend.nyotaimara.com/v1/sms/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "DateVault-Netlify/1.0", "x-nyota-api-key": apiKey, "x-idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ message: "connection test", recipients: [] }),
          signal: AbortSignal.timeout(8000)
        });
        const text = await res.text();
        const isHtml = /^\s*<(!doctype|html)/i.test(text);
        const verdict = res.status === 401 || res.status === 403
          ? (isHtml ? "Blocked by Nyota's firewall (the request never reached their API)." : "Nyota rejected the API key.")
          : res.status === 400 || res.status === 422 ? "Nyota is reachable and the key was not rejected. A complaint about missing or empty recipients is the expected answer for this empty test."
          : res.status < 500 ? "Nyota is reachable and answered normally."
          : "Nyota itself returned a server error.";
        return json(200, { success: true, nyotaHttpStatus: res.status, verdict, cfRay: res.headers.get("cf-ray") || null, answer: isHtml ? "(web page, hidden)" : text.slice(0, 300) });
      } catch (e) {
        return json(200, { success: false, code: "NYOTA_UNREACHABLE", error: `Could not reach Nyota from Netlify: ${e.cause?.code || e.message}` });
      }
    }
    if (body.action === "broadcast_count" || body.action === "broadcast") {
      const message = String(body.message || "").trim();
      const users = await db.collection("users").get();
      const recipients = [...new Set(users.docs.filter(d => d.data().smsOptOut !== true).map(d => normalizeKenyanPhone(d.data().phone)).filter(Boolean))].sort();
      if (body.action === "broadcast_count") return json(200, { success: true, recipientCount: recipients.length });
      if (!message || message.length > 1000) return json(400, { error: "Message must contain 1–1000 characters." });
      if (!body.broadcastId) return json(400, { error: "Missing broadcastId." });
      if (!recipients.length) return json(200, { success: true, recipientCount: 0, sent: 0, nextOffset: 0, done: true });

      // The page calls this once per chunk, so no single request runs long enough to time out.
      const offset = Math.max(0, Number(body.offset) || 0);
      const chunk = recipients.slice(offset, offset + BROADCAST_CHUNK);
      let result = { successfulDispatches: 0, failedDispatches: 0, unitsDeducted: 0 };
      if (chunk.length) {
        result = await sendNyotaSms({ recipients: chunk, message, idempotencyKey: `dv-broadcast-${body.broadcastId}-${offset}` });
      }
      const nextOffset = offset + chunk.length;
      const summaryRef = db.collection("sms_broadcasts").doc(String(body.broadcastId));
      const update = {
        message, recipientCount: recipients.length, sentBy: adminEmail, sentByUid: adminUid,
        successfulDispatches: admin.firestore.FieldValue.increment(Number(result.successfulDispatches) || 0),
        unitsDeducted: admin.firestore.FieldValue.increment(Number(result.unitsDeducted) || 0),
        batches: admin.firestore.FieldValue.arrayUnion({ offset, recipientCount: chunk.length, successfulDispatches: Number(result.successfulDispatches) || 0, failedDispatches: Number(result.failedDispatches) || 0 })
      };
      if (offset === 0) update.createdAt = admin.firestore.FieldValue.serverTimestamp();
      await summaryRef.set(update, { merge: true });
      return json(200, {
        success: true, recipientCount: recipients.length, nextOffset, done: nextOffset >= recipients.length,
        successfulDispatches: Number(result.successfulDispatches) || 0, failedDispatches: Number(result.failedDispatches) || 0
      });
    }
    return json(400, { error: "Unknown action." });
  } catch (error) {
    const message = error.message || "SMS request failed.";
    // IMPORTANT: never answer with 502 or 504. Cloudflare (in front of the site)
    // replaces those two statuses with its own "Bad gateway" page, which hides
    // the real reason. Provider problems use 424 instead so the message gets through.
    let status = 500;
    if (/Authentication required/.test(message)) status = 401;
    else if (/Administrator access required/.test(message)) status = 403;
    else if (error.provider || error.code === "NYOTA_CONFIG_MISSING") status = 424;
    const code = error.code || (status === 401 ? "AUTH_REQUIRED" : status === 403 ? "ADMIN_REQUIRED" : "NYOTA_SMS_INTERNAL_ERROR");
    console.error("Nyota SMS error:", { code, status, message, upstreamStatus: error.statusCode, stack: error.stack });
    return json(status, { success: false, code, error: message, upstreamStatus: error.statusCode || null });
  }
};
