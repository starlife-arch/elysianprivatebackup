const { json, parseBody, preflight, getAdmin } = require("./_helpers");
const { normalizeKenyanPhone, sendNyotaSms } = require("./_nyota");

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
  return { admin, uid: decoded.uid };
}

exports.handler = async event => {
  const options = preflight(event); if (options) return options;
  if (event.httpMethod !== "POST") return json(405, { error: "POST required" });
  try {
    const { admin } = await authenticatedAdmin(event);
    const body = parseBody(event);
    const db = admin.firestore();
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
    if (body.action === "broadcast") {
      const message = String(body.message || "").trim();
      if (!message || message.length > 1000) return json(400, { error: "Message must contain 1–1000 characters." });
      const users = await db.collection("users").get();
      const recipients = [...new Set(users.docs.map(d => normalizeKenyanPhone(d.data().phone)).filter(Boolean))];
      if (!recipients.length) return json(200, { success: true, recipientCount: 0, batches: [] });
      const batches = [];
      for (let i = 0; i < recipients.length; i += 1000) {
        const batch = recipients.slice(i, i + 1000);
        const result = await sendNyotaSms({ recipients: batch, message, idempotencyKey: `dv-broadcast-${body.broadcastId || Date.now()}-${i / 1000}` });
        batches.push({ recipientCount: batch.length, ...result });
      }
      const summary = {
        message, recipientCount: recipients.length, batches,
        sentBy: (await db.collection("users").doc((await authenticatedAdmin(event)).uid).get()).data()?.email || "",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
      await db.collection("sms_broadcasts").add(summary);
      return json(200, { success: true, recipientCount: recipients.length, batches });
    }
    return json(400, { error: "Unknown action." });
  } catch (error) {
    const status = /Authentication required|Administrator access required/.test(error.message) ? 403 : 500;
    console.error("Nyota SMS error:", error);
    return json(status, { error: error.message || "SMS request failed." });
  }
};
