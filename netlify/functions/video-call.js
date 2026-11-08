const { json, parseBody, preflight } = require('./_helpers');
const { sendPushToUser } = require('./send-push');
const { videoCallPrice } = require('./membership-billing');

let db, firebase;
function admin() {
  if (firebase) return firebase;
  firebase = require('firebase-admin');
  if (!firebase.apps.length) firebase.initializeApp({
    credential: process.env.FIREBASE_SERVICE_ACCOUNT
      ? firebase.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      : firebase.credential.applicationDefault()
  });
  db = firebase.firestore();
  return firebase;
}
async function callerUID(event) {
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw Object.assign(new Error('Sign in required.'), { status: 401 });
  return admin().auth().verifyIdToken(token);
}
function matchId(a, b) { return [a, b].sort().join('_'); }
async function daily(path, body) {
  const response = await fetch(`https://api.daily.co/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.DAILY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error('Could not create video call room.');
  return response.json();
}
async function charge(uid, cost) {
  let balance, transactionId;
  await db.runTransaction(async tx => {
    const userRef = db.collection('users').doc(uid);
    const user = await tx.get(userRef);
    if (!user.exists) throw new Error('Member not found.');
    const current = Number(user.data().walletBalance || 0);
    if (current < cost) throw Object.assign(new Error('insufficient_tokens'), { status: 402, balance: current, cost });
    balance = current - cost;
    const transactionRef = userRef.collection('walletTransactions').doc();
    transactionId = transactionRef.id;
    tx.update(userRef, { walletBalance: balance });
    tx.set(transactionRef, {
      type: 'call_charge', amount: -cost, note: 'Video call initiated',
      createdAt: admin().firestore.FieldValue.serverTimestamp(), status: 'completed'
    });
  });
  return { balance, transactionId };
}
async function refund(uid, cost, chargeTransactionId) {
  await db.runTransaction(async tx => {
    const userRef = db.collection('users').doc(uid);
    const refundRef = userRef.collection('walletTransactions').doc();
    const user = await tx.get(userRef);
    if (!user.exists) throw new Error('Cannot refund a missing member wallet.');
    tx.update(userRef, { walletBalance: admin().firestore.FieldValue.increment(cost) });
    tx.set(refundRef, {
      type: 'call_refund', amount: cost, note: 'Automatic refund: video call setup failed',
      relatedTransactionId: chargeTransactionId,
      createdAt: admin().firestore.FieldValue.serverTimestamp(), status: 'completed'
    });
  });
}
exports.handler = async event => {
  const options = preflight(event);
  if (options) return options;
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST required' });
    const user = await callerUID(event);
    const body = parseBody(event);
    const adminCall = body.adminCall === true;
    const toUID = body.toUID;
    const action = event.queryStringParameters?.action || body.action;

    if (action === 'join') {
      const invite = await db.collection('videoCallInvites').doc(body.inviteId).get();
      if (!invite.exists || invite.data().toUID !== user.uid) throw Object.assign(new Error('Invite not found'), { status: 403 });
      const token = await daily('meeting-tokens', { properties: { room_name: invite.data().roomName, exp: Math.floor(Date.now() / 1000) + 1800 } });
      return json(200, { roomURL: `https://datevault.daily.co/${invite.data().roomName}`, token: token.token });
    }

    const [from, to] = await Promise.all([
      db.collection('users').doc(user.uid).get(),
      db.collection('users').doc(toUID).get()
    ]);
    if (!to.exists) throw new Error('Member not found.');
    if (adminCall) {
      if (from.data()?.role !== 'admin') throw Object.assign(new Error('Admin access required'), { status: 403 });
    } else {
      if (videoCallPrice(from.data()) === null) throw Object.assign(new Error('Video calls are available to active Free Trial, Standard, Elite, and Vault members.'), { status: 403 });
      if (!(await db.collection('matches').doc(matchId(user.uid, toUID)).get()).exists) throw Object.assign(new Error('You can only call matches.'), { status: 403 });
    }

    const callCost = adminCall ? 0 : videoCallPrice(from.data());
    let chargeInfo = null;
    if (!adminCall) chargeInfo = await charge(user.uid, callCost);

    try {
      const room = await daily('rooms', {
        name: `dv-${matchId(user.uid, toUID)}-${Date.now()}`,
        properties: { exp: Math.floor(Date.now() / 1000) + 1800, enable_screenshare: false, max_participants: 2, eject_at_room_exp: true }
      });
      const token = await daily('meeting-tokens', { properties: { room_name: room.name, exp: Math.floor(Date.now() / 1000) + 1800 } });
      const inviteRef = db.collection('videoCallInvites').doc();
      await inviteRef.set({
        fromUID: adminCall ? 'admin' : user.uid, toUID, matchId: matchId(user.uid, toUID),
        roomName: room.name, createdAt: admin().firestore.FieldValue.serverTimestamp(),
        expiresAt: admin().firestore.Timestamp.fromMillis(Date.now() + 30000),
        status: 'ringing', type: adminCall ? 'admin_call' : 'member_call'
      });
      sendPushToUser({
        toUID, title: 'Incoming video call',
        body: `${adminCall ? 'DateVault Team' : (from.data()?.displayName || from.data()?.name || 'A member')} is calling you`,
        url: '/app/chat/'
      }).catch(error => console.error('Could not send call push notification', error));
      return json(200, { inviteId: inviteRef.id, roomURL: room.url, token: token.token, tokenBalance: chargeInfo?.balance ?? null, tokenCost: callCost });
    } catch (error) {
      if (chargeInfo) {
        try { await refund(user.uid, callCost, chargeInfo.transactionId); }
        catch (refundError) { console.error('CRITICAL: video-call token refund failed', refundError); }
      }
      throw error;
    }
  } catch (error) {
    return json(error.status || 400, { error: error.message, balance: error.balance, cost: error.cost });
  }
};
