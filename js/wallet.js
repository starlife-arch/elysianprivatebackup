import { db } from './firebase.js';
import { doc, getDoc, collection, addDoc, query, orderBy, limit as firestoreLimit, getDocs, runTransaction, serverTimestamp, increment } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const MIN_GIFT = 10;
const WITHDRAWAL_TOKENS = 3000;
const WITHDRAWAL_PAYOUT = 15;
const BOOST_COST = 299;
const BOOST_DURATION_MINUTES = 1440;

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

export async function giftTokens(fromUID, toUID, amount, note = '') {
  const token = await (await import('./firebase.js')).auth.currentUser?.getIdToken();
  const response = await fetch('/api/wallet', { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:JSON.stringify({action:'gift',toUID,amount,note}) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not send gift.'); return getWalletBalance(fromUID);
}

export async function requestWithdrawal(uid, method, details) {
  const token = await (await import('./firebase.js')).auth.currentUser?.getIdToken();
  const response = await fetch('/api/wallet', { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:JSON.stringify({action:'withdraw',method,details}) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not request withdrawal.'); return data.id;
}

export async function purchaseBoost() {
  const token = await (await import('./firebase.js')).auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sign in required.');
  const response = await fetch('/api/wallet', { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:JSON.stringify({action:'boost'}) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not purchase a profile boost.'); return data;
}

export function getBoostRemainingMs(profile = {}) {
  const expires = profile.boostExpiresAt;
  if (!profile.boostActive || !expires) return 0;
  const ms = typeof expires.toMillis === 'function' ? expires.toMillis() : new Date(expires).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms - Date.now()) : 0;
}

export async function getTransactionHistory(uid, max = 20) {
  const snap = await getDocs(query(collection(db, 'users', uid, 'walletTransactions'), orderBy('createdAt', 'desc'), firestoreLimit(Math.min(Number(max) || 20, 50))));
  return snap.docs.map(item => ({ id: item.id, ...item.data() }));
}

export { MIN_GIFT, WITHDRAWAL_TOKENS, WITHDRAWAL_PAYOUT, BOOST_COST, BOOST_DURATION_MINUTES };
