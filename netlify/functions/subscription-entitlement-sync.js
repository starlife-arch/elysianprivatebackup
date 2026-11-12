const { getAdmin, json, preflight } = require("./_helpers");

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") return /^\\d{4}-\\d{2}-\\d{2}$/.test(value) ? value : null;
  if (typeof value.toDate === "function") return value.toDate().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return null;
}

exports.handler = async event => {
  const options = preflight(event);
  if (options) return options;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
  try {
    const header = event.headers?.authorization || event.headers?.Authorization || "";
    const token = header.replace(/^Bearer\\s+/i, "").trim();
    if (!token) return json(401, { error: "Sign in is required." });
    const admin = getAdmin();
    const decoded = await admin.auth().verifyIdToken(token);
    const userRef = admin.firestore().collection("users").doc(decoded.uid);
    const snap = await userRef.get();
    if (!snap.exists) return json(404, { error: "Member profile not found." });
    const profile = snap.data() || {};
    const sub = profile.subscription || {};
    const plan = sub.plan || profile.plan || "standard";
    if (!["elite", "vault"].includes(plan) || sub.status !== "active") {
      return json(200, { synced: false, plan: "standard", reason: "no_active_premium_subscription" });
    }
    const expiry = dateOnly(sub.nextBillingDate);
    if (!expiry || Number.isNaN(Date.parse(expiry))) {
      return json(200, { synced: false, plan: "standard", reason: "missing_or_invalid_expiry" });
    }
    const expiryAt = admin.firestore.Timestamp.fromDate(new Date(expiry + "T23:59:59.999Z"));
    const now = new Date();
    if (now.toISOString().slice(0, 10) > expiry) {
      await userRef.update({
        "subscription.previousPlan": sub.plan || plan,
        "subscription.plan": "standard",
        "subscription.billing": "included",
        "subscription.status": "expired",
        "subscription.expiredAt": now.toISOString(),
        "subscription.expiredBillingDate": sub.nextBillingDate,
        "subscription.nextBillingDate": null,
        "subscription.nextBillingAt": null,
        vaultBadge: false
      });
      return json(200, { synced: true, expired: true, plan: "standard" });
    }
    if (!sub.nextBillingAt || typeof sub.nextBillingAt.toMillis !== "function"
        || sub.nextBillingAt.toMillis() !== expiryAt.toMillis()) {
      await userRef.update({ "subscription.nextBillingAt": expiryAt });
    }
    return json(200, { synced: true, plan, expiresAt: expiryAt.toDate().toISOString() });
  } catch (error) {
    console.error("Subscription entitlement sync failed:", error.message);
    return json(401, { error: "Could not verify your membership entitlement." });
  }
};
