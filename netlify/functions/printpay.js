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
  let phone = String(phone_number || '').replace(/[^0-9]/g, '');
  if (/^0[17]\d{8}$/.test(phone)) phone = `254${phone.slice(1)}`;
  const kes = Math.round(Number(amount));
  if (!uid || !/^254[17]\d{8}$/.test(phone) || !Number.isInteger(kes) || kes < 1) return json(400, { error: 'Provide a valid Kenyan phone number, amount, and member.' });
  const tokenPacks = { 100: 1, 500: 5, 1000: 10, 2000: 20, 5000: 50, 10000: 90 };
  if (purpose === 'tokens' && tokenPacks[Number(tokens)] !== Number(amountUSD)) return json(400, { error: 'Invalid token pack.' });
  if (!process.env.PRINTPAY_API_KEY) return json(503, { error: 'PrintPay is not configured', code: 'misconfigured' });
  let upstream = await fetchJSON(PRINTPAY_URL, { method: 'POST', headers: { Accept: 'application/json' }, form: true }, { x_api_key: process.env.PRINTPAY_API_KEY, phone_number: phone, amount: kes });
  if (upstream.status >= 400) { console.warn('PrintPay form response', upstream.status, upstream.body); upstream = await fetchJSON(PRINTPAY_URL, { method: 'POST', headers: { Accept: 'application/json' } }, { x_api_key: process.env.PRINTPAY_API_KEY, phone_number: phone, amount: kes }); console.info('PrintPay JSON fallback response', upstream.status); }
  const result = upstream.data || {};
  if (upstream.status >= 400) return json(upstream.status, { error: result.message || result.error || 'M-Pesa is temporarily unavailable — try Card or contact support.', code: 'provider_error' });
  const checkout_id = result.checkout_id || result.checkoutId || result.id || result.data?.checkout_id;
  if (!checkout_id) throw new Error(result.message || 'PrintPay did not return a checkout ID.');
  await db().collection('payments').doc(`printpay_${checkout_id}`).set({ uid, phone, amountKes: kes, amountUSD: Number(amountUSD || 0), purpose, plan, billing, tokens: Number(tokens || 0), checkout_id, provider: 'printpay', status: 'pending', createdAt: getAdmin().firestore.FieldValue.serverTimestamp() });
  return json(200, { checkout_id });
}

async function notifyTokenPurchase(payment, user) {
  if (payment.purpose !== 'tokens') return;
  const base = (process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://elysiandate.site').replace('https://elysiandate.netlify.app', 'https://elysiandate.site');
  const payload = { uid: payment.uid, name: user.displayName || user.name || 'Member', email: user.email || '', amountUSD: payment.amountUSD, tokens: payment.tokens, method: 'M-Pesa Africa' };
  await Promise.all([
    fetch(`${base}/api/telegram-notify`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({event:'token_purchase', ...payload, message:`Token purchase\n${payload.name}\n${Number(payment.tokens).toLocaleString()} tokens · $${Number(payment.amountUSD).toFixed(2)} · M-Pesa Africa`}) }),
    payload.email ? fetch(`${base}/api/send-member-notification-email`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({type:'token_purchase', ...payload}) }) : Promise.resolve()
  ]).catch(error => console.error('Token purchase notification failed', error));
}

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
    const user = await tx.get(userRef);
    if (!user.exists) throw new Error('Member not found.');
    completedUser = user.data();
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
  if (completedPayment && completedUser) await notifyTokenPurchase(completedPayment, completedUser);
}

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
