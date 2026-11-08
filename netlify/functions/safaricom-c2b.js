const { json, text, parseBody, preflight, getAdmin } = require('./_helpers');
function db() { return getAdmin().firestore(); }
function callbackPayload(event) {
  const body = parseBody(event);
  return body?.Body?.stkCallback || body?.Body?.C2BPaymentConfirmation || body?.Body?.C2BPaymentValidation || body;
}
function response(resultCode, resultDesc) {
  return json(200, { ResultCode: resultCode, ResultDesc: resultDesc });
}
async function findAccount(reference) {
  if (!/^\\d{8}$/.test(String(reference || ''))) return null;
  const snap = await db().collection('paybill_accounts').doc(String(reference)).get();
  if (!snap.exists || snap.data().status !== 'active') return null;
  return snap.data();
}
async function validate(event) {
  const p = callbackPayload(event);
  const shortcode = String(p.BusinessShortCode || p.BusinessNumber || '');
  const expected = String(process.env.SAFARICOM_PAYBILL_NUMBER || '');
  if (!expected || shortcode !== expected) return response(1, 'Invalid Paybill number');
  const account = await findAccount(p.BillRefNumber || p.AccountReference);
  return account ? response(0, 'Accepted') : response(1, 'Unknown DateVault account number');
}
async function confirm(event) {
  const p = callbackPayload(event);
  const shortcode = String(p.BusinessShortCode || p.BusinessNumber || '');
  const expected = String(process.env.SAFARICOM_PAYBILL_NUMBER || '');
  if (!expected || shortcode !== expected) return response(1, 'Invalid Paybill number');
  const reference = String(p.BillRefNumber || p.AccountReference || '');
  const transactionId = String(p.TransID || p.TransactionID || '');
  const amount = Number(p.TransAmount || p.Amount);
  if (!transactionId || !Number.isFinite(amount) || amount <= 0) return response(1, 'Invalid transaction details');
  const firestore = db();
  const mapping = await findAccount(reference);
  if (!mapping) return response(1, 'Unknown DateVault account number');
  const paymentRef = firestore.collection('safaricom_paybill_payments').doc(transactionId);
  await firestore.runTransaction(async tx => {
    const existing = await tx.get(paymentRef);
    if (existing.exists) return;
    const userRef = firestore.collection('users').doc(mapping.uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new Error('Mapped DateVault member no longer exists.');
    tx.create(paymentRef, {
      provider: 'safaricom_paybill',
      transactionId,
      accountNumber: reference,
      uid: mapping.uid,
      amountKes: amount,
      phone: String(p.MSISDN || ''),
      firstName: String(p.FirstName || ''),
      middleName: String(p.MiddleName || ''),
      lastName: String(p.LastName || ''),
      businessShortCode: shortcode,
      transactionTime: String(p.TransTime || ''),
      status: 'received',
      createdAt: getAdmin().firestore.FieldValue.serverTimestamp()
    });
  });
  return response(0, 'Accepted');
}
exports.handler = async event => {
  const options = preflight(event); if (options) return options;
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST required' });
  try {
    const action = event.queryStringParameters?.action || 'confirmation';
    if (action === 'validation') return await validate(event);
    if (action === 'confirmation') return await confirm(event);
    return json(400, { error: 'Unknown callback action' });
  } catch (error) {
    console.error('Safaricom C2B callback failed:', error);
    return response(1, 'Could not process payment confirmation');
  }
};
