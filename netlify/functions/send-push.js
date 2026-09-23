const { json, parseBody, preflight, getAdmin } = require('./_helpers');

const MAX_TOKENS_PER_REQUEST = 500;

function invalidToken(response) {
  return !response.success && [
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token'
  ].includes(response.error?.code);
}

async function sendPushToUser({ toUID, title, body, url }) {
  const admin = getAdmin();
  const db = admin.firestore();
  const userRef = db.collection('users').doc(toUID);
  const userSnap = await userRef.get();
  const tokens = userSnap.data()?.fcmTokens || [];
  if (!tokens.length) return { sent: 0 };

  let sent = 0;
  const badTokens = [];
  for (let start = 0; start < tokens.length; start += MAX_TOKENS_PER_REQUEST) {
    const batch = tokens.slice(start, start + MAX_TOKENS_PER_REQUEST);
    const response = await admin.messaging().sendEachForMulticast({
      tokens: batch,
      notification: { title, body },
      data: { url: url || '/app/dashboard/' }
    });
    sent += response.successCount;
    response.responses.forEach((result, index) => {
      if (invalidToken(result)) badTokens.push(batch[index]);
    });
  }
  if (badTokens.length) {
    await userRef.update({
      fcmTokens: admin.firestore.FieldValue.arrayRemove(...badTokens),
      fcmTokensUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  return { sent };
}

async function verifyCaller(event) {
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw Object.assign(new Error('Sign in required.'), { status: 401 });
  return getAdmin().auth().verifyIdToken(token);
}

async function sendAnnouncementPushes(title, body, url) {
  const admin = getAdmin();
  const db = admin.firestore();
  const members = await db.collection('users').where('status', '==', 'active_member').get();
  const tokenOwners = members.docs.flatMap(member => (member.data().fcmTokens || []).map(token => ({ token, uid: member.id })));
  let sent = 0;
  const staleTokensByUser = new Map();
  for (let start = 0; start < tokenOwners.length; start += MAX_TOKENS_PER_REQUEST) {
    const batch = tokenOwners.slice(start, start + MAX_TOKENS_PER_REQUEST);
    const response = await admin.messaging().sendEachForMulticast({
      tokens: batch.map(item => item.token),
      notification: { title, body },
      data: { url: url || '/app/chat/?tab=updates' }
    });
    sent += response.successCount;
    response.responses.forEach((result, index) => {
      if (!invalidToken(result)) return;
      const { uid, token } = batch[index];
      staleTokensByUser.set(uid, [...(staleTokensByUser.get(uid) || []), token]);
    });
  }
  if (staleTokensByUser.size) {
    await Promise.all([...staleTokensByUser].map(([uid, tokens]) => db.collection('users').doc(uid).update({
      fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokens),
      fcmTokensUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    })));
  }
  return { sent };
}

exports.sendPushToUser = sendPushToUser;

exports.handler = async event => {
  if (preflight(event)) return preflight(event);
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST required' });
    const caller = await verifyCaller(event);
    const { toUID, title, body, url, type, matchId } = parseBody(event);
    if (!title || !body) throw Object.assign(new Error('A title and body are required.'), { status: 400 });

    if (type === 'announcement') {
      const callerSnap = await getAdmin().firestore().collection('users').doc(caller.uid).get();
      if (callerSnap.data()?.role !== 'admin') throw Object.assign(new Error('Admin access required.'), { status: 403 });
      return json(200, await sendAnnouncementPushes(title, body, url));
    }

    if (type !== 'message' || !toUID || !matchId) throw Object.assign(new Error('Unsupported push request.'), { status: 400 });
    const db = getAdmin().firestore();
    const matchSnap = await db.collection('matches').doc(matchId).get();
    const users = matchSnap.data()?.users || [];
    if (!matchSnap.exists || !users.includes(caller.uid) || !users.includes(toUID)) {
      throw Object.assign(new Error('You can only notify a match.'), { status: 403 });
    }
    const blocked = await Promise.all([
      db.collection('users').doc(caller.uid).collection('blocked').doc(toUID).get(),
      db.collection('users').doc(toUID).collection('blocked').doc(caller.uid).get()
    ]);
    if (blocked.some(snap => snap.exists)) throw Object.assign(new Error('Messaging is blocked.'), { status: 403 });
    return json(200, await sendPushToUser({ toUID, title, body, url }));
  } catch (error) {
    return json(error.status || 500, { error: error.message || 'Could not send push notification.' });
  }
};
