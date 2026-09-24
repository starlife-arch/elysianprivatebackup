import { db } from "./firebase.js";
import { doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const SUBSCRIPTION_PLANS = {
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
  // A plan alone does not prove that a membership payment succeeded.
  return profile.status === 'active_member'
    && (profile.hasPaid === true || profile.paid === true);
}

export function getSubscription(profile = {}) {
  const sub = profile.subscription || {};
  if (!hasActiveMembership(profile)) {
    return {
      plan: 'none',
      billing: null,
      status: 'inactive',
      startDate: null,
      nextBillingDate: null,
      prioritySupportRequests: sub.prioritySupportRequests || 0,
      previousPlan: sub.previousPlan || null
    };
  }
  return {
    plan: sub.plan || profile.plan || "standard",
    billing: sub.billing || "included",
    status: sub.status || "active",
    startDate: sub.startDate || profile.activatedAt || null,
    nextBillingDate: sub.nextBillingDate || null,
    prioritySupportRequests: sub.prioritySupportRequests || 0,
    previousPlan: sub.previousPlan || null
  };
}

export function isSubscriptionExpired(profile = {}) {
  const sub = getSubscription(profile);
  if (!['elite', 'vault'].includes(sub.plan) || sub.status !== 'active' || !sub.nextBillingDate) return false;
  return new Date().toISOString().slice(0, 10) > dateOnly(sub.nextBillingDate);
}

export function planRank(plan) {
  return SUBSCRIPTION_PLANS[plan || 'standard']?.rank || 0;
}

export function hasPlan(profile, minimumPlan) {
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
  const sub = getSubscription(profile);
  const expiredFor = dateOnly(sub.nextBillingDate);
  const updates = {
    subscription: {
      ...sub,
      previousPlan: sub.plan,
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
          memberId: profile.memberId, plan: planLabel(sub.plan)
        })
      });
      await updateDoc(doc(db, 'users', uid), { subscriptionExpirationEmailSentFor: expiredFor });
    } catch(e) {}
  }
  try {
    await fetch('/api/telegram-notify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'subscription_expired', uid, memberId: profile.memberId, name: profile.displayName || profile.name || profile.email, email: profile.email, plan: sub.plan })
    });
  } catch(e) {}
  return { expired: true, profile: { ...profile, ...updates } };
}
