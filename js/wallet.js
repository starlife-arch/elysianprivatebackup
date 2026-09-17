import { db } from './firebase.js';
import { doc, getDoc, collection, addDoc, query, orderBy, limit as firestoreLimit, getDocs, runTransaction, serverTimestamp, increment } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const MIN_GIFT = 10;
const WITHDRAWAL_TOKENS = 3000;
const WITHDRAWAL_PAYOUT = 15;

const amountOf = value => Math.floor(Number(value));

export async function getWalletBalance(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? Number(snap.data().walletBalance || 0) : 0;
}

export async function creditTokens(uid, amount, note = '', type = 'credit') {
  amount = amountOf(amount);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Token amount must be positive.');
  await runTransaction(db, async transaction => {
    const userRef = doc(db, 'users', uid);
    const user = await transaction.get(userRef);
    if (!user.exists()) throw new Error('Member not found.');
    transaction.set(userRef, { walletBalance: increment(amount) }, { merge: true });
    transaction.set(doc(collection(db, 'users', uid, 'walletTransactions')), { type, amount, note, createdAt: serverTimestamp(), status: 'completed' });
  });
}

export async function debitTokens(uid, amount, note = '', type = 'debit') {
  amount = amountOf(amount);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Token amount must be positive.');
  await runTransaction(db, async transaction => {
    const userRef = doc(db, 'users', uid);
    const user = await transaction.get(userRef);
    const balance = Number(user.data()?.walletBalance || 0);
    if (!user.exists() || balance < amount) throw new Error('Not enough tokens — buy tokens in your wallet.');
    transaction.update(userRef, { walletBalance: balance - amount });
    transaction.set(doc(collection(db, 'users', uid, 'walletTransactions')), { type, amount, note, createdAt: serverTimestamp(), status: 'completed' });
  });
}

export async function giftTokens(fromUID, toUID, amount) {
  amount = amountOf(amount);
  if (fromUID === toUID) throw new Error('You cannot send a gift to yourself.');
  if (!Number.isInteger(amount) || amount < MIN_GIFT) throw new Error(`Gifts must be at least ${MIN_GIFT} tokens.`);
  let sender = {};
  await runTransaction(db, async transaction => {
    const fromRef = doc(db, 'users', fromUID), toRef = doc(db, 'users', toUID);
    const [from, to] = await Promise.all([transaction.get(fromRef), transaction.get(toRef)]);
    if (!from.exists() || !to.exists()) throw new Error('Member not found.');
    if (Number(from.data().walletBalance || 0) < amount) throw new Error('Not enough tokens — buy tokens in your wallet.');
    sender = from.data();
    transaction.update(fromRef, { walletBalance: Number(from.data().walletBalance || 0) - amount });
    transaction.set(toRef, { walletBalance: increment(amount) }, { merge: true });
    transaction.set(doc(collection(db, 'users', fromUID, 'walletTransactions')), { type: 'gift_sent', amount, toUID, note: 'Gift sent', createdAt: serverTimestamp(), status: 'completed' });
    transaction.set(doc(collection(db, 'users', toUID, 'walletTransactions')), { type: 'gift_received', amount, fromUID, note: 'Gift received', createdAt: serverTimestamp(), status: 'completed' });
  });
  await addDoc(collection(db, 'admin_messages'), { toUID, message: `🎁 ${sender.displayName || sender.name || 'A member'} sent you ${amount} tokens!`, sentAt: serverTimestamp(), read: false, walletEvent: true });
  return getWalletBalance(fromUID);
}

export async function requestWithdrawal(uid, method, details) {
  if (!['Bank', 'M-Pesa', 'PayPal', 'Crypto BEP-20'].includes(method)) throw new Error('Select a withdrawal method.');
  if (!String(details || '').trim()) throw new Error('Enter your payout details.');
  const withdrawalRef = doc(collection(db, 'withdrawals'));
  await runTransaction(db, async transaction => {
    const userRef = doc(db, 'users', uid);
    const user = await transaction.get(userRef);
    if (!user.exists() || Number(user.data().walletBalance || 0) < WITHDRAWAL_TOKENS) throw new Error('You need at least 3,000 tokens to withdraw.');
    transaction.update(userRef, { walletBalance: Number(user.data().walletBalance || 0) - WITHDRAWAL_TOKENS });
    transaction.set(withdrawalRef, { uid, tokens: WITHDRAWAL_TOKENS, payout: WITHDRAWAL_PAYOUT, method, details: String(details).trim(), status: 'pending', createdAt: serverTimestamp(), processedAt: null, processedBy: null });
    transaction.set(doc(collection(db, 'users', uid, 'walletTransactions')), { type: 'withdrawal_request', amount: WITHDRAWAL_TOKENS, note: `$${WITHDRAWAL_PAYOUT} withdrawal requested via ${method}`, createdAt: serverTimestamp(), status: 'pending' });
  });
  return withdrawalRef.id;
}

export async function getTransactionHistory(uid, max = 20) {
  const snap = await getDocs(query(collection(db, 'users', uid, 'walletTransactions'), orderBy('createdAt', 'desc'), firestoreLimit(Math.min(Number(max) || 20, 50))));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }));
}

export { MIN_GIFT, WITHDRAWAL_TOKENS, WITHDRAWAL_PAYOUT };
