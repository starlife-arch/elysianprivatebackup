const { json } = require("./_helpers");
const { getAdmin, getAdminDb } = require("./otp-utils");

exports.config = { schedule: "@daily" };

exports.handler = async function() {
  try {
    const now = getAdmin().firestore.Timestamp.now();
    const snapshot = await getAdminDb()
      .collection("otp_verifications")
      .where("deleteAt", "<=", now)
      .limit(500)
      .get();

    const batch = getAdminDb().batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    return json(200, { success: true, deleted: snapshot.size });
  } catch (e) {
    console.error("OTP cleanup error:", e);
    return json(500, { error: e.message });
  }
};
