const { json, text, parseBody, preflight, getAdmin } = require('./_helpers');

function db() { return getAdmin().firestore(); }
function bearer(event) {
  return String(event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\\s+/i, '');
}
async function authenticatedUid(event) {
  const token = bearer(event);
  if (!token) throw Object.assign(new Error('Sign in required.'), { status: 401 });
  return (await getAdmin().auth().verifyIdToken(token)).uid;
}

async function getAccount(uid) {
  const firestore = db();
  const userRef = firestore.collection('users').doc(uid);
  const accountCollection = firestore.collection('paybill_accounts');
  let result;
  await firestore.runTransaction(async tx => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new Error('Member account not found.');
    const user = userSnap.data();
    if (user.paybillAccountNumber) {
      result = String(user.paybillAccountNumber);
      return;
    }
    const counterRef = firestore.collection('system_counters').doc('paybill_member_reference');
    const counterSnap = await tx.get(counterRef);
    const next = Number(counterSnap.exists ? counterSnap.data().value : 10000000) + 1;
    if (!Number.isSafeInteger(next) || next > 99999999) throw new Error('Paybill account-number capacity reached.');
    const reference = String(next);
    const mappingRef = accountCollection.doc(reference);
    const mappingSnap = await tx.get(mappingRef);
    if (mappingSnap.exists) throw new Error('Paybill reference collision. Please retry.');
    const now = getAdmin().firestore.FieldValue.serverTimestamp();
    tx.set(counterRef, { value: next, updatedAt: now }, { merge: true });
    tx.set(mappingRef, { uid, accountNumber: reference, status: 'active', createdAt: now });
    tx.update(userRef, { paybillAccountNumber: reference, paybillAccountNumberCreatedAt: now });
    result = reference;
  });
  return result;
}

exports.handler = async event => {
  const options = preflight(event); if (options) return options;
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET required' });
  try {
    const uid = await authenticatedUid(event);
    const accountNumber = await getAccount(uid);
    return json(200, {
      accountNumber,
      paybillNumber: process.env.SAFARICOM_PAYBILL_NUMBER || null,
      configured: Boolean(process.env.SAFARICOM_PAYBILL_NUMBER),
      instructions: 'Pay to the DateVault Paybill and enter this account number as the account/reference number.'
    });
  } catch (error) {
    console.error('Paybill account lookup failed:', error);
    return json(error.status || 500, { error: error.message || 'Could not load your Paybill account number.' });
  }
};
