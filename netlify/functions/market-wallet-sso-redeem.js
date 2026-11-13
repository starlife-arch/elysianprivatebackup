const crypto = require("crypto");
const { json, preflight, parseBody, getAdmin } = require("./_helpers");

function originAllowed(event) {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  return !origin || ["https://elysiandate.site", "https://www.elysiandate.site"].includes(origin);
}

exports.handler = async event => {
  const options = preflight(event);
  if (options) return options;
  if (event.httpMethod !== "POST") return json(405, { error: "POST required" });
  if (!originAllowed(event)) return json(403, { error: "Origin not allowed" });
  try {
    const { code } = parseBody(event);
    if (typeof code !== "string" || code.length < 32 || code.length > 256) {
      return json(400, { error: "A valid wallet sign-in code is required." });
    }
    const admin = getAdmin();
    const db = admin.firestore();
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const codeRef = db.collection("creatorMarketWalletSsoCodes").doc(codeHash);
    let uid = "";
    await db.runTransaction(async tx => {
      const codeSnap = await tx.get(codeRef);
      if (!codeSnap.exists) throw new Error("WALLET_SSO_INVALID");
      const data = codeSnap.data() || {};
      const expiresAt = data.expiresAt?.toDate ? data.expiresAt.toDate().getTime() : new Date(data.expiresAt).getTime();
      if (data.audience !== "datevault-wallet" || data.consumedAt ||
          !Number.isFinite(expiresAt) || expiresAt <= Date.now() ||
          typeof data.uid !== "string" || !data.uid) throw new Error("WALLET_SSO_INVALID");
      const userRef = db.collection("users").doc(data.uid);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new Error("WALLET_SSO_INVALID");
      const profile = userSnap.data() || {};
      if (profile.banned === true || profile.suspended === true ||
          profile.accountSuspended === true || profile.marketBanned === true) {
        throw new Error("WALLET_SSO_RESTRICTED");
      }
      uid = data.uid;
      tx.update(codeRef, { consumedAt: admin.firestore.FieldValue.serverTimestamp() });
    });
    const customToken = await admin.auth().createCustomToken(uid);
    return json(200, { ok: true, customToken });
  } catch (error) {
    if (error.message === "WALLET_SSO_INVALID") return json(401, { error: "This wallet sign-in link is invalid, expired, or already used. Return to Market and try again." });
    if (error.message === "WALLET_SSO_RESTRICTED") return json(403, { error: "This account is restricted from DateVault services." });
    console.error("Market wallet SSO redemption failed:", error.message);
    return json(500, { error: "Unable to connect your shared wallet." });
  }
};
