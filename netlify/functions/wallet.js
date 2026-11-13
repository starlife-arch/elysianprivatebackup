const { json, parseBody, preflight } = require('./_helpers');
const { photoMessageCost, videoMessageCost } = require('./membership-billing');

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

async function extendTrialWithTokens(uid, body) {
  const requestId = String(body.requestId || '');
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) {
    throw Object.assign(new Error('A valid request ID is required. Please retry.'), { status: 400 });
  }
  const userRef = _db.collection('users').doc(uid);
  const ledgerRef = userRef.collection('walletTransactions').doc('trial_extension_' + requestId);
  let result;
  await _db.runTransaction(async tx => {
    const [userSnap, prior] = await Promise.all([tx.get(userRef), tx.get(ledgerRef)]);
    if (prior.exists) {
      result = { ok: true, alreadyProcessed: true, balance: Number(prior.data().balanceAfter || 0), expiresAt: prior.data().trialExpiresAt?.toDate?.().toISOString() || null };
      return;
    }
    if (!userSnap.exists) throw Object.assign(new Error('Account not found.'), { status: 404 });
    const data = userSnap.data(), trial = data.freeTrial || {};
    const expiry = trial.expiresAt?.toMillis ? trial.expiresAt.toMillis() : trial.expiresAt?.toDate ? trial.expiresAt.toDate().getTime() : new Date(trial.expiresAt || 0).getTime();
    if (trial.status !== 'expired' || !expiry || expiry > Date.now() || data.paid === true || data.hasPaid === true || data.adminOverride === true || data.banned === true || data.suspended === true || data.accountSuspended === true || data.marketBanned === true || data.role === 'admin') {
      throw Object.assign(new Error('Only an expired, unpaid Trial can be extended.'), { status: 403 });
    }
    if (data.walletFrozen) throw Object.assign(new Error('Your wallet is on hold. Contact support.'), { status: 403 });
    const balance = Number(data.walletBalance || 0);
    if (!Number.isSafeInteger(balance) || balance < 100) throw Object.assign(new Error('You need 100 tokens to extend your Trial by 7 days.'), { status: 402 });
    const now = Date.now();
    const expiresAt = admin().firestore.Timestamp.fromMillis(now + 7 * 24 * 60 * 60 * 1000);
    const balanceAfter = balance - 100;
    tx.update(userRef, {
      walletBalance: balanceAfter,
      'freeTrial.status': 'active',
      'freeTrial.expiresAt': expiresAt,
      'freeTrial.durationDays': 7,
      status: 'active_member',
      trialExtensionCount: admin().firestore.FieldValue.increment(1),
      lastTrialExtensionAt: ts(),
      lastTrialExtensionMethod: 'wallet_tokens'
    });
    tx.create(ledgerRef, {
      type: 'trial_extension_tokens', amount: -100, note: '7-day Trial extension',
      status: 'completed', createdAt: ts(), balanceAfter, trialExpiresAt: expiresAt,
      requestId
    });
    result = { ok: true, balance: balanceAfter, expiresAt: expiresAt.toDate().toISOString() };
  });
  return result;
}

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


async function sendImages(uid, body) {
  const { toUID } = body;
  const imageURLs = Array.isArray(body.imageURLs) ? body.imageURLs : [body.imageURL];
  if (!toUID || toUID === uid || imageURLs.length < 1 || imageURLs.length > 10) {
    throw new Error('Choose between 1 and 10 images for this conversation.');
  }
  for (const imageURL of imageURLs) {
    let parsed;
    try { parsed = new URL(imageURL); } catch (_) { throw new Error('One of the image URLs is invalid.'); }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') {
      throw new Error('Only hosted DateVault images can be sent.');
    }
  }

  const conversationId = [uid, toUID].sort().join('_');
  const senderRef = _db.collection('users').doc(uid);
  const recipientRef = _db.collection('users').doc(toUID);
  const matchRef = _db.collection('matches').doc(conversationId);
  const mineBlockRef = senderRef.collection('blocked').doc(toUID);
  const theirBlockRef = recipientRef.collection('blocked').doc(uid);
  const messageRefs = imageURLs.map(() => matchRef.collection('messages').doc());
  let balance = 0, cost = null, sentCount = 0;

  // Select the affordable prefix and write all selected messages plus one
  // aggregate debit in the same transaction, so the wallet can never be
  // charged for an image that was not added to the conversation.
  await _db.runTransaction(async tx => {
    const [sender, recipient, match, mineBlock, theirBlock] = await Promise.all([
      tx.get(senderRef), tx.get(recipientRef), tx.get(matchRef), tx.get(mineBlockRef), tx.get(theirBlockRef)
    ]);
    if (!sender.exists || !recipient.exists || !match.exists || match.data()?.unmatched) {
      throw new Error('You can only send photos to an active match.');
    }
    if (mineBlock.exists || theirBlock.exists) throw new Error('Messaging is blocked for this conversation.');

    const profile = sender.data();
    cost = photoMessageCost(profile);
    if (cost === null) throw new Error('An active membership is required to send photos.');
    const current = Number(profile.walletBalance || 0);
    sentCount = cost === 0 ? imageURLs.length : Math.min(imageURLs.length, Math.floor(current / cost));
    if (sentCount < 1) {
      throw Object.assign(new Error('Not enough tokens. Each photo costs 30 tokens. Buy tokens in your Wallet.'), {
        status: 402, balance: current, cost, required: cost
      });
    }

    const totalCost = sentCount * cost;
    balance = current - totalCost;
    if (totalCost > 0) {
      tx.update(senderRef, { walletBalance: balance });
      tx.set(txn(uid), {
        type: 'chat_image', amount: -totalCost, imageCount: sentCount, toUID,
        note: sentCount === 1 ? 'Photo message' : `${sentCount} photo messages`,
        createdAt: ts(), status: 'completed'
      });
    }
    for (let i = 0; i < sentCount; i++) {
      tx.set(messageRefs[i], { senderUID: uid, text: null, imageURL: imageURLs[i], sentAt: ts(), read: false });
    }
    tx.update(matchRef, {
      lastMessage: sentCount === 1 ? 'Photo' : `${sentCount} photos`,
      lastMessageAt: ts(), [`hasUnread_${toUID}`]: true
    });
  });

  return {
    ok: true, balance, cost, imagesSent: sentCount,
    imagesSkipped: imageURLs.length - sentCount,
    messageIds: messageRefs.slice(0, sentCount).map(ref => ref.id)
  };
}

async function sendVideo(uid, body) {
  const { toUID, videoURL } = body;
  if (!toUID || toUID === uid || typeof videoURL !== 'string') throw new Error('Choose one video for this conversation.');
  let parsed;
  try { parsed = new URL(videoURL); } catch (_) { throw new Error('The video URL is invalid.'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com' || !/(?:^|\/)video\/upload\//.test(parsed.pathname)) {
    throw new Error('Only securely hosted DateVault chat videos can be sent.');
  }
  const conversationId = [uid, toUID].sort().join('_');
  const senderRef = _db.collection('users').doc(uid), recipientRef = _db.collection('users').doc(toUID);
  const matchRef = _db.collection('matches').doc(conversationId);
  const mineBlockRef = senderRef.collection('blocked').doc(toUID), theirBlockRef = recipientRef.collection('blocked').doc(uid);
  const messageRef = matchRef.collection('messages').doc();
  let balance = 0, cost = null;
  await _db.runTransaction(async tx => {
    const [sender, recipient, match, mineBlock, theirBlock] = await Promise.all([tx.get(senderRef), tx.get(recipientRef), tx.get(matchRef), tx.get(mineBlockRef), tx.get(theirBlockRef)]);
    if (!sender.exists || !recipient.exists || !match.exists || match.data()?.unmatched) throw new Error('You can only send videos to an active match.');
    if (mineBlock.exists || theirBlock.exists) throw new Error('Messaging is blocked for this conversation.');
    const profile = sender.data();
    cost = videoMessageCost(profile);
    if (cost === null) throw new Error('An active membership is required to send videos.');
    if (profile.walletFrozen || profile.banned || profile.suspended || profile.accountSuspended) throw new Error('Your wallet or account is currently restricted.');
    const current = Number(profile.walletBalance || 0);
    if (!Number.isSafeInteger(current) || current < cost) throw Object.assign(new Error('Not enough tokens. Trial and Standard videos cost 40 tokens; Elite and Vault videos cost 20 tokens.'), { status: 402, balance: current, cost, required: cost });
    balance = current - cost;
    tx.update(senderRef, { walletBalance: balance });
    tx.set(txn(uid), { type: 'chat_video', amount: -cost, toUID, note: 'Video message', createdAt: ts(), status: 'completed' });
    tx.set(messageRef, { senderUID: uid, text: null, videoURL, sentAt: ts(), read: false, likedBy: [] });
    tx.update(matchRef, { lastMessage: 'Video', lastMessageAt: ts(), ['hasUnread_' + toUID]: true });
  });
  return { ok: true, balance, cost, messageId: messageRef.id };
}
exports.handler = async event => {
  const options = preflight(event);
  if (options) return options;
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST required' });
    const user = await caller(event), body = parseBody(event);
    const data = body.action === 'extend_trial_tokens' ? await extendTrialWithTokens(user.uid, body)
      : body.action === 'gift' ? await gift(user.uid, body)
      : body.action === 'withdraw' ? await withdraw(user.uid, body)
      : body.action === 'boost' ? await boost(user.uid)
      : body.action === 'superlike_pack' ? await addon(user.uid, 'superlike_pack')
      : body.action === 'incognito' ? await addon(user.uid, 'incognito')
      : body.action === 'send_image' || body.action === 'send_images' ? await sendImages(user.uid, body)
      : body.action === 'send_video' ? await sendVideo(user.uid, body)
      : null;
    if (!data) return json(400, { error: 'Unknown wallet action' });
    return json(200, data);
  } catch (error) {
    console.error('Wallet function failed', error);
    return json(error.status || 400, { error: error.message || 'Wallet request failed' });
  }
};
