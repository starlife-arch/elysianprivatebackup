const { json, text, redirect, parseBody, preflight, fetchJSON } = require("./_helpers");

const APP_URL = (process.env.APP_URL || "https://elysiandate.site").replace("https://elysiandate.netlify.app", "https://elysiandate.site");
const SANDBOX = process.env.PESAPAL_SANDBOX === "true";
const PESAPAL_BASE = SANDBOX ? "https://cybqa.pesapal.com/pesapalv3" : "https://pay.pesapal.com/v3";

let adminDb = null;

function getAdmin() {
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  return admin;
}

function getAdminDb() {
  if (adminDb) return adminDb;
  adminDb = getAdmin().firestore();
  return adminDb;
}

async function getPesapalToken() {
  const key = process.env.PESAPAL_CONSUMER_KEY;
  const secret = process.env.PESAPAL_CONSUMER_SECRET;
  if (!key || !secret) throw new Error("Pesapal credentials not configured");

  const data = await fetchJSON(`${PESAPAL_BASE}/api/Auth/RequestToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" }
  }, { consumer_key: key, consumer_secret: secret });

  if (!data.token) throw new Error("Pesapal auth failed: " + JSON.stringify(data));
  return data.token;
}

async function getTransactionStatus(orderTrackingId) {
  const token = await getPesapalToken();
  return fetchJSON(
    `${PESAPAL_BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`,
    { headers: { "Accept": "application/json", "Authorization": `Bearer ${token}` } }
  );
}

function isCompleted(statusData) {
  return (statusData.payment_status_description || "").toUpperCase() === "COMPLETED";
}

function getUidFromReference(reference) {
  const parts = String(reference || "").split("_");
  if (parts.length >= 3 && parts[0] === "DV" && ['entry','subscription','priority_support'].includes(parts[1])) return parts[2];
  return parts.length >= 3 && parts[0] === "DV" ? parts[1] : null;
}

function planLabel(plan = "standard") {
  return ({ standard: "Standard", elite: "Elite", vault: "Vault" })[plan] || "Standard";
}

function nextBillingDate(billing = "monthly") {
  const d = new Date();
  if (billing === "annual") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

async function sendMemberEmail(type, user = {}, extra = {}) {
  if (!user.email) return;
  await fetch(`${APP_URL}/api/send-member-notification-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, email: user.email, name: user.displayName || user.firstName || user.name || "Member", memberId: user.memberId, ...extra })
  });
}

async function notifyTelegram(uid, eventName = "payment_received", extra = {}) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  let user = {};
  try {
    const snap = await getAdminDb().collection("users").doc(uid).get();
    if (snap.exists) user = snap.data();
  } catch (e) {}
  await fetch(`${APP_URL}/api/telegram-notify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: eventName,
      uid,
      memberId: user.memberId,
      name: user.displayName || user.name || user.email,
      email: user.email,
      method: "pesapal",
      ...extra
    })
  });
}

async function approveMembership(orderTrackingId, merchantReference, statusData) {
  const db = getAdminDb();
  const admin = getAdmin();
  const paymentRef = db.collection("payments").doc(merchantReference);
  const paymentSnap = await paymentRef.get();
  const payment = paymentSnap.exists ? paymentSnap.data() : {};
  const uid = payment.uid || getUidFromReference(merchantReference);
  if (!uid) throw new Error("Invalid merchant reference");

  let user = {};
  await db.runTransaction(async (txn) => {
    const userRef = db.collection("users").doc(uid);
    const userDoc = await txn.get(userRef);
    if (!userDoc.exists) throw new Error("User not found");
    user = userDoc.data();
    const purpose = payment.purpose || "entry";
    const plan = payment.plan || "standard";
    const billing = payment.billing || "monthly";

    txn.set(paymentRef, { uid, status: "completed", provider: "pesapal", orderTrackingId, merchantReference, pesapalStatus: statusData, completedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    if (purpose === "subscription") {
      txn.update(userRef, {
        subscription: { plan, billing, status: "active", startDate: new Date().toISOString(), nextBillingDate: nextBillingDate(billing), prioritySupportRequests: user.subscription?.prioritySupportRequests || 0 },
        vaultBadge: plan === "vault",
        subscriptionExpirationEmailSentFor: null,
        lastSubscriptionPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSubscriptionPaymentMethod: "pesapal"
      });
    } else if (purpose === "priority_support") {
      const reqRef = db.collection("priority_support_requests").doc();
      txn.set(reqRef, { uid, email: user.email || payment.email || "", memberName: user.displayName || user.name || payment.name || "Member", memberId: user.memberId || "", amountUSD: payment.amountUSD || 100, status: "paid_pending_admin_confirmation", paymentMethod: "pesapal", paymentReference: merchantReference, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      txn.update(userRef, { "subscription.prioritySupportRequests": admin.firestore.FieldValue.increment(1) });
    } else {
      txn.update(userRef, {
        paid: true,
        hasPaid: true,
        plan: "standard",
        stage: "paid",
        inviteTokenUsed: true,
        inviteUsed: true,
        inviteTokenUsedAt: admin.firestore.FieldValue.serverTimestamp(),
        paymentMethod: "pesapal", status: "active_member", activatedAt: admin.firestore.FieldValue.serverTimestamp(), pesapalTrackingId: orderTrackingId,
        reminderCount: 0,
        lastReminderSent: null,
        reminderType: null,
        subscription: { plan: "standard", billing: "included", status: "active", startDate: new Date().toISOString(), nextBillingDate: null, prioritySupportRequests: 0 },
        vaultBadge: false
      });
    }
  });

  if ((payment.purpose || "entry") === "subscription") {
    await notifyTelegram(uid, "subscription_payment_received", { plan: payment.plan, billing: payment.billing, amountUSD: payment.amountUSD });
    await sendMemberEmail("subscription_renewed", user, { plan: planLabel(payment.plan) });
  } else if (payment.purpose === "priority_support") {
    await notifyTelegram(uid, "priority_support_requested", { amountUSD: payment.amountUSD || 100 });
    await sendMemberEmail("priority_support_requested", user);
  } else {
    await notifyTelegram(uid, "payment_received");
    await sendMemberEmail("payment_received", user);
  }
  return uid;
}

async function handleInitiate(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "POST required" });
  const { uid, phone, email, name, amountKes, amount, amountUSD, purpose = "entry", plan = "standard", billing = "monthly", inviteToken = "" } = parseBody(event);
  if (!uid || !phone) return json(400, { error: "Missing phone or uid" });

  const db = getAdminDb();
  const token = await getPesapalToken();
  const merchantReference = `DV_${purpose}_${uid}_${Date.now()}`;
  const kesAmount = Number(amountKes || amount || 3999);

  const ipnUrl = `${APP_URL}/api/pesapal?action=ipn`;
  const ipnData = await fetchJSON(`${PESAPAL_BASE}/api/URLSetup/RegisterIPN`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": `Bearer ${token}` }
  }, { url: ipnUrl, ipn_notification_type: "GET" });

  if (!ipnData.ipn_id) throw new Error("IPN registration failed: " + JSON.stringify(ipnData));

  const callbackUrl = `${APP_URL}/api/pesapal?action=callback&merchantReference=${encodeURIComponent(merchantReference)}${inviteToken ? `&token=${encodeURIComponent(inviteToken)}` : ""}`;
  const orderData = await fetchJSON(`${PESAPAL_BASE}/api/Transactions/SubmitOrderRequest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "Authorization": `Bearer ${token}` }
  }, {
    id: merchantReference,
    currency: "KES",
    amount: kesAmount.toFixed(2),
    description: purpose === "subscription" ? `DateVault ${planLabel(plan)} Subscription` : (purpose === "priority_support" ? "DateVault Priority Support" : "DateVault Membership"),
    callback_url: callbackUrl,
    notification_id: ipnData.ipn_id,
    billing_address: {
      email_address: email || "",
      phone_number: phone,
      country_code: "KE",
      first_name: name || "Member",
      last_name: uid.slice(0, 8),
      line_1: "",
      city: "",
      state: "",
      postal_code: "",
      zip_code: ""
    }
  });

  if (!orderData.redirect_url) throw new Error("No redirect_url: " + JSON.stringify(orderData));

  await db.collection("payments").doc(merchantReference).set({
    uid,
    phone,
    email: email || "",
    name: name || "Member",
    amountKes: kesAmount,
    amountUSD: Number(amountUSD || 0),
    purpose, plan, billing, inviteToken,
    status: "pending",
    provider: "pesapal",
    orderTrackingId: orderData.order_tracking_id,
    merchantReference,
    createdAt: getAdmin().firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return json(200, {
    success: true,
    redirectUrl: orderData.redirect_url,
    orderTrackingId: orderData.order_tracking_id,
    merchantReference
  });
}

async function handleStatus(event) {
  const params = event.queryStringParameters || {};
  const body = event.httpMethod === "POST" ? parseBody(event) : {};
  const orderTrackingId = body.orderTrackingId || params.OrderTrackingId || params.orderTrackingId;
  const merchantReference = body.merchantReference || params.OrderMerchantReference || params.merchantReference;
  if (!orderTrackingId || !merchantReference) return json(400, { error: "Missing params" });

  const statusData = await getTransactionStatus(orderTrackingId);
  if (isCompleted(statusData)) {
    const uid = await approveMembership(orderTrackingId, merchantReference, statusData);
    return json(200, { success: true, completed: true, uid, status: statusData });
  }

  return json(200, { success: true, completed: false, status: statusData });
}

async function handleIpn(event) {
  const params = event.queryStringParameters || {};
  const orderTrackingId = params.OrderTrackingId;
  const merchantReference = params.OrderMerchantReference;
  if (!orderTrackingId || !merchantReference) return text(400, "Missing params");

  const statusData = await getTransactionStatus(orderTrackingId);
  if (isCompleted(statusData)) await approveMembership(orderTrackingId, merchantReference, statusData);
  return text(200, "OK");
}

function handleCallback(event) {
  const params = event.queryStringParameters || {};
  const orderTrackingId = params.OrderTrackingId || "";
  const merchantReference = params.merchantReference || params.OrderMerchantReference || "";
  const token = params.token || "";
  return redirect(`${APP_URL}/account/payment/?pesapal=callback&OrderTrackingId=${encodeURIComponent(orderTrackingId)}&OrderMerchantReference=${encodeURIComponent(merchantReference)}${token ? `&token=${encodeURIComponent(token)}` : ""}`);
}

exports.handler = async function(event) {
  const options = preflight(event);
  if (options) return options;

  const action = (event.queryStringParameters || {}).action;
  try {
    if (action === "initiate") return await handleInitiate(event);
    if (action === "status") return await handleStatus(event);
    if (action === "ipn") return await handleIpn(event);
    if (action === "callback") return handleCallback(event);
    return json(400, { error: "Unknown action" });
  } catch (e) {
    console.error("Pesapal error:", e);
    if (action === "ipn") return text(500, "Error");
    return json(500, { error: e.message });
  }
};
