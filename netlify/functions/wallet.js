const { json, parseBody, preflight } = require('./_helpers');

let _db, _admin;
const BOOST_COST = 299;
const SUPERLIKE_PACK_COST = 499, SUPERLIKE_PACK_COUNT = 10;
const INCOGNITO_COST = 399, INCOGNITO_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const BOOST_DURATION_MS = 24 * 60 * 60 * 1000;

function admin() {
  if (_admin) return _admin;
  _admin = require('firebase-admin');
  if (!_admin.apps.length) {
    const credential = process.env.FIREBASE_SERVICE_ACCOUNT
      ? _admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      : _admin.credential.applicationDefault();
    _admin.initializeApp({ credential });
  }
  _db = _admin.firestore();
  return _admin;
}

async function caller(event) {
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw Object.assign(new Error('Sign in required.'), { status: 401 });
  return admin().auth().verifyIdToken(token);
}

const ts = () => admin().firestore.FieldValue.serverTimestamp();
const txn = uid => _db.collection('users').doc(uid).collection('walletTransactions').doc();

async function gift(uid, body) {
  const { toUID, amount, note = '' } = body;
  const n = Math.floor(Number(amount));
  if (!toUID || toUID === uid || !Number.isInteger(n) || n < 10) throw new Error('Enter a valid gift of at least 10 tokens.');
  const id = [uid, toUID].sort().join('_');
  await _db.runTransaction(async tx => {
    const fromRef = _db.collection('users').doc(uid), toRef = _db.collection('users').doc(toUID), matchRef = _db.collection('matches').doc(id);
    const [from, to] = await Promise.all([tx.get(fromRef), tx.get(toRef)]);
    if (!from.exists || !to.exists) throw new Error('Member not found.');
    if (from.data().walletFrozen || to.data().walletFrozen || from.data().banned || to.data().banned) throw new Error('This wallet is currently on hold.');
    if (Number(from.data().walletBalance || 0) < n) throw new Error('Not enough tokens — buy tokens in your wallet.');
    tx.update(fromRef, { walletBalance: Number(from.data().walletBalance || 0) - n });
    tx.set(toRef, { walletBalance: admin().firestore.FieldValue.increment(n) }, { merge: true });
    tx.set(txn(uid), { type: 'gift_sent', amount: n, toUID, note: note || 'Gift sent', createdAt: ts(), status: 'completed' });
    tx.set(txn(toUID), { type: 'gift_received', amount: n, fromUID: uid, note: note || 'Gift received', createdAt: ts(), status: 'completed' });
    tx.set(_db.collection('admin_messages').doc(), { toUID, message: `${from.data().displayName || from.data().name || 'A member'} sent you ${n} tokens`, sentAt: ts(), read: false, walletEvent: true });
    tx.set(matchRef, { users: [uid, toUID] }, { merge: true });
    tx.set(matchRef.collection('messages').doc(), { type: 'gift', giftAmount: n, senderUID: uid, sentAt: ts(), read: false });
    tx.update(matchRef, { lastMessage: `Sent ${n} token gift`, lastMessageAt: ts(), [`hasUnread_${toUID}`]: true });
  });
  return { ok: true };
}

async function withdraw(uid, body) {
  const { method, details } = body;
  if (!['Bank', 'M-Pesa', 'PayPal', 'Crypto BEP-20'].includes(method) || !String(details || '').trim()) throw new Error('Complete the payout details.');
  const ref = _db.collection('withdrawals').doc();
  await _db.runTransaction(async tx => {
    const userRef = _db.collection('users').doc(uid), user = await tx.get(userRef);
    if (!user.exists || user.data().walletFrozen || user.data().banned) throw new Error('This wallet is currently on hold.');
    if (Number(user.data().walletBalance || 0) < 3000) throw new Error('You need at least 3,000 tokens to withdraw.');
    tx.update(userRef, { walletBalance: Number(user.data().walletBalance || 0) - 3000 });
    tx.set(ref, { uid, tokens: 3000, payout: 15, method, details: String(details).trim(), status: 'pending', createdAt: ts() });
    tx.set(txn(uid), { type: 'withdrawal_request', amount: 3000, note: 'Withdrawal request', createdAt: ts(), status: 'pending' });
  });
  return { id: ref.id };
}

async function boost(uid) {
  let balance, boostExpiresAt;
  await _db.runTransaction(async tx => {
    const userRef = _db.collection('users').doc(uid), user = await tx.get(userRef);
    if (!user.exists) throw new Error('Member not found.');
    const data = user.data(), currentBalance = Number(data.walletBalance || 0);
    if (data.walletFrozen || data.banned) throw new Error('This wallet is currently on hold.');
    if (currentBalance < BOOST_COST) throw new Error(`You need ${BOOST_COST.toLocaleString()} tokens to boost your profile.`);
    balance = currentBalance - BOOST_COST;
    boostExpiresAt = admin().firestore.Timestamp.fromMillis(Date.now() + BOOST_DURATION_MS);
    tx.update(userRef, { walletBalance: balance, boostActive: true, boostExpiresAt, 'addons.boost': { active:true, purchasedAt:ts(), expiresAt:boostExpiresAt, remainingUses:null } });
    tx.set(txn(uid), { type: 'boost_purchase', amount: BOOST_COST, note: 'Profile boost — 24 hours', createdAt: ts(), status: 'completed' });
  });
  return { balance, boostExpiresAt: boostExpiresAt.toDate().toISOString() };
}


async function addon(uid, kind) { const cfg=kind==='superlike_pack'?[SUPERLIKE_PACK_COST,'superlikePack',null,SUPERLIKE_PACK_COUNT,'Super Like Pack — 10 super likes','superlike_pack_purchase']: [INCOGNITO_COST,'incognito',INCOGNITO_DURATION_MS,null,'Incognito Mode — 7 days','incognito_purchase']; let balance,expiresAt; await _db.runTransaction(async tx=>{const ref=_db.collection('users').doc(uid),snap=await tx.get(ref);if(!snap.exists)throw new Error('Member not found.');const data=snap.data(),current=Number(data.walletBalance||0);if(data.walletFrozen||data.banned)throw new Error('This wallet is currently on hold.');if(current<cfg[0])throw new Error(`You need ${cfg[0]} tokens to buy this add-on.`);balance=current-cfg[0];expiresAt=cfg[2]?admin().firestore.Timestamp.fromMillis(Date.now()+cfg[2]):null;const uses=cfg[3]?Number(data.addons?.superlikePack?.remainingUses||0)+cfg[3]:null;tx.update(ref,{walletBalance:balance,[`addons.${cfg[1]}`]:{active:true,purchasedAt:ts(),expiresAt,remainingUses:uses}});tx.set(txn(uid),{type:cfg[5],amount:cfg[0],note:cfg[4],createdAt:ts(),status:'completed'});});return {balance,expiresAt:expiresAt?.toDate().toISOString(),superlikesAdded:cfg[3]};}

exports.handler = async event => {
  const options = preflight(event);
  if (options) return options;
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST required' });
    const user = await caller(event), body = parseBody(event);
    const data = body.action === 'gift' ? await gift(user.uid, body)
      : body.action === 'withdraw' ? await withdraw(user.uid, body)
      : body.action === 'boost' ? await boost(user.uid)
      : body.action === 'superlike_pack' ? await addon(user.uid, 'superlike_pack')
      : body.action === 'incognito' ? await addon(user.uid, 'incognito')
      : null;
    if (!data) return json(400, { error: 'Unknown wallet action' });
    return json(200, data);
  } catch (error) {
    console.error('Wallet function failed', error);
    return json(error.status || 400, { error: error.message || 'Wallet request failed' });
  }
};
