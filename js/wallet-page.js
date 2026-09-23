import { requireActiveMember, db } from './auth.js';
import { listenForNotifications } from './notifications.js';
import { startCallListener } from './call-listener.js';
import { getWalletBalance, getTransactionHistory, requestWithdrawal, WITHDRAWAL_TOKENS } from './wallet.js';
import { mountIcons, icon } from './icons.js';
import { openSheet } from './sheet.js';
import { collection, getDocs, query, where, orderBy, doc, getDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

mountIcons();
const $ = id => document.getElementById(id);
const packs = [[100, 1], [500, 5], [1000, 10], [2000, 20], [5000, 50], [10000, 90]];
let uid, balance = 0, frozen = false, history = [], stopNotifications = null;

function showToast(message) {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

function failure(error) {
  console.error('Wallet load failed', error);
  $('walletError').hidden = false;
  $('walletError').innerHTML = `Couldn't load your wallet — <button class="btn btn-outline" id="walletRetry">Retry</button>`;
  $('walletRetry').onclick = load;
}

function renderPacks() {
  $('packs').innerHTML = packs.map(([tokens, usd]) => `<a class="payment-option ${frozen ? 'disabled' : ''}" ${frozen ? 'aria-disabled="true"' : `href="/account/payment/?purpose=tokens&tokens=${tokens}&amount=${usd}"`}>${icon('wallet')}<div><b>${tokens.toLocaleString()} tokens</b><div class="muted">$${usd}</div></div>${icon('plus')}</a>`).join('');
}

async function loadPricingCfg() {
  try {
    const snap = await getDoc(doc(db, 'config', 'pricing'));
    return snap.exists() ? snap.data() : {};
  } catch {
    return {};
  }
}

function isAddonActive(addon) {
  if (!addon?.active) return false;
  if (!addon.expiresAt) return true;
  const expiresAt = addon.expiresAt?.toDate?.() ? addon.expiresAt.toDate() : new Date(addon.expiresAt);
  return expiresAt > new Date();
}

function renderAddons(profile, cfg) {
  const addons = profile.addons || {};
  const addonList = [
    { key: 'boost', action: 'boost', label: 'Profile Boost', detail: '24-hour top placement', defaultTokens: 299, defaultUsd: 2.99, addonUrlKey: 'boost' },
    { key: 'superlikePack', action: 'superlike_pack', label: 'Super Like Pack', detail: '10 super likes added to your account', defaultTokens: 499, defaultUsd: 4.99, addonUrlKey: 'superlike_pack' },
    { key: 'incognito', action: 'incognito', label: 'Incognito Mode', detail: 'Browse without appearing in Discover or Explore', defaultTokens: 399, defaultUsd: 3.99, addonUrlKey: 'incognito' }
  ];
  const el = $('addonsList');
  if (!el) return;

  el.innerHTML = addonList.map(item => {
    const cfgItem = cfg?.addons?.[item.key] || {};
    const tokens = Number(cfgItem.tokens) || item.defaultTokens;
    const usd = Number(cfgItem.usd) || item.defaultUsd;
    const addon = addons[item.key];
    let statusHtml = '';
    if (isAddonActive(addon)) {
      if (item.key === 'superlikePack') {
        statusHtml = `<div class="status-badge status-active" style="margin-bottom:0.5rem;">${Number(addon.remainingUses || 0)} super likes remaining</div>`;
      } else {
        const expiresAt = addon.expiresAt?.toDate?.() ? addon.expiresAt.toDate() : new Date(addon.expiresAt);
        statusHtml = `<div class="status-badge status-active" style="margin-bottom:0.5rem;">Active until ${expiresAt.toLocaleDateString()} ${expiresAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>`;
      }
    }
    return `<div class="glass-card" style="margin-bottom:0.75rem;"><div style="font-weight:600;margin-bottom:0.25rem;">${item.label}</div><div class="muted" style="font-size:13px;margin-bottom:0.5rem;">${item.detail}</div>${statusHtml}<div style="font-size:13px;color:var(--gold);margin-bottom:0.75rem;">${tokens} tokens or $${usd.toFixed(2)}</div><div style="display:flex;gap:0.5rem;"><button class="btn btn-gold btn-sm" id="addonTokenBtn-${item.key}" onclick="buyAddonWithTokens('${item.action}', '${item.label}', '${item.key}')">Buy with Tokens</button><a class="btn btn-outline btn-sm" href="/account/payment/?purpose=addon&addon=${item.addonUrlKey}&amount=${usd}">Buy with USD</a></div></div>`;
  }).join('');
}

window.buyAddonWithTokens = async function(action, label, key) {
  const button = document.getElementById(`addonTokenBtn-${key}`);
  if (button) { button.disabled = true; button.textContent = 'Processing...'; }
  try {
    const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    const token = await getAuth().currentUser?.getIdToken();
    const response = await fetch('/.netlify/functions/wallet', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action }) });
    const data = await response.json();
    if (!response.ok) { showToast(data.error || 'Purchase failed'); return; }
    showToast(`${label} activated`);
    await load();
  } catch (error) {
    showToast(error.message || 'Purchase failed');
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Buy with Tokens'; }
  }
};

function renderTx() {
  const outgoing = ['gift_sent', 'debit', 'admin_debit', 'withdrawal_request', 'call_charge', 'boost_purchase', 'superlike_pack_purchase', 'incognito_purchase'];
  const labels = { gift_sent: 'Sent', gift_received: 'Received', credit: 'Purchased', admin_credit: 'Admin added', admin_debit: 'Admin deducted', withdrawal_request: 'Withdrawal requested', withdrawal_refund: 'Withdrawal refunded', withdrawal_paid: 'Withdrawal paid', call_charge: 'Video call', call_refund: 'Call refund', boost_purchase: 'Profile Boost', superlike_pack_purchase: 'Super Like Pack', incognito_purchase: 'Incognito Mode' };
  $('transactions').innerHTML = history.length ? history.map(t => { const outgoingTransaction = outgoing.includes(t.type), amount = Number(t.amount || 0).toLocaleString(), label = labels[t.type] || t.note || t.type; return `<div style="display:flex;justify-content:space-between;padding:.6rem 0;border-bottom:1px solid var(--border)"><span>${icon(outgoingTransaction ? 'arrow-right' : 'arrow-left')} ${label} ${amount} tokens<div class="muted" style="font-size:11px">${t.note || ''}</div></span><b style="color:${outgoingTransaction ? 'var(--danger)' : 'var(--success)'}">${outgoingTransaction ? '−' : '+'}${amount}</b></div>`; }).join('') : '<p class="muted">No transactions yet.</p>';
}

function withdrawalSheet() { const sheet = openSheet({ label: 'Request withdrawal', content: `<h2>Request withdrawal</h2><p class="muted">3,000 tokens converts to $15.</p><div class="gift-amounts" id="methods">${[['Bank', 'card'], ['M-Pesa', 'phone'], ['PayPal', 'mail'], ['Crypto BEP-20', 'wallet']].map(([name, nameIcon]) => `<button class="gift-chip" data-method="${name}">${icon(nameIcon)}<small>${name}</small></button>`).join('')}</div><div id="details" style="margin-top:1rem"></div><div class="gift-error" id="withdrawError"></div><button class="btn btn-gold btn-full" id="withdrawConfirm" disabled>Continue</button>` }); let method = ''; const details = sheet.element.querySelector('#details'), confirm = sheet.element.querySelector('#withdrawConfirm'), error = sheet.element.querySelector('#withdrawError'); sheet.element.querySelector('#methods').onclick = event => { const button = event.target.closest('button'); if (!button) return; method = button.dataset.method; sheet.element.querySelectorAll('[data-method]').forEach(item => item.classList.toggle('selected', item === button)); details.innerHTML = method === 'Bank' ? '<input placeholder="Account name"><input placeholder="Account number"><input placeholder="Bank and branch">' : method === 'Crypto BEP-20' ? '<input placeholder="BEP-20 wallet address"><label><input type="checkbox"> I confirm this is BEP-20</label>' : `<input placeholder="${method === 'M-Pesa' ? 'M-Pesa phone number' : 'PayPal email'}">`; confirm.disabled = false; confirm.textContent = 'Request 3,000 tokens · $15'; }; confirm.onclick = async () => { const values = [...details.querySelectorAll('input')]; if (!values.length || values.some(input => input.type !== 'checkbox' && !input.value.trim()) || values.some(input => input.type === 'checkbox' && !input.checked)) { error.textContent = 'Complete the payout details.'; return; } confirm.disabled = true; try { await requestWithdrawal(uid, method, values.filter(input => input.type !== 'checkbox').map(input => input.value.trim()).join(' · ')); sheet.close(); load(); } catch (exception) { console.error('Withdrawal request failed', exception); error.textContent = exception.message; confirm.disabled = false; } }; }

async function expireStaleAddons(profile) {
  await Promise.all(['boost', 'superlikePack', 'incognito'].map(async key => {
    const addon = profile.addons?.[key];
    if (!addon?.active || !addon.expiresAt || isAddonActive(addon)) return;
    try {
      await updateDoc(doc(db, 'users', uid), { [`addons.${key}.active`]: false, [`addons.${key}.updatedAt`]: serverTimestamp() });
      profile.addons[key].active = false;
    } catch (_) {}
  }));
}

async function load() { $('walletError').hidden = true; try { const session = await requireActiveMember(); uid = session.user.uid; const profile = session.profile || {}; startCallListener(uid, profile); if (!stopNotifications) stopNotifications = listenForNotifications(uid, hasSomethingNew => { $('chatBadge').style.display = hasSomethingNew ? 'block' : 'none'; }); await expireStaleAddons(profile); balance = await getWalletBalance(uid); frozen = !!profile.walletFrozen; $('balance').textContent = balance.toLocaleString(); $('frozenBanner').hidden = !frozen; renderPacks(); const pricingCfg = await loadPricingCfg(); renderAddons(profile, pricingCfg); $('withdrawBtn').disabled = frozen || balance < WITHDRAWAL_TOKENS; $('withdrawalHint').textContent = frozen ? 'Your wallet is on hold — contact support' : balance < WITHDRAWAL_TOKENS ? `You need ${(WITHDRAWAL_TOKENS - balance).toLocaleString()} more tokens.` : '3,000 tokens converts to $15.'; $('withdrawBtn').onclick = withdrawalSheet; try { const withdrawals = await getDocs(query(collection(db, 'withdrawals'), where('uid', '==', uid), orderBy('createdAt', 'desc'))); $('withdrawals').innerHTML = withdrawals.docs.map(item => `<div>${item.data().status} · $${item.data().payout || 15}</div>`).join(''); } catch (error) { console.error('Could not load withdrawals', error); $('withdrawals').innerHTML = '<p class="gift-error">Couldn’t load withdrawal history.</p>'; } try { history = await getTransactionHistory(uid, 50); renderTx(); } catch (error) { console.error('Could not load wallet history', error); $('transactions').innerHTML = '<p class="gift-error">Couldn’t load activity.</p>'; } } catch (error) { failure(error); } finally { $('loader').classList.add('hidden'); } }

load();
