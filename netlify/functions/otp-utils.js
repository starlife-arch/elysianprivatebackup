const crypto = require("crypto");

const VALID_PURPOSES = new Set(["signup", "payment", "password_reset"]);
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_WAIT_MS = 5 * 60 * 1000;
const BLOCK_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_GENERATIONS_PER_EMAIL = 10;
const MAX_RESENDS_PER_SESSION = 3;

let adminInstance = null;
let adminDb = null;

function getAdmin() {
  if (adminInstance) return adminInstance;
  const admin = require("firebase-admin");
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  adminInstance = admin;
  return adminInstance;
}

function getAdminDb() {
  if (adminDb) return adminDb;
  adminDb = getAdmin().firestore();
  return adminDb;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function validatePurpose(purpose) {
  if (!VALID_PURPOSES.has(purpose)) throw new Error("Invalid OTP purpose");
}

function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashCode(email, purpose, code) {
  const secret = process.env.OTP_HASH_SECRET || process.env.FIREBASE_SERVICE_ACCOUNT || "datevault-otp";
  return crypto
    .createHmac("sha256", secret)
    .update(`${normalizeEmail(email)}:${purpose}:${code}`)
    .digest("hex");
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ""), "hex");
  const right = Buffer.from(String(b || ""), "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return new Date(value).getTime() || 0;
}

function timestampFromMillis(ms) {
  return getAdmin().firestore.Timestamp.fromMillis(ms);
}

async function getEmailOtps(email) {
  const snapshot = await getAdminDb()
    .collection("otp_verifications")
    .where("email", "==", normalizeEmail(email))
    .get();
  return snapshot.docs.map(doc => ({ id: doc.id, ref: doc.ref, ...doc.data() }));
}

function latestForPurpose(records, purpose) {
  return records
    .filter(record => record.purpose === purpose)
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))[0] || null;
}

module.exports = {
  BLOCK_MS,
  MAX_GENERATIONS_PER_EMAIL,
  MAX_RESENDS_PER_SESSION,
  OTP_TTL_MS,
  RATE_LIMIT_WINDOW_MS,
  RESEND_WAIT_MS,
  generateOtp,
  getAdmin,
  getAdminDb,
  getEmailOtps,
  hashCode,
  latestForPurpose,
  normalizeEmail,
  timestampFromMillis,
  timingSafeEqual,
  toMillis,
  validatePurpose
};
