import { db } from "./firebase.js";
import { doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const SUBSCRIPTION_PLANS = {
  free_trial: { label: "Free Trial", rank: -1, monthly: 0, annual: 0 },
  standard: { label: "Standard", rank: 0, monthly: 0, annual: 0 },
  elite: { label: "Elite", rank: 1, monthly: 14.99, annual: 119.99 },
  vault: { label: "Vault", rank: 2, monthly: 29.99, annual: 239.99 }
};

export const PRIORITY_SUPPORT_PRICE = 100;

export function dateOnly(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value.toDate) return value.toDate().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return null;
}

export function hasActiveMembership(profile = {}) {
  // A one-time free trial grants temporary membership without pretending a
  // payment occurred. Paid membership checks remain unchanged for everyone else.
  const trial = profile.freeTrial || {};
  const expiry = trial.expiresAt;
  const expiryMs = expiry?.toMillis ? expiry.toMillis()
    : expiry?.toDate ? expiry.toDate().getTime()
    : new Date(expiry || 0).getTime();
  if (profile.status === 'active_member' && trial.status === 'active' && expiryMs > Date.now()) return true;
  return profile.status === 'active_member'
    && (profile.hasPaid === true || profile.paid === true);
}

export function isSubscriptionExpired(profile = {}) {
  const sub = profile.subscription || {};
  const plan = sub.plan || profile.plan || "standard";
  if (!['elite', 'vault'].includes(plan) || sub.status !== 'active' || !sub.nextBillingDate) return false;
  return new Date().toISOString().slice(0, 10) > dateOnly(sub.nextBillingDate);
}

export function getSubscription(profile = {}) {
  const sub = profile.subscription || {};
  const trial = profile.freeTrial || {};
  const expiryMs = trial.expiresAt?.toMillis ? trial.expiresAt.toMillis() : trial.expiresAt?.toDate ? trial.expiresAt.toDate().getTime() : new Date(trial.expiresAt || 0).getTime();
  if (profile.status === 'active_member' && trial.status === 'active' && expiryMs > Date.now()) {
    return { plan: 'free_trial', billing: 'trial', status: 'active', startDate: trial.startedAt || profile.activatedAt || null, nextBillingDate: null, prioritySupportRequests: sub.prioritySupportRequests || 0, previousPlan: sub.previousPlan || null };
  }
  if (!hasActiveMembership(profile)) {
    return { plan: 'none', billing: null, status: 'inactive', startDate: null, nextBillingDate: null,
      prioritySupportRequests: sub.prioritySupportRequests || 0, previousPlan: sub.previousPlan || null };
  }
  const expired = isSubscriptionExpired(profile);
  const storedPlan = sub.plan || profile.plan || "standard";
  return {
    plan: expired ? 'standard' : storedPlan,
    billing: expired ? 'included' : (sub.billing || "included"),
    status: expired ? 'expired' : (sub.status || "active"),
    startDate: sub.startDate || profile.activatedAt || null,
    nextBillingDate: expired ? null : (sub.nextBillingDate || null),
    prioritySupportRequests: sub.prioritySupportRequests || 0,
    previousPlan: expired ? (sub.previousPlan || storedPlan) : (sub.previousPlan || null)
  };
}

export function planRank(plan) {
  return SUBSCRIPTION_PLANS[plan || 'standard']?.rank || 0;
}

export function hasPlan(profile, minimumPlan) {
  if (getSubscription(profile).plan === 'free_trial') return false;
  const sub = getSubscription(profile);
  return sub.status === 'active' && planRank(sub.plan) >= planRank(minimumPlan) && !isSubscriptionExpired(profile);
}

export function isVault(profile) {
  return hasPlan(profile, 'vault');
}

export function planLabel(plan) {
  return SUBSCRIPTION_PLANS[plan || 'standard']?.label || (plan === 'none' ? 'Locked' : 'Standard');
}

export function vaultBadge(profile) {
  return isVault(profile) ? '<span class="vault-badge">VAULT</span>' : '';
}

export function nextBillingDate(billing) {
  const d = new Date();
  if (billing === 'annual') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export function paymentAmountUSD(purpose, plan = 'standard', billing = 'monthly', pricingCfg = null) {
  if (purpose === 'priority_support') return pricingCfg?.prioritySupportUSD ?? PRIORITY_SUPPORT_PRICE;
  if (purpose === 'subscription') {
    if (pricingCfg?.[plan]) return Number(pricingCfg[plan][billing] || 0);
    return Number(SUBSCRIPTION_PLANS[plan]?.[billing] || 0);
  }
  return pricingCfg?.entryUSD ?? 9.99;
}

export function paymentAmountKES(usd) {
  return Math.max(1, Math.round(Number(usd || 0) * 130));
}

export async function expireSubscriptionIfNeeded(uid, profile) {
  if (!isSubscriptionExpired(profile)) return { expired: false, profile };
  const storedSub = profile.subscription || {};
  const previousPlan = storedSub.plan || profile.plan || 'standard';
  const expiredFor = dateOnly(storedSub.nextBillingDate);
  const updates = {
    subscription: {
      ...storedSub,
      previousPlan,
      plan: 'standard',
      billing: 'included',
      status: 'expired',
      expiredAt: new Date().toISOString(),
      expiredBillingDate: expiredFor,
      nextBillingDate: null
    },
    vaultBadge: false,
    subscriptionExpiredAt: serverTimestamp()
  };
  await updateDoc(doc(db, 'users', uid), updates);
  if (profile.email && profile.subscriptionExpirationEmailSentFor !== expiredFor) {
    try {
      await fetch('/api/send-member-notification-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'subscription_expired', email: profile.email,
          name: profile.displayName || profile.firstName || profile.name || 'Member',
          memberId: profile.memberId, plan: planLabel(previousPlan)
        })
      });
      await updateDoc(doc(db, 'users', uid), { subscriptionExpirationEmailSentFor: expiredFor });
    } catch(e) {}
  }
  try {
    await fetch('/api/telegram-notify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'subscription_expired', uid, memberId: profile.memberId, name: profile.displayName || profile.name || profile.email, email: profile.email, plan: previousPlan })
    });
  } catch(e) {}
  return { expired: true, profile: { ...profile, ...updates } };
}
