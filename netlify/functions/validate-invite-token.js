const { json, parseBody, preflight } = require("./_helpers");
const { getAdmin, getAdminDb, toMillis } = require("./otp-utils");

async function findToken(token) {
  const snap = await getAdminDb()
    .collection("users")
    .where("inviteToken", "==", String(token || "").trim())
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { ref: doc.ref, id: doc.id, data: doc.data() };
}

function validateRecord(record, uid) {
  if (!record) return { valid: false, reason: "not_found" };
  const user = record.data;
  if (uid && record.id !== uid) return { valid: false, reason: "wrong_user" };
  if (user.inviteTokenUsed === true) return { valid: false, reason: "used" };
  const expiry = toMillis(user.inviteTokenExpiry);
  if (!expiry || expiry <= Date.now()) return { valid: false, reason: "expired" };
  return { valid: true, uid: record.id, email: user.email || "" };
}

exports.handler = async function(event) {
  const options = preflight(event);
  if (options) return options;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const { token, uid, action = "validate" } = parseBody(event);
  if (!token) return json(400, { valid: false, error: "Missing token" });

  const record = await findToken(token);
  const result = validateRecord(record, uid);
  if (!result.valid) return json(200, result);

  if (action === "mark-used") {
    await record.ref.update({
      inviteTokenUsed: true,
      inviteUsed: true,
      inviteTokenUsedAt: getAdmin().firestore.FieldValue.serverTimestamp()
    });
  }

  return json(200, { ...result, used: action === "mark-used" });
};
