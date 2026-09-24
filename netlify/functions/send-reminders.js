const { json } = require("./_helpers");
const { getAdmin, getAdminDb, toMillis } = require("./otp-utils");

function escapeHTML(value) {
  return String(value || "").replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[c]);
}

function stageConfig(user, now) {
  const hasPaid = user.hasPaid === true || user.paid === true || user.status === "active_member";
  const adminApproved = user.adminApproved === true || ["approved_pending_invite", "approved_pending_payment", "active_member"].includes(user.status);
  const profileComplete = user.profileComplete === true;
  if (user.emailVerified !== false && !profileComplete) return { type: "profile_incomplete", wait: 24, base: user.createdAt, fromName: process.env.EMAIL_ALERTS_NAME, from: process.env.EMAIL_ALERTS, subject: "Complete your DateVault profile", body: "your DateVault account is set up but your profile isn't complete yet. Complete your profile to start the verification process and unlock the platform.", cta: "Complete Profile", url: "/app/profile/" };
  if (profileComplete && !adminApproved) return { type: "awaiting_verification", wait: 24, base: user.profileCompletedAt || user.updatedAt || user.createdAt, fromName: process.env.EMAIL_ALERTS_NAME, from: process.env.EMAIL_ALERTS, subject: "Start your DateVault verification", body: "your profile looks great. The next step is identity verification. Submit your ID and selfie to get reviewed by our team.", cta: "Start Verification", url: "/account/verification/" };
  if (adminApproved && !hasPaid) return { type: "approved_not_paid", wait: 12, base: user.approvedAt || user.createdAt, fromName: process.env.EMAIL_PAYMENT_NAME, from: process.env.EMAIL_PAYMENT, subject: "Unlock your DateVault membership", body: "great news — you've been approved! Pay the one-time entry fee of $29.99 to unlock DateVault and start meeting people.", cta: "Pay Now", url: `/account/payment/?token=${encodeURIComponent(user.inviteToken || "")}` };
  if (hasPaid && (user.plan === "standard" || user.subscription?.plan === "standard")) return { type: "paid_not_upgraded", wait: 48, base: user.activatedAt || user.paymentCompletedAt || user.createdAt, fromName: process.env.EMAIL_PAYMENT_NAME, from: process.env.EMAIL_PAYMENT, subject: "Explore Elite and Vault benefits", body: "you're in! Did you know Elite and Vault members get access to seeing who liked them, premium filters, boosts, read receipts, and Vault concierge features? Upgrade anytime from your dashboard.", cta: "View Plans", url: "/pricing.html" };
  return null;
}

async function sendEmail({ email, name, cfg }) {
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) throw new Error("Brevo not configured");
  const appUrl = (process.env.APP_URL || "https://elysiandate.site").replace("https://elysiandate.netlify.app", "https://elysiandate.site");
  const safeName = escapeHTML(name || "Member");
  const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head><body style="margin:0;padding:0;background:#060810;font-family:Arial,sans-serif;color:#f0f2f8;"><div style="max-width:560px;margin:0 auto;background:#060810;"><div style="background:#0d1120;padding:40px;text-align:center;border-bottom:1px solid rgba(201,168,76,0.2);"><div style="font-family:Georgia,serif;font-size:32px;color:#e8cb7a;letter-spacing:0.2em;">DateVault</div><div style="color:#6b7a99;font-size:13px;letter-spacing:0.1em;margin-top:8px;">PRIVATE MEMBERSHIP</div></div><div style="padding:40px;"><h1 style="font-family:Georgia,serif;font-weight:400;color:#f0f2f8;">DateVault reminder</h1><p style="color:rgba(240,242,248,0.75);font-size:15px;line-height:1.7;">Hi ${safeName}, ${escapeHTML(cfg.body)}</p><a href="${appUrl}${cfg.url}" style="display:block;background:#c9a84c;color:#1a1200;text-decoration:none;padding:16px 32px;border-radius:999px;font-weight:600;text-align:center;margin:28px 0;">${escapeHTML(cfg.cta)}</a></div></div></body></html>`;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "Accept":"application/json", "Content-Type":"application/json", "api-key": BREVO_API_KEY },
    body: JSON.stringify({ sender: {
        email: cfg.from,
        name: cfg.fromName
      }, to: [{ email, name: safeName }], subject: cfg.subject, htmlContent })
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Email send failed");
}

exports.handler = async function() {
  const admin = getAdmin();
  const db = getAdminDb();
  const now = Date.now();
  const snap = await db.collection("users").get();
  let sent = 0, skipped = 0, failed = 0;
  for (const doc of snap.docs) {
    const user = doc.data();
    const cfg = stageConfig(user, now);
    if (!cfg || !user.email || (user.reminderCount || 0) >= 2) { skipped++; continue; }
    const last = toMillis(user.lastReminderSent);
    const base = toMillis(cfg.base);
    const dueFrom = last || base;
    if (!dueFrom || now - dueFrom < cfg.wait * 60 * 60 * 1000) { skipped++; continue; }
    try {
      await sendEmail({ email: user.email, name: user.displayName || user.name, cfg });
      await doc.ref.update({ lastReminderSent: admin.firestore.FieldValue.serverTimestamp(), reminderCount: (user.reminderCount || 0) + 1, reminderType: cfg.type });
      sent++;
    } catch (e) { failed++; console.error(`Reminder failed for ${doc.id}:`, e.message); }
  }
  return json(200, { success: true, sent, skipped, failed });
};

exports.config = { schedule: "0 */6 * * *" };
