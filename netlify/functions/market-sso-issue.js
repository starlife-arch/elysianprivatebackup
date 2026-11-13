const crypto = require("crypto");
const { json, preflight, getAdmin } = require("./_helpers");

function bearerToken(event) {
  const headers = event.headers || {};
  const value = headers.authorization || headers.Authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function originAllowed(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  if (!origin) return true;
  const configured = String(process.env.MARKET_SSO_ALLOWED_ORIGINS || "https://elysiandate.site,https://www.elysiandate.site")
    .split(",").map(value => value.trim()).filter(Boolean);
  return configured.includes(origin);
}

function eligibleForMarket(profile = {}) {
  // Creator Market is available to every authenticated account unless an
  // explicit platform safety restriction blocks access. Dating membership,
  // payment, trial, application, and profile lifecycle are separate concerns.
  return !(
    profile.banned === true ||
    profile.suspended === true ||
    profile.accountSuspended === true ||
    profile.marketBanned === true
  );
}

exports.handler = async event => {
  const options = preflight(event);
  if (options) return options;
  if (event.httpMethod !== "POST") return json(405, { error: "POST required" });
  if (!originAllowed(event)) return json(403, { error: "Origin not allowed" });

  try {
    const requestBody = event.body ? JSON.parse(event.body) : {};
    const destination = requestBody.destination === "/admin" ? "/admin" : "/member";
    const token = bearerToken(event);
    if (!token) return json(401, { error: "Authentication required." });

    const admin = getAdmin();
    const decoded = await admin.auth().verifyIdToken(token);
    const db = admin.firestore();
    const userRef = db.collection("users").doc(decoded.uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return json(403, { error: "Complete your DateVault account before opening Creator Market." });

    const profile = userSnap.data() || {};
    if (destination === "/admin" && profile.role !== "admin" && profile.isAdmin !== true) {
      return json(403, { error: "DateVault administrator access is required for Market Admin." });
    }
    if (!eligibleForMarket(profile)) {
      return json(403, { error: "This DateVault account is not currently eligible for Creator Market." });
    }

    // Only the SHA-256 digest is stored. The raw code is returned once to the
    // authenticated browser and is valid for one redemption within 2 minutes.
    const code = crypto.randomBytes(32).toString("base64url");
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const now = admin.firestore.Timestamp.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + 2 * 60 * 1000);

    await db.collection("creatorMarketSsoCodes").doc(codeHash).create({
      uid: decoded.uid,
      audience: "market.elysiandate.site",
      destination,
      createdAt: now,
      expiresAt
    });

    const callbackUrl = process.env.MARKET_SSO_CALLBACK_URL || "https://market.elysiandate.site/sso-callback.html";
    const callback = new URL(callbackUrl);
    const allowedCallbackHosts = new Set(["market.elysiandate.site", "deploy-preview-1--marketelysiandate.netlify.app", "deploy-preview-2--marketelysiandate.netlify.app"]);
    if (callback.protocol !== "https:" || !allowedCallbackHosts.has(callback.hostname) || callback.pathname !== "/sso-callback.html") {
      throw new Error("MARKET_SSO_CALLBACK_URL is not an approved HTTPS callback");
    }
    callback.searchParams.set("code", code);
    return json(200, {
      success: true,
      redirectUrl: callback.toString(),
      expiresInSeconds: 120
    });
  } catch (error) {
    if (error.code === "auth/id-token-expired" || error.code === "auth/argument-error") {
      return json(401, { error: "Your DateVault session has expired. Please sign in again." });
    }
    console.error("Creator Market SSO issue failed:", error.message);
    return json(500, { error: "Could not start Creator Market sign-in." });
  }
};
