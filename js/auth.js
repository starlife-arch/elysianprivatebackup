import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithRedirect, getRedirectResult
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { expireSubscriptionIfNeeded, hasActiveMembership } from "./subscription.js";

export { hasActiveMembership };


const VERIFICATION_FRESHNESS_DAYS = 90;

export function verificationState(profile = {}) {
  if (profile.status !== 'active_member') return 'none';
  if (profile.verificationStatus === 'reverification_requested') return 'pending_recheck';
  const approvedAt = profile.approvedAt?.toDate ? profile.approvedAt.toDate() : new Date(profile.approvedAt);
  if (Number.isNaN(approvedAt?.getTime())) return 'verified';
  const ageDays = (Date.now() - approvedAt.getTime()) / 86400000;
  return ageDays > VERIFICATION_FRESHNESS_DAYS ? 'stale' : 'verified';
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value.toDate) return value.toDate().toISOString().slice(0, 10);
  return null;
}

function isAccessExpired(profile) {
  if (profile.status !== "active_member" || !profile.accessExpiry) return false;
  return new Date().toISOString().slice(0, 10) >= dateOnly(profile.accessExpiry);
}

async function expireAccess(uid) {
  await updateDoc(doc(db, "users", uid), {
    status: "approved_pending_payment",
    paid: false,
    adminOverride: false,
    accessExpiredAt: serverTimestamp()
  });
}

export function genMemberId() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "MBR-";
  for (let i = 0; i < 6; i++) id += c[Math.floor(Math.random() * c.length)];
  return id;
}

export function deriveStage(profile = {}) {
  const plan = profile.plan || profile.subscription?.plan || "none";
  if ((plan === "elite" || plan === "vault" || profile.stage === "elite" || profile.stage === "vault") && hasActiveMembership(profile)) return plan === "vault" ? "vault" : "elite";
  if (hasActiveMembership(profile)) return "paid";
  if (profile.adminApproved === true || profile.status === "approved_pending_invite" || profile.status === "approved_pending_payment") return "adminApproved";
  if (profile.verificationSubmitted === true || profile.status === "pending_admin_review") return "verificationSubmitted";
  if (profile.profileComplete === true) return "profileComplete";
  return profile.stage || "signedUp";
}

export function normalizeProfile(profile = {}) {
  const stage = deriveStage(profile);
  const activeMembership = hasActiveMembership({ ...profile, stage });
  const plan = activeMembership ? (profile.plan || profile.subscription?.plan || "standard") : "none";
  return {
    ...profile,
    stage,
    plan,
    emailVerified: profile.emailVerified !== false,
    profileComplete: profile.profileComplete === true,
    photosUploaded: profile.photosUploaded === true || (profile.photos || []).length > 0,
    verificationSubmitted: profile.verificationSubmitted === true || profile.status === "pending_admin_review",
    adminApproved: profile.adminApproved === true || ["approved_pending_invite", "approved_pending_payment", "active_member"].includes(profile.status),
    hasPaid: activeMembership,
    likesRemaining: Number.isFinite(profile.likesRemaining) ? profile.likesRemaining : 2,
    likesResetAt: profile.likesResetAt || null,
    lastReminderSent: profile.lastReminderSent || null,
    reminderCount: profile.reminderCount || 0,
    reminderType: profile.reminderType || null
  };
}

export async function routeUser(user) {
  if (!user) { window.location.href = "/auth/login/"; return; }
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) { window.location.href = "/auth/signup/"; return; }
  const d = normalizeProfile(snap.data());
  if (d.role === "admin")  { window.location.href = "/admin/";   return; }
  if (d.banned)            { window.location.href = "/account/suspended/"; return; }
  if (d.status === "rejected") { window.location.href = "/account/status/"; return; }
  if (d.status === "approved_pending_payment") {
    const token = d.inviteToken || d.inviteCode || "";
    window.location.href = `/account/payment/${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    return;
  }
  if (isAccessExpired(d)) {
    await expireAccess(user.uid);
  }
  window.location.href = "/app/dashboard/";
}

export async function requireMember() {
  return new Promise(resolve => {
    onAuthStateChanged(auth, async user => {
      if (!user) { window.location.href = "/auth/login/"; return; }
      const snap = await getDoc(doc(db, "users", user.uid));
      let profile = snap.exists() ? normalizeProfile(snap.data()) : null;
      if (!profile || profile.banned || isAccessExpired(profile)) {
        if (profile && isAccessExpired(profile)) await expireAccess(user.uid);
        routeUser(user); return;
      }
      const subResult = await expireSubscriptionIfNeeded(user.uid, profile);
      profile = normalizeProfile(subResult.profile);
      resolve({ user, profile });
    });
  });
}

export async function requireActiveMember() {
  const session = await requireMember();
  if (!hasActiveMembership(session.profile)) {
    window.location.href = "/app/dashboard/";
    return new Promise(() => {});
  }
  return session;
}

export async function requireAdmin() {
  return new Promise(resolve => {
    onAuthStateChanged(auth, async user => {
      if (!user) { window.location.href = "/auth/login/"; return; }
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists() || snap.data().role !== "admin") {
        window.location.href = "/auth/login/"; return;
      }
      resolve({ user, profile: snap.data() });
    });
  });
}

function initialUserData(user, fullName = '', memberId = genMemberId(), phone = '') {
  const name = fullName || user.displayName || '';
  return { uid:user.uid, memberId, email:user.email || '', name, displayName:name, phone:phone.replace(/\s/g, ''), status:'signedUp', role:'user', banned:false, paid:false, emailVerified:true, profileComplete:false, photosUploaded:false, verificationSubmitted:false, adminApproved:false, hasPaid:false, plan:'none', likesRemaining:2, likesResetAt:null, lastReminderSent:null, reminderCount:0, reminderType:null, stage:'signedUp', subscription:{ plan:'none', billing:null, status:'inactive', startDate:null, nextBillingDate:null, prioritySupportRequests:0 }, vaultBadge:false, walletBalance:0, createdAt:serverTimestamp(), photos:[], interests:[], icebreakers:[] };
}

async function completeGoogleSignIn(user) {
  const userRef = doc(db, 'users', user.uid), existing = await getDoc(userRef);
  if (!existing.exists()) {
    const data = initialUserData(user);
    await setDoc(userRef, data);
    try { await fetch('/api/telegram-notify', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({event:'user_joined', uid:user.uid, memberId:data.memberId, name:data.name, email:data.email}) }); } catch (error) { console.error('Google signup Telegram notification failed', error); }
    return { user, isNew:true };
  }
  return { user, isNew:false };
}

export async function signInWithGoogle() {
  try {
    const credential = await signInWithPopup(auth, new GoogleAuthProvider());
    return completeGoogleSignIn(credential.user);
  } catch (error) {
    if (['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(error.code)) {
      await signInWithRedirect(auth, new GoogleAuthProvider());
      return null;
    }
    throw error;
  }
}

export async function handleGoogleRedirectResult() {
  const result = await getRedirectResult(auth);
  return result ? completeGoogleSignIn(result.user) : null;
}

export async function signup(email, password, fullName = "", phone = "") {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const memberId = genMemberId();
  await setDoc(doc(db, "users", cred.user.uid), initialUserData(cred.user, fullName, memberId, phone));
  try {
    await fetch('/api/telegram-notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'user_joined', uid: cred.user.uid, memberId, name: fullName, email })
    });
  } catch(e) {}
  return cred.user;
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function logout() {
  await signOut(auth);
  window.location.href = "/";
}

export async function getProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? normalizeProfile(snap.data()) : null;
}

export { auth, db, onAuthStateChanged };
