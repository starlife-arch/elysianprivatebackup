function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime() || 0;
}

function isTrialActive(user = {}, now = Date.now()) {
  const trial = user.freeTrial || {};
  return trial.status === 'active' && toMillis(trial.expiresAt) > now;
}

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (typeof value.toDate === 'function') return value.toDate().toISOString().slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return null;
}

function effectivePlan(user = {}, now = Date.now()) {
  if (isTrialActive(user, now)) return 'free_trial';
  const subscription = user.subscription || {};
  const plan = subscription.plan || user.plan || 'standard';
  const expiry = dateOnly(subscription.nextBillingDate);
  if (['elite', 'vault'].includes(plan) && subscription.status === 'active' && expiry
      && new Date(now).toISOString().slice(0, 10) > expiry) return 'standard';
  return plan;
}

function isPaidMember(user = {}, now = Date.now()) {
  const trial = isTrialActive(user, now);
  const subscription = user.subscription || {};
  const paid = trial || user.hasPaid === true || user.paid === true || subscription.status === 'active';
  if (!paid) return false;
    return ['free_trial', 'standard', 'elite', 'vault'].includes(effectivePlan(user, now));
}

function videoCallPrice(user = {}, now = Date.now()) {
  if (!isPaidMember(user, now)) return null;
  return effectivePlan(user, now) === 'free_trial' ? 100 : 50;
}

function photoMessageCost(user = {}, now = Date.now()) {
  if (!isPaidMember(user, now)) return null;
  return ['elite', 'vault'].includes(effectivePlan(user, now)) ? 0 : 30;
}

module.exports = { toMillis, isTrialActive, effectivePlan, isPaidMember, videoCallPrice, photoMessageCost };
