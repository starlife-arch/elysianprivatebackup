const { getAdmin } = require("./_helpers");
const { sendNyotaSms, normalizeKenyanPhone } = require("./_nyota");

exports.config = { schedule: "0 9 * * *" };

exports.handler = async () => {
  const admin = getAdmin();
  const db = admin.firestore();
  const now = new Date();
  const reminderDate = new Date(now.getTime() + 3 * 86400000).toISOString().slice(0, 10);
  const users = await db.collection("users").where("subscription.nextBillingDate", "==", reminderDate).get();
  const results = [];
  for (const doc of users.docs) {
    const user = doc.data();
    const phone = normalizeKenyanPhone(user.phone);
    const sentFor = user.smsPlanExpiryReminderFor || "";
    if (!phone || sentFor === reminderDate || user.subscription?.status !== "active") continue;
    const plan = user.subscription?.plan || user.plan || "membership";
    try {
      await sendNyotaSms({
        recipient: phone,
        message: `DateVault: Your ${plan} plan expires in 3 days (${reminderDate}). Renew in your account to keep your benefits.`,
        idempotencyKey: `dv-plan-expiry-${doc.id}-${reminderDate}`
      });
      await doc.ref.update({ smsPlanExpiryReminderFor: reminderDate, smsPlanExpiryReminderSentAt: admin.firestore.FieldValue.serverTimestamp() });
      results.push({ uid: doc.id, sent: true });
    } catch (error) {
      console.error("Plan expiry SMS failed for", doc.id, error.message);
      results.push({ uid: doc.id, sent: false, error: error.message });
    }
  }
  return { statusCode: 200, body: JSON.stringify({ processed: results.length, results }) };
};
