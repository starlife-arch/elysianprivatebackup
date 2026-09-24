import { db } from "./auth.js";
import {
  collection, getDocs, doc, updateDoc, query,
  where, serverTimestamp, addDoc, orderBy, limit, getDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


async function sendMemberNotification(type, user = {}, extra = {}) {
  if (!user.email) return null;
  const res = await fetch("/api/send-member-notification-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type, email: user.email,
      name: user.displayName || user.firstName || user.name || "Member",
      memberId: user.memberId,
      ...extra
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || res.status);
  return data;
}

async function notifyTelegram(event, uid, user = {}, extra = {}) {
  const res = await fetch("/api/telegram-notify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, uid, memberId: user.memberId, name: user.displayName || user.name || user.email, email: user.email, ...extra })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || res.status);
  return data;
}

export function genInviteCode() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "INV-";
  for (let i = 0; i < 7; i++) code += c[Math.floor(Math.random() * c.length)];
  return code;
}

export function computeRiskScore(uid, users = [], reports = []) {
  const PENDING_REPORTS_HIGH_RISK_THRESHOLD = 3;
  const PENDING_REPORTS_HIGH_RISK_SCORE = 40;
  const PENDING_REPORT_SCORE = 15;
  const ALL_TIME_REPORTS_THRESHOLD = 5;
  const ALL_TIME_REPORTS_SCORE = 20;
  const NEW_REPORTED_ACCOUNT_AGE_DAYS = 3;
  const NEW_REPORTED_ACCOUNT_SCORE = 25;
  const WALLET_ON_HOLD_SCORE = 10;
  const BANNED_SCORE = 100;
  const HIGH_VELOCITY_ACCOUNT_AGE_DAYS = 1;
  const HIGH_VELOCITY_MESSAGE_THRESHOLD = 30;
  const HIGH_VELOCITY_SCORE = 25;
  const MAX_RISK_SCORE = 100;

  const user = users.find(u => u.id === uid);
  if (!user) return { score: 0, reasons: [] };

  const reasons = [];
  let score = 0;
  const against = reports.filter(r => r.reportedUID === uid);
  const pendingAgainst = against.filter(r => (r.status || 'pending') === 'pending').length;
  if (pendingAgainst >= PENDING_REPORTS_HIGH_RISK_THRESHOLD) {
    score += PENDING_REPORTS_HIGH_RISK_SCORE;
    reasons.push(`${pendingAgainst} pending reports`);
  } else if (pendingAgainst >= 1) {
    score += PENDING_REPORT_SCORE * pendingAgainst;
    reasons.push(`${pendingAgainst} pending report(s)`);
  }
  if (against.length >= ALL_TIME_REPORTS_THRESHOLD) {
    score += ALL_TIME_REPORTS_SCORE;
    reasons.push(`${against.length} reports all-time`);
  }

  const createdAt = user.createdAt?.toDate ? user.createdAt.toDate() : new Date(user.createdAt);
  const ageDays = (Date.now() - createdAt.getTime()) / 86400000;
  if (!Number.isNaN(ageDays) && ageDays < NEW_REPORTED_ACCOUNT_AGE_DAYS && against.length > 0) {
    score += NEW_REPORTED_ACCOUNT_SCORE;
    reasons.push('New account, already reported');
  }
  if (!Number.isNaN(ageDays) && ageDays < HIGH_VELOCITY_ACCOUNT_AGE_DAYS && Number(user.messagesSentToday || 0) > HIGH_VELOCITY_MESSAGE_THRESHOLD) {
    score += HIGH_VELOCITY_SCORE;
    reasons.push('New account with high message velocity');
  }
  if (user.walletFrozen) {
    score += WALLET_ON_HOLD_SCORE;
    reasons.push('Wallet on hold');
  }
  if (user.banned) {
    score += BANNED_SCORE;
    reasons.push('Already banned');
  }

  return { score: Math.min(score, MAX_RISK_SCORE), reasons };
}

export async function fetchPayments(sinceDate = null) {
  const paymentsQuery = query(collection(db, 'payments'), where('status', '==', 'completed'), orderBy('completedAt', 'desc'), limit(500));
  const snap = await getDocs(paymentsQuery);
  const payments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (!sinceDate) return payments;
  return payments.filter(payment => {
    const value = payment.completedAt;
    const date = value?.toDate ? value.toDate() : new Date(value);
    return !Number.isNaN(date.getTime()) && date >= sinceDate;
  });
}

async function genUniqueInviteToken() {
  for (let i = 0; i < 8; i++) {
    const code = genInviteCode();
    const existing = await getDocs(query(collection(db, "users"), where("inviteToken", "==", code), limit(1)));
    if (existing.empty) return code;
  }
  return genInviteCode();
}

function inviteExpiryTimestamp() {
  return Timestamp.fromDate(new Date(Date.now() + 72 * 60 * 60 * 1000));
}

async function sendApprovalInvite(user, token, meetLink = "") {
  const emailRes = await fetch("/api/send-approval-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: user.email,
      name: user.displayName || user.firstName || "Member",
      memberId: user.memberId,
      inviteCode: token,
      inviteToken: token,
      paymentUrl: `https://elysiandate.site/account/payment/?token=${encodeURIComponent(token)}`,
      meetLink,
      videoAvailability: user.videoAvailability || ""
    })
  });
  const emailData = await emailRes.json().catch(() => ({}));
  if (!emailRes.ok || !emailData.success) throw new Error(emailData.error || emailRes.status);
  return emailData;
}

// ── Approve: generate invite code, send email, notify Telegram ──
export async function approveUser(uid, meetLink = "") {
  const existingSnap = await getDoc(doc(db, "users", uid));
  const existingProfile = existingSnap.exists() ? existingSnap.data() : {};
  // Only restore an already-paid active member after re-verification. A pending
  // applicant must always proceed to the entry-fee payment page after approval.
  const isReverification = existingProfile.status === "active_member"
    && existingProfile.verificationStatus === "reverification_requested"
    && (existingProfile.hasPaid === true || existingProfile.paid === true);
  const code = await genUniqueInviteToken();
  const approvalUpdates = {
    status: isReverification ? "active_member" : "approved_pending_payment",
    adminApproved: true,
    stage: isReverification ? "paid" : "adminApproved",
    reminderCount: 0,
    lastReminderSent: null,
    reminderType: null,
    inviteCode: code,
    inviteUsed: false,
    inviteToken: code,
    inviteTokenUsed: false,
    inviteTokenExpiry: inviteExpiryTimestamp(),
    approvedAt: serverTimestamp(),
    verificationStatus: null
  };
  // A first approval only issues an entry-fee invitation. It must not retain
  // payment or plan fields from an earlier incomplete application attempt.
  if (!isReverification) {
    Object.assign(approvalUpdates, {
      paid: false,
      hasPaid: false,
      plan: "none",
      vaultBadge: false,
      subscription: { plan: "none", billing: null, status: "inactive", startDate: null, nextBillingDate: null, prioritySupportRequests: 0 }
    });
  }
  if (meetLink) approvalUpdates.verificationMeetLink = meetLink;
  await updateDoc(doc(db, "users", uid), approvalUpdates);

  // Fetch user data for email
  const snap = await getDoc(doc(db, "users", uid));
  const user = snap.data();
  if (meetLink) {
    await addDoc(collection(db, "verification_calls"), {
      uid,
      memberId: user.memberId || "",
      memberName: user.displayName || user.name || user.email || "Member",
      email: user.email || "",
      meetLink,
      dateTime: user.videoAvailability || "User-provided availability",
      contactMethod: "email",
      status: "scheduled",
      scheduledAt: serverTimestamp()
    });
  }

  const notices = [];

  // Send welcome email via backend
  try {
    await sendApprovalInvite(user, code, meetLink);
  } catch(e) { notices.push(`Email failed: ${e.message}`); }

  // Notify Telegram
  try {
    const telegramRes = await fetch("/api/telegram-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "user_approved",
        uid, memberId: user.memberId,
        name: user.displayName || user.name || user.email,
        email: user.email || "",
        country: user.country || "—"
      })
    });
    const telegramData = await telegramRes.json().catch(() => ({}));
    if (!telegramRes.ok || telegramData.success === false) notices.push(`Telegram failed: ${telegramData.error || telegramRes.status}`);
  } catch(e) { notices.push(`Telegram failed: ${e.message}`); }

  return { code, notices };
}


export async function resendInvite(uid) {
  const code = await genUniqueInviteToken();
  await updateDoc(doc(db, "users", uid), {
    inviteCode: code,
    inviteUsed: false,
    inviteToken: code,
    inviteTokenUsed: false,
    inviteTokenExpiry: inviteExpiryTimestamp(),
    inviteResentAt: serverTimestamp()
  });
  const snap = await getDoc(doc(db, "users", uid));
  const user = snap.exists() ? snap.data() : {};
  const notices = [];
  try { await sendApprovalInvite(user, code, user.verificationMeetLink || ""); } catch(e) { notices.push(`Email failed: ${e.message}`); }
  try { await notifyTelegram("invite_resent", uid, user); } catch(e) { notices.push(`Telegram failed: ${e.message}`); }
  return { code, notices };
}

export async function rejectUser(uid, reason = "") {
  await updateDoc(doc(db, "users", uid), {
    status: "rejected",
    stage: "rejected",
    rejectionReason: reason,
    rejectedAt: serverTimestamp()
  });
  const snap = await getDoc(doc(db, "users", uid));
  const user = snap.data();
  const notices = [];

  // Send rejection email via the same Brevo-backed HTML email setup used for approvals.
  try {
    const emailRes = await fetch("/api/send-rejection-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email,
        name: user.displayName || user.firstName || user.name || "Member",
        memberId: user.memberId,
        reason
      })
    });
    const emailData = await emailRes.json().catch(() => ({}));
    if (!emailRes.ok || !emailData.success) notices.push(`Email failed: ${emailData.error || emailRes.status}`);
  } catch(e) { notices.push(`Email failed: ${e.message}`); }

  // Keep Telegram rejection notification independent from email delivery.
  try {
    const telegramRes = await fetch("/api/telegram-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "user_rejected", uid, memberId: user.memberId, name: user.displayName || user.name || user.email, email: user.email, reason })
    });
    const telegramData = await telegramRes.json().catch(() => ({}));
    if (!telegramRes.ok || telegramData.success === false) notices.push(`Telegram failed: ${telegramData.error || telegramRes.status}`);
  } catch(e) { notices.push(`Telegram failed: ${e.message}`); }

  return { notices };
}


export async function allowReapply(uid) {
  await updateDoc(doc(db, "users", uid), {
    status: "pending_verification",
    rejectionReason: "",
    reapplyAllowed: true,
    reapplyAllowedAt: serverTimestamp()
  });
  const snap = await getDoc(doc(db, "users", uid));
  const user = snap.exists() ? snap.data() : {};
  const notices = [];
  try { await sendMemberNotification("reapply_allowed", user); } catch(e) { notices.push(`Email failed: ${e.message}`); }
  try { await notifyTelegram("reapply_allowed", uid, user); } catch(e) { notices.push(`Telegram failed: ${e.message}`); }
  return { notices };
}

export async function banUser(uid) {
  await updateDoc(doc(db, "users", uid), { banned: true, bannedAt: serverTimestamp() });
  const snap = await getDoc(doc(db, "users", uid));
  const user = snap.exists() ? snap.data() : {};
  const notices = [];
  try { await sendMemberNotification("user_banned", user); } catch(e) { notices.push(`Email failed: ${e.message}`); }
  try { await notifyTelegram("user_banned", uid, user); } catch(e) { notices.push(`Telegram failed: ${e.message}`); }
  return { notices };
}

export async function unbanUser(uid) {
  await updateDoc(doc(db, "users", uid), { banned: false, unbannedAt: serverTimestamp() });
  const snap = await getDoc(doc(db, "users", uid));
  const user = snap.exists() ? snap.data() : {};
  const notices = [];
  try { await sendMemberNotification("user_unbanned", user); } catch(e) { notices.push(`Email failed: ${e.message}`); }
  try { await notifyTelegram("user_unbanned", uid, user); } catch(e) { notices.push(`Telegram failed: ${e.message}`); }
  return { notices };
}

// ── Grant access with custom duration ──
export async function grantAccess(uid, days = null) {
  const updates = {
    status: "active_member",
    paid: true,
    hasPaid: true,
    reminderCount: 0,
    lastReminderSent: null,
    reminderType: null,
    adminOverride: true,
    accessRevoked: false,
    activatedAt: serverTimestamp(),
    vaultBadge: false
  };
  if (days) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + parseInt(days));
    updates.accessExpiry = expiry.toISOString().split("T")[0];
    updates.accessDays = parseInt(days);
  } else {
    updates.accessExpiry = null;
    updates.accessDays = null;
  }
  await updateDoc(doc(db, "users", uid), updates);
  const snap = await getDoc(doc(db, "users", uid));
  const user = snap.exists() ? snap.data() : {};
  const notices = [];
  try { await sendMemberNotification("access_granted", user, { days: days || "lifetime" }); } catch(e) { notices.push(`Email failed: ${e.message}`); }
  try { await notifyTelegram("access_granted", uid, user, { days: days || "lifetime" }); } catch(e) { notices.push(`Telegram failed: ${e.message}`); }
  return { notices };
}

export async function revokeAccess(uid) {
  await updateDoc(doc(db, "users", uid), {
    status: "approved_pending_payment",
    paid: false,
    hasPaid: false,
    stage: "adminApproved",
    adminOverride: false,
    accessRevoked: true,
    accessRevokedAt: serverTimestamp(),
    subscription: { plan: "standard", billing: "included", status: "active", startDate: null, nextBillingDate: null, prioritySupportRequests: 0 },
    vaultBadge: false
  });
  const snap = await getDoc(doc(db, "users", uid));
  const user = snap.exists() ? snap.data() : {};
  const notices = [];
  try { await sendMemberNotification("access_revoked", user); } catch(e) { notices.push(`Email failed: ${e.message}`); }
  try { await notifyTelegram("access_revoked", uid, user); } catch(e) { notices.push(`Telegram failed: ${e.message}`); }
  return { notices };
}

export async function assignPlan(uid, plan, expiry = null) {
  const updates = {
    'subscription.plan': plan,
    'subscription.status': 'active',
    'subscription.adminAssigned': true,
    'subscription.assignedAt': serverTimestamp(),
    'subscription.assignedBy': 'admin',
    plan,
    hasPaid: true,
    paid: true,
    stage: plan,
    status: 'active_member'
  };
  if (expiry) {
    updates['subscription.expiresAt'] = expiry;
    updates.accessExpiry = expiry;
  }

  await updateDoc(doc(db, "users", uid), updates);
  const snap = await getDoc(doc(db, "users", uid));
  const user = snap.exists() ? snap.data() : {};
  const assignedPlanLabel = String(plan || "standard").charAt(0).toUpperCase() + String(plan || "standard").slice(1);
  const notices = [];
  try { await sendMemberNotification("plan_assigned", user, { plan: assignedPlanLabel }); } catch(e) { notices.push(`Email failed: ${e.message}`); }
  try { await notifyTelegram("plan_assigned", uid, user, { plan: assignedPlanLabel }); } catch(e) { notices.push(`Telegram failed: ${e.message}`); }
  return { notices };
}

export async function setExpiry(uid, expiryDate) {
  await updateDoc(doc(db, "users", uid), { accessExpiry: expiryDate });
}

export async function fetchAllUsers() {
  const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchReports() {
  const snap = await getDocs(query(collection(db, "reports"), orderBy("reportedAt", "desc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchVerificationCalls() {
  const snap = await getDocs(query(collection(db, "verification_calls"),
    orderBy("scheduledAt", "desc"), limit(50)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function scheduleCall(uid, meetLink, dateTime, contactMethod) {
  const usersSnap = await getDocs(query(collection(db, "users"), where("memberId", "==", uid), limit(1)));
  let resolvedUID = uid;
  let user = {};
  if (!usersSnap.empty) {
    resolvedUID = usersSnap.docs[0].id;
    user = usersSnap.docs[0].data();
  } else {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) user = snap.data();
  }
  await addDoc(collection(db, "verification_calls"), {
    uid: resolvedUID,
    memberId: user.memberId || uid,
    memberName: user.displayName || user.name || user.email || "Member",
    email: user.email || "",
    meetLink, dateTime, contactMethod,
    status: "scheduled", scheduledAt: serverTimestamp()
  });

  const notices = [];
  if (contactMethod === "email" && user.email) {
    try {
      const emailRes = await fetch("/api/send-videocall-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          memberName: user.displayName || user.name || user.email || "Member",
          dateTime,
          meetLink
        })
      });
      const emailData = await emailRes.json().catch(() => ({}));
      if (!emailRes.ok || !emailData.success) notices.push(`Email failed: ${emailData.error || emailRes.status}`);
    } catch(e) { notices.push(`Email failed: ${e.message}`); }
  }
  return { notices };
}

export async function resolveReport(reportId) {
  await updateDoc(doc(db, "reports", reportId), {
    status: "resolved", resolvedAt: serverTimestamp()
  });
}

export async function reopenReport(reportId) {
  await updateDoc(doc(db, "reports", reportId), {
    status: "pending", reopenedAt: serverTimestamp()
  });
}
