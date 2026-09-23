// ════════════════════════════════════════════════
//  DateVault — Configuration
//  Fill in ALL values before deploying
// ════════════════════════════════════════════════

// ── Firebase ──
import './firebase-config.js';
const firebaseConfig = globalThis.DATEVAULT_FIREBASE_CONFIG;

// ── Cloudinary (photo storage) ──
const CLOUDINARY_CLOUD = "drlbhxwyv";
const CLOUDINARY_PRESET = "datevault_uploads"; // unsigned preset

// ── Pesapal (M-Pesa / Africa payments) ──
// Server-side Pesapal keys live in Netlify environment variables.

// ── Paystack (card payments — add when ready) ──
const PAYSTACK_PUBLIC_KEY = "pk_live_YOUR_PAYSTACK_KEY"; // https://dashboard.paystack.com/#/settings/developer

// ── Brevo (email) ──
// Brevo API key goes on YOUR BACKEND only — never expose in frontend
// Frontend calls /api/send-approval-email

// ── Telegram Bot (admin notifications) ──
// Bot token + chat ID go on YOUR BACKEND only
// Frontend calls /api/telegram-notify

// ── Membership price ──
const MEMBERSHIP_PRICE_USD = 29.99;
const MEMBERSHIP_PRICE_KES = 3999; // Kenya shillings

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

export async function getPricingConfig() {
  const snap = await getDoc(doc(db, 'config', 'pricing')).catch(() => null);
  const cfg = snap?.exists?.() ? snap.data() : {};
  const entryUSD = cfg.entryPromoActive ? Number(cfg.entryPromoUSD ?? 10) : Number(cfg.entryUSD ?? MEMBERSHIP_PRICE_USD);
  return {
    entryUSD,
    entryKES: Number(cfg.entryKES ?? MEMBERSHIP_PRICE_KES),
    entryPromoActive: !!cfg.entryPromoActive,
    entryPromoLabel: cfg.entryPromoLabel || '',
    entryOriginalUSD: Number(cfg.entryUSD ?? MEMBERSHIP_PRICE_USD),
    elite: { monthly: Number(cfg.elite?.monthly ?? 9.99), annual: Number(cfg.elite?.annual ?? 95.88) },
    vault: { monthly: Number(cfg.vault?.monthly ?? 24.99), annual: Number(cfg.vault?.annual ?? 239.88) },
    prioritySupportUSD: Number(cfg.prioritySupportUSD ?? 100)
  };
}

export {
  app, auth, db,
  CLOUDINARY_CLOUD, CLOUDINARY_PRESET,
  PAYSTACK_PUBLIC_KEY,
  MEMBERSHIP_PRICE_USD, MEMBERSHIP_PRICE_KES
};
