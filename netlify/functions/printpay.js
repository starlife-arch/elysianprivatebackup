const { json, parseBody, preflight, fetchJSON } = require('./_helpers');

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
}

// ─── Write invoice record to Firestore ─────────────────────────────────────
async function writeInvoice(tx, payment, checkoutId) {
  const now = getAdmin().firestore.FieldValue.serverTimestamp();
  const invoiceRef = db().collection('invoices').doc(`printpay_${checkoutId}`);
  tx.set(invoiceRef, {
    uid: payment.uid,
    provider: 'printpay',
    purpose: payment.purpose || 'entry',
    plan: payment.plan || 'standard',
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
  const { phone_number, amount, uid, purpose = 'entry', plan = 'standard', billing = 'monthly', tokens = 0, amountUSD = 0 } = parseBody(event);
  let phone = String(phone_number || '').replace(/[^0-9]/g, '');
  if (/^0[17]\d{8}$/.test(phone)) phone = `254${phone.slice(1)}`;
  const kes = Math.round(Number(amount));
  if (!uid || !/^254[17]\d{8}$/.test(phone) || !Number.isInteger(kes) || kes < 1) return json(400, { error: 'Provide a valid Kenyan phone number, amount, and member.' });
  const tokenPacks = { 100: 1, 500: 5, 1000: 10, 2000: 20, 5000: 50, 10000: 90 };
  if (purpose === 'tokens' && tokenPacks[Number(tokens)] !== Number(amountUSD)) return json(400, { error: 'Invalid token pack.' });
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
    purpose, plan, billing, tokens: Number(tokens || 0),
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
