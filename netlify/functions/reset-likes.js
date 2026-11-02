const { json } = require("./_helpers");
const { getAdmin, getAdminDb } = require("./otp-utils");

exports.handler = async function() {
  const admin = getAdmin();
  const db = getAdminDb();
  const now = admin.firestore.Timestamp.now();
  // The daily allowance is set by the admin (config/pricing.standardDailyLikes).
  const pricingSnap = await db.collection("config").doc("pricing").get();
  const dailyLikes = Math.max(1, Number(pricingSnap.exists ? pricingSnap.data().standardDailyLikes : 0) || 5);
  const snap = await db.collection("users")
    .where("likesResetAt", "<=", now)
    .get();
  const batch = db.batch();
  let reset = 0;
  snap.docs.forEach(doc => {
    const user = doc.data();
    const plan = user.plan || user.subscription?.plan;
    const paid = user.hasPaid === true || user.paid === true || user.status === "active_member";
    if (plan === "standard" && paid) {
      batch.update(doc.ref, { likesRemaining: dailyLikes, likesResetAt: null });
      reset++;
    }
  });
  if (reset) await batch.commit();
  return json(200, { success: true, reset });
};

exports.config = { schedule: "0 * * * *" };
