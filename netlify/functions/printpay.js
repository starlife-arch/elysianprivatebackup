const { json, parseBody, preflight, fetchJSON } = require('./_helpers');
const { sendNyotaSms, normalizeKenyanPhone } = require('./_nyota');

const PRINTPAY_URL = 'https://printpay.site/api/stk_push';
let adminDb;
function getAdmin() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  return admin;
}
function db() { return adminDb || (adminDb = getAdmin().firestore()); }
function nextBillingDate(billing = 'monthly') { const date = new Date(); billing === 'annual' ? date.setFullYear(date.getFullYear() + 1) : date.setMonth(date.getMonth() + 1); return date.toISOString().slice(0, 10); }
function planLabel(plan = 'standard') { return ({ standard: 'Standard', elite: 'Elite', vault: 'Vault' })[plan] || 'Standard'; }

const BASE_URL = (process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://elysiandate.site').replace('https://elysiandate.netlify.app', 'https://elysiandate.site');

// ─── Unified notification helper ───────────────────────────────────────────
async function sendNotifications(payment, user) {
  const name = user.displayName || user.name || 'Member';
  const email = user.email || '';
  const memberId = user.memberId || '';

  const telegramBase = { uid: payment.uid, name, email, method: 'M-Pesa Africa' };
  const method = 'M-Pesa Africa';
  const reference = payment.checkout_id || '';
  const emailBase = { email, name, memberId, method, reference };

  let telegramPayload, emailPayload;

  if (payment.purpose === 'tokens') {
    telegramPayload = {
      event: 'token_purchase', ...telegramBase,
      message: `Token purchase\n${name}\n${Number(payment.tokens).toLocaleString()} tokens · $${Number(payment.amountUSD).toFixed(2)} · M-Pesa Africa`
    };
    emailPayload = { type: 'token_purchase', ...emailBase, tokens: payment.tokens, amountUSD: payment.amountUSD, amountKes: payment.amountKes };

  } else if (payment.purpose === 'subscription') {
    telegramPayload = {
      event: 'subscription_payment_received', ...telegramBase,
      plan: payment.plan, billing: payment.billing, amountUSD: payment.amountUSD
    };
    const nbd = nextBillingDate(payment.billing);
    emailPayload = { type: 'subscription_renewed', ...emailBase, plan: planLabel(payment.plan), billing: payment.billing, amountUSD: payment.amountUSD, amountKes: payment.amountKes, nextBillingDate: nbd };

  } else if (payment.purpose === 'addon') {
    telegramPayload = { event: 'addon_purchased', ...telegramBase, addon: payment.addon, amountUSD: payment.amountUSD };
    emailPayload = { type: 'addon_purchased', ...emailBase, addon: payment.addon, amountUSD: payment.amountUSD, amountKes: payment.amountKes };

  } else if (payment.purpose === 'trial_extension') {
    telegramPayload = { event: 'trial_extended', ...telegramBase, amountUSD: 1, durationDays: 7 };
    emailPayload = { type: 'trial_extended', ...emailBase, amountUSD: 1, durationDays: 7 };
  } else if (payment.purpose === 'priority_support') {
    telegramPayload = {
      event: 'priority_support_requested', ...telegramBase,
      amountUSD: payment.amountUSD || 100
    };
    emailPayload = { type: 'priority_support_requested', ...emailBase, amountUSD: payment.amountUSD || 100, amountKes: payment.amountKes };

  } else {
    // entry
    telegramPayload = { event: 'payment_received', ...telegramBase };
    emailPayload = { type: 'payment_received', ...emailBase, amountUSD: payment.amountUSD, amountKes: payment.amountKes };
  }

  await Promise.allSettled([
    fetch(`${BASE_URL}/api/telegram-notify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(telegramPayload)
    }),
    email ? fetch(`${BASE_URL}/api/send-member-notification-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailPayload)
    }) : Promise.resolve()
  ]);

  const phone = normalizeKenyanPhone(user.phone || payment.phone);
  if (phone) {
    const smsMessage = payment.purpose === 'tokens'
      ? `DateVault: Payment confirmed. ${Number(payment.tokens || 0).toLocaleString()} tokens have been added to your wallet.`
      : payment.purpose === 'subscription'
        ? `DateVault: Payment confirmed. Your ${planLabel(payment.plan)} plan is now active.`
        : payment.purpose === 'addon'
          ? `DateVault: Your ${({ boost: 'Profile Boost', superlike_pack: 'Super Like Pack', incognito: 'Incognito Mode' })[payment.addon] || 'add-on'} purchase is confirmed.`
          : payment.purpose === 'trial_extension'
          ? 'DateVault: Your Trial has been extended by 7 days. Your Trial limits and benefits remain unchanged.'
          : payment.purpose === 'priority_support'
          ? 'DateVault: Your priority support purchase was confirmed. Thank you.'
          : 'DateVault: Your membership payment was confirmed. Thank you.';
    try {
      await sendNyotaSms({ recipient: phone, message: smsMessage, idempotencyKey: `dv-printpay-purchase-${payment.checkout_id || payment.uid}` });
    } catch (error) { console.error('Purchase SMS failed:', error.message); }
  }
}

// ─── Write invoice record to Firestore ─────────────────────────────────────
async function writeInvoice(tx, payment, checkoutId) {
  const now = getAdmin().firestore.FieldValue.serverTimestamp();
  const invoiceRef = db().collection('invoices').doc(`printpay_${checkoutId}`);
  tx.set(invoiceRef, {
    uid: payment.uid,
    provider: 'printpay',
    purpose: payment.purpose || 'entry',
    plan: payment.purpose === 'subscription' ? payment.plan : (payment.purpose === 'entry' ? 'standard' : null),
    addon: payment.addon || null,
    billing: payment.billing || 'included',
    amountKes: payment.amountKes || 0,
    amountUSD: Number(payment.amountUSD || 0),
    tokens: Number(payment.tokens || 0),
    status: 'paid',
    checkoutId,
    createdAt: now
  });
}

// ─── Start STK push ────────────────────────────────────────────────────────
async function start(event) {
  const { phone_number, amount, uid, purpose = 'entry', plan = 'standard', billing = 'monthly', tokens = 0, addon = '', amountUSD = 0 } = parseBody(event);
  let phone = String(phone_number || '').replace(/[^0-9]/g, '');
  if (/^0[17]\d{8}$/.test(phone)) phone = `254${phone.slice(1)}`;
  const kes = Math.round(Number(amount));
  if (!uid || !/^254[17]\d{8}$/.test(phone) || !Number.isInteger(kes) || kes < 1) return json(400, { error: 'Provide a valid Kenyan phone number, amount, and member.' });
  const tokenPacks = { 100: 1, 500: 5, 1000: 10, 2000: 20, 5000: 50, 10000: 90 };
  if (purpose === 'tokens') {
    const tokenCount = Number(tokens), usd = Number(amountUSD);
    const isValidCount = Number.isSafeInteger(tokenCount) && tokenCount >= 30;
    const isExistingPack = tokenPacks[tokenCount] !== undefined && tokenPacks[tokenCount] === usd;
    const isCustomAmount = Number.isFinite(usd) && Math.abs(usd - tokenCount / 100) < 0.001;
    if (!isValidCount || !Number.isFinite(usd) || usd <= 0 || (!isExistingPack && !isCustomAmount)) {
      return json(400, { error: 'Token purchases start at 30 tokens. Custom tokens cost $0.01 each.' });
    }
  }
  if (purpose === 'addon' && !['boost', 'superlike_pack', 'incognito'].includes(addon)) return json(400, { error: 'Invalid add-on selection.' });
  if (purpose === 'trial_extension') {
    if (Number(amountUSD) !== 1 || kes !== 130) return json(400, { error: 'A 7-day Trial extension costs exactly $1 (KES 130).' });
    const member = await db().collection('users').doc(uid).get();
    const user = member.exists ? member.data() : {};
    const trial = user.freeTrial || {};
    const expiryMs = trial.expiresAt?.toMillis ? trial.expiresAt.toMillis() : new Date(trial.expiresAt || 0).getTime();
    if (trial.status !== 'expired' || !expiryMs || expiryMs > Date.now() || user.paid === true || user.hasPaid === true || user.adminOverride === true || user.banned === true || user.role === 'admin') {
      return json(403, { error: 'Only an expired, unpaid Trial can be extended.' });
    }
  }
  if (!['entry', 'subscription', 'priority_support', 'tokens', 'addon', 'trial_extension'].includes(purpose)) return json(400, { error: 'Unsupported payment purpose.' });
  if (!process.env.PRINTPAY_API_KEY) return json(503, { error: 'PrintPay is not configured', code: 'misconfigured' });
  let upstream = await fetchJSON(PRINTPAY_URL, { method: 'POST', headers: { Accept: 'application/json' }, form: true }, { x_api_key: process.env.PRINTPAY_API_KEY, phone_number: phone, amount: kes });
  if (upstream.status >= 400) {
    console.warn('PrintPay form response', upstream.status, upstream.body);
    upstream = await fetchJSON(PRINTPAY_URL, { method: 'POST', headers: { Accept: 'application/json' } }, { x_api_key: process.env.PRINTPAY_API_KEY, phone_number: phone, amount: kes });
    console.info('PrintPay JSON fallback response', upstream.status);
  }
  const result = upstream.data || {};
  if (upstream.status >= 400) return json(upstream.status, { error: result.message || result.error || 'M-Pesa is temporarily unavailable — try Card or contact support.', code: 'provider_error' });
  const checkout_id = result.checkout_id || result.checkoutId || result.id || result.data?.checkout_id;
  if (!checkout_id) throw new Error(result.message || 'PrintPay did not return a checkout ID.');
  await db().collection('payments').doc(`printpay_${checkout_id}`).set({
    uid, phone, amountKes: kes, amountUSD: Number(amountUSD || 0),
    purpose, plan, billing, tokens: Number(tokens || 0), addon,
    checkout_id, provider: 'printpay', status: 'pending',
    createdAt: getAdmin().firestore.FieldValue.serverTimestamp()
  });
  return json(200, { checkout_id });
}

// ─── Complete payment (called when STK poll returns SUCCESS) ───────────────
async function complete(checkoutId, statusData) {
  let completedPayment, completedUser;
  const paymentRef = db().collection('payments').doc(`printpay_${checkoutId}`);

  await db().runTransaction(async tx => {
    const paymentDoc = await tx.get(paymentRef);
    if (!paymentDoc.exists) throw new Error('Payment was not found.');
    const payment = paymentDoc.data();
    if (payment.status === 'completed') return;
    completedPayment = payment;
    const userRef = db().collection('users').doc(payment.uid);
    const userDoc = await tx.get(userRef);
    if (!userDoc.exists) throw new Error('Member not found.');
    completedUser = userDoc.data();
    const now = getAdmin().firestore.FieldValue.serverTimestamp();

    tx.update(paymentRef, { status: 'completed', printpayStatus: statusData, completedAt: now });

    // Write invoice for all payment types
    await writeInvoice(tx, payment, checkoutId);

    if (payment.purpose === 'tokens') {
      const tokens = Math.floor(Number(payment.tokens));
      if (!tokens) throw new Error('Invalid token pack.');
      tx.set(userRef, { walletBalance: getAdmin().firestore.FieldValue.increment(tokens) }, { merge: true });
      tx.set(db().collection('users').doc(payment.uid).collection('walletTransactions').doc(), {
        type: 'credit', amount: tokens, note: 'Token pack purchase',
        createdAt: now, status: 'completed'
      });

    } else if (payment.purpose === 'subscription') {
      tx.update(userRef, {
        paid: true, hasPaid: true, plan: payment.plan, stage: 'paid', status: 'active_member',
        'freeTrial.status': 'completed', freeTrialCompletedAt: now,
        subscription: {
          plan: payment.plan, billing: payment.billing, status: 'active',
          startDate: new Date().toISOString(), nextBillingDate: nextBillingDate(payment.billing),
          prioritySupportRequests: completedUser.subscription?.prioritySupportRequests || 0
        },
        vaultBadge: payment.plan === 'vault',
        subscriptionExpirationEmailSentFor: null,
        lastSubscriptionPaymentAt: now,
        lastSubscriptionPaymentMethod: 'printpay'
      });

    } else if (payment.purpose === 'addon') {
      const addonKey = payment.addon === 'superlike_pack' ? 'superlikePack' : payment.addon;
      const durationMs = payment.addon === 'boost' ? 24 * 60 * 60 * 1000 : payment.addon === 'incognito' ? 7 * 24 * 60 * 60 * 1000 : null;
      const expiresAt = durationMs ? getAdmin().firestore.Timestamp.fromMillis(Date.now() + durationMs) : null;
      const currentUses = Number(completedUser.addons?.superlikePack?.remainingUses || 0);
      const addonData = { active: true, purchasedAt: now, expiresAt, remainingUses: payment.addon === 'superlike_pack' ? currentUses + 10 : null };
      tx.update(userRef, { [`addons.${addonKey}`]: addonData, ...(payment.addon === 'boost' ? { boostActive: true, boostExpiresAt: expiresAt } : {}) });

    } else if (payment.purpose === 'trial_extension') {
      if (Number(payment.amountUSD) !== 1 || Number(payment.amountKes) !== 130) throw new Error('Invalid Trial extension amount.');
      const trial = completedUser.freeTrial || {};
      const oldExpiryMs = trial.expiresAt?.toMillis ? trial.expiresAt.toMillis() : new Date(trial.expiresAt || 0).getTime();
      if (trial.status !== 'expired' || !oldExpiryMs || oldExpiryMs > Date.now() || completedUser.paid === true || completedUser.hasPaid === true || completedUser.adminOverride === true || completedUser.banned === true) {
        throw new Error('This Trial is no longer eligible for extension.');
      }
      const nextExpiry = getAdmin().firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
      tx.update(userRef, {
        status: 'active_member', paid: false, hasPaid: false,
        plan: 'free_trial', stage: 'trial',
        'freeTrial.status': 'active',
        'freeTrial.expiresAt': nextExpiry,
        'freeTrial.durationDays': 7,
        'subscription.plan': 'free_trial',
        'subscription.billing': 'trial',
        'subscription.status': 'active',
        'subscription.nextBillingDate': null,
        trialExtensionCount: getAdmin().firestore.FieldValue.increment(1),
        lastTrialExtensionAt: now,
        lastTrialExtensionPayment: `printpay_${checkoutId}`
      });

    } else if (payment.purpose === 'priority_support') {
      const reqRef = db().collection('priority_support_requests').doc();
      tx.set(reqRef, {
        uid: payment.uid, email: completedUser.email || '',
        memberName: completedUser.displayName || completedUser.name || 'Member',
        memberId: completedUser.memberId || '', amountUSD: payment.amountUSD || 100,
        status: 'paid_pending_admin_confirmation', paymentMethod: 'printpay',
        paymentReference: `printpay_${checkoutId}`, createdAt: now
      });
      tx.update(userRef, { 'subscription.prioritySupportRequests': getAdmin().firestore.FieldValue.increment(1) });

    } else {
      // entry
      tx.update(userRef, {
        paid: true, hasPaid: true, plan: 'standard', stage: 'paid',
        inviteTokenUsed: true, inviteUsed: true,
        paymentMethod: 'printpay', status: 'active_member',
        activatedAt: now, reminderCount: 0, lastReminderSent: null, reminderType: null,
        subscription: { plan: 'standard', billing: 'included', status: 'active', startDate: new Date().toISOString(), nextBillingDate: null, prioritySupportRequests: 0 },
        'freeTrial.status': 'completed', freeTrialCompletedAt: now,
        vaultBadge: false
      });
    }
  });

  // Send email + telegram after transaction commits
  if (completedPayment && completedUser) {
    await sendNotifications(completedPayment, completedUser);
  }
}

// ─── Poll status ────────────────────────────────────────────────────────────
async function status(event) {
  const checkout_id = event.queryStringParameters?.checkout_id;
  if (!checkout_id) return json(400, { error: 'checkout_id is required' });
  const upstream = await fetchJSON(`${PRINTPAY_URL}?check_status=${encodeURIComponent(checkout_id)}`, { headers: { Accept: 'application/json' } });
  if (upstream.status >= 400) return json(upstream.status, { error: 'M-Pesa status is temporarily unavailable', code: 'provider_error' });
  const response = upstream.data || {};
  const state = String(response.status || response.data?.status || '').toUpperCase();
  if (state === 'SUCCESS') await complete(checkout_id, response);
  return json(200, { status: state || 'PENDING', completed: state === 'SUCCESS', failed: state === 'FAILED' });
}

exports.handler = async event => {
  const options = preflight(event); if (options) return options;
  try { return event.httpMethod === 'POST' ? await start(event) : event.httpMethod === 'GET' ? await status(event) : json(405, { error: 'POST or GET required' }); }
  catch (error) { console.error('PrintPay error:', error); return json(500, { error: error.message || 'PrintPay request failed', code: 'provider_error' }); }
};
