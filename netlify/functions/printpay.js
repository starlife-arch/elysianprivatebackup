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

async function start(event) {
  const { phone_number, amount, uid, purpose = 'entry', plan = 'standard', billing = 'monthly', tokens = 0, amountUSD = 0 } = parseBody(event);
  const phone = String(phone_number || '').replace(/\s|\+/g, '');
  const kes = Math.round(Number(amount));
  if (!uid || !/^(?:0\d{9}|254\d{9})$/.test(phone) || !Number.isInteger(kes) || kes < 1) return json(400, { error: 'Provide a valid Kenyan phone number, amount, and member.' });
  const tokenPacks = { 100: 1, 500: 5, 1000: 10, 2000: 20, 5000: 50, 10000: 90 };
  if (purpose === 'tokens' && tokenPacks[Number(tokens)] !== Number(amountUSD)) return json(400, { error: 'Invalid token pack.' });
  if (!process.env.PRINTPAY_API_KEY) throw new Error('PrintPay is not configured');
  const result = await fetchJSON(PRINTPAY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }, { x_api_key: process.env.PRINTPAY_API_KEY, phone_number: phone, amount: kes });
  const checkout_id = result.checkout_id || result.checkoutId || result.id || result.data?.checkout_id;
  if (!checkout_id) throw new Error(result.message || 'PrintPay did not return a checkout ID.');
  await db().collection('payments').doc(`printpay_${checkout_id}`).set({ uid, phone, amountKes: kes, amountUSD: Number(amountUSD || 0), purpose, plan, billing, tokens: Number(tokens || 0), checkout_id, provider: 'printpay', status: 'pending', createdAt: getAdmin().firestore.FieldValue.serverTimestamp() });
  return json(200, { checkout_id });
}

async function complete(checkoutId, statusData) {
  const paymentRef = db().collection('payments').doc(`printpay_${checkoutId}`);
  await db().runTransaction(async tx => {
    const paymentDoc = await tx.get(paymentRef);
    if (!paymentDoc.exists) throw new Error('Payment was not found.');
    const payment = paymentDoc.data();
    if (payment.status === 'completed') return;
    const userRef = db().collection('users').doc(payment.uid);
    const user = await tx.get(userRef);
    if (!user.exists) throw new Error('Member not found.');
    const now = getAdmin().firestore.FieldValue.serverTimestamp();
    tx.update(paymentRef, { status: 'completed', printpayStatus: statusData, completedAt: now });
    if (payment.purpose === 'tokens') {
      const tokens = Math.floor(Number(payment.tokens));
      if (!tokens) throw new Error('Invalid token pack.');
      tx.set(userRef, { walletBalance: getAdmin().firestore.FieldValue.increment(tokens) }, { merge: true });
      tx.set(db().collection('users').doc(payment.uid).collection('walletTransactions').doc(), { type: 'credit', amount: tokens, note: 'Token pack purchase', createdAt: now, status: 'completed' });
    } else if (payment.purpose === 'subscription') {
      tx.update(userRef, { subscription: { plan: payment.plan, billing: payment.billing, status: 'active', startDate: new Date().toISOString(), nextBillingDate: nextBillingDate(payment.billing), prioritySupportRequests: user.data().subscription?.prioritySupportRequests || 0 }, vaultBadge: payment.plan === 'vault', lastSubscriptionPaymentAt: now, lastSubscriptionPaymentMethod: 'printpay' });
    } else {
      tx.update(userRef, { paid: true, hasPaid: true, plan: 'standard', stage: 'paid', inviteTokenUsed: true, inviteUsed: true, paymentMethod: 'printpay', status: 'active_member', activatedAt: now, reminderCount: 0, lastReminderSent: null, reminderType: null, subscription: { plan: 'standard', billing: 'included', status: 'active', startDate: new Date().toISOString(), nextBillingDate: null, prioritySupportRequests: 0 }, vaultBadge: false });
    }
  });
}

async function status(event) {
  const checkout_id = event.queryStringParameters?.checkout_id;
  if (!checkout_id) return json(400, { error: 'checkout_id is required' });
  const response = await fetchJSON(`${PRINTPAY_URL}?check_status=${encodeURIComponent(checkout_id)}`, { headers: { Accept: 'application/json' } });
  const state = String(response.status || response.data?.status || '').toUpperCase();
  if (state === 'SUCCESS') await complete(checkout_id, response);
  return json(200, { status: state || 'PENDING', completed: state === 'SUCCESS', failed: state === 'FAILED' });
}

exports.handler = async event => {
  const options = preflight(event); if (options) return options;
  try { return event.httpMethod === 'POST' ? await start(event) : event.httpMethod === 'GET' ? await status(event) : json(405, { error: 'POST or GET required' }); }
  catch (error) { console.error('PrintPay error:', error); return json(500, { error: error.message || 'PrintPay request failed' }); }
};
