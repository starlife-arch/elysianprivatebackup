const { json, parseBody, preflight } = require("./_helpers");
const { getAdmin, getAdminDb, toMillis } = require("./otp-utils");

async function markInviteTokenUsed(uid, token) {
  if (!uid || !token) return;
  const snap = await getAdminDb()
    .collection("users")
    .where("inviteToken", "==", String(token).trim())
    .limit(1)
    .get();
  if (snap.empty) throw new Error("Invite token not found");
  const doc = snap.docs[0];
  const user = doc.data();
  if (doc.id !== uid) throw new Error("Invite token does not belong to this user");
  if (user.inviteTokenUsed === true) throw new Error("Invite token already used");
  const expiry = toMillis(user.inviteTokenExpiry);
  if (!expiry || expiry <= Date.now()) throw new Error("Invite token expired");
  await doc.ref.update({
    inviteTokenUsed: true,
    inviteUsed: true,
    inviteTokenUsedAt: getAdmin().firestore.FieldValue.serverTimestamp()
  });
}

exports.handler = async function(event) {
  const options = preflight(event);
  if (options) return options;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const { reference, uid, inviteToken } = parseBody(event);
  if (!reference || !uid) return json(400, { error: "Missing fields" });

  const SECRET = process.env.PAYSTACK_SECRET_KEY;
  if (!SECRET) return json(500, { error: "Paystack not configured" });

  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { "Authorization": `Bearer ${SECRET}` }
    });
    const data = await response.json();
    if (data.data?.status === "success") {
      if (inviteToken) await markInviteTokenUsed(uid, inviteToken);
      return json(200, { success: true });
    }
    return json(400, { error: "Payment not successful", status: data.data?.status });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
