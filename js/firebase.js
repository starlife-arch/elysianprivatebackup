// ════════════════════════════════════════════════
//  DateVault — Configuration
//  Fill in ALL values before deploying
// ════════════════════════════════════════════════

// ── Firebase ──
const firebaseConfig = {
  apiKey: "AIzaSyAu-jRmUXHvTr63jAiU9EMT4CgHhJdNM70",
  authDomain: "date-ce760.firebaseapp.com",
  projectId: "date-ce760",
  storageBucket: "date-ce760.firebasestorage.app",
  messagingSenderId: "147086773962",
  appId: "1:147086773962:web:4e20b151b6cd7b405cae33",
  measurementId: "G-4BMV27H0MJ"
};

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
import { getFirestore }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

export {
  auth, db,
  CLOUDINARY_CLOUD, CLOUDINARY_PRESET,
  PAYSTACK_PUBLIC_KEY,
  MEMBERSHIP_PRICE_USD, MEMBERSHIP_PRICE_KES
};
