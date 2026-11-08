const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { videoCallPrice, photoMessageCost } = require('../netlify/functions/membership-billing');

const now = Date.parse('2026-11-08T00:00:00Z');
const future = new Date(now + 86400000).toISOString();
const tiers = [
  ['Free Trial', { freeTrial: { status: 'active', expiresAt: future }, plan: 'standard' }, 100, 30],
  ['Standard', { paid: true, plan: 'standard' }, 50, 30],
  ['Elite', { paid: true, plan: 'elite' }, 50, 0],
  ['Vault', { paid: true, plan: 'vault' }, 50, 0]
];

for (const [name, profile, callCost, photoCost] of tiers) {
  test(name + ' membership pricing', () => {
    assert.equal(videoCallPrice(profile, now), callCost);
    assert.equal(photoMessageCost(profile, now), photoCost);
  });
}

test('expired free trial without paid membership is not eligible', () => {
  const profile = { freeTrial: { status: 'active', expiresAt: new Date(now - 1000).toISOString() }, plan: 'standard' };
  assert.equal(videoCallPrice(profile, now), null);
  assert.equal(photoMessageCost(profile, now), null);
});

test('expired active subscription is not eligible', () => {
  const profile = { hasPaid: true, subscription: { plan: 'elite', status: 'active', nextBillingDate: new Date(now - 1000).toISOString() } };
  assert.equal(videoCallPrice(profile, now), null);
  assert.equal(photoMessageCost(profile, now), null);
});

test('photo charge, message writes and wallet deduction remain in one transaction', () => {
  const source = fs.readFileSync(path.join(__dirname, '../netlify/functions/wallet.js'), 'utf8');
  const sendImages = source.slice(source.indexOf('async function sendImages'), source.indexOf('exports.handler'));
  assert.match(source, /body\\.action === 'send_image' \\|\\| body\\.action === 'send_images' \\? await sendImages\\(user\\.uid, body\\)/);
  assert.match(sendImages, /await _db\\.runTransaction\\(async tx =>/);
  assert.match(sendImages, /tx\\.update\\(senderRef/);
  assert.match(sendImages, /tx\\.set\\(messageRefs\\[i\\]/);
  assert.match(sendImages, /photoMessageCost\\(profile\\)/);
});

test('client prevents duplicate in-flight batch photo sends', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/chat/index.html'), 'utf8');
  assert.match(source, /if \\(!selected\\.length \\|\\| !recipient \\|\\| sendingImage\\) return;/);
  assert.match(source, /sendingImage = true;/);
  assert.match(source, /finally \\{[\\s\\S]*sendingImage = false;/);
});

test('video-call setup failures issue a wallet refund ledger entry', () => {
  const source = fs.readFileSync(path.join(__dirname, '../netlify/functions/video-call.js'), 'utf8');
  assert.match(source, /async function refund\(uid, cost, chargeTransactionId\)/);
  assert.match(source, /type: 'call_refund'/);
  assert.match(source, /await refund\(user\.uid, callCost, chargeInfo\.transactionId\)/);
});

test('low token balance is rejected before a photo debit', () => {
  const source = fs.readFileSync(path.join(__dirname, '../netlify/functions/wallet.js'), 'utf8');
  const sendImage = source.slice(source.indexOf('async function sendImage'), source.indexOf('exports.handler'));
  assert.ok(sendImage.indexOf('if (current < cost)') < sendImage.indexOf('tx.update(senderRef'));
  assert.match(sendImage, /status: 402, balance: current, cost/);
});

test('empty swipe deck stays empty and previously swiped profiles are not recycled', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '../app/dashboard/index.html'), 'utf8');
  const swipe = fs.readFileSync(path.join(__dirname, '../js/swipe.js'), 'utf8');
  assert.match(dashboard, /if \(profiles\.length === 0\) \{\s*deck\.replaceChildren\(\);\s*return;/);
  assert.match(swipe, /swipedUIDs\.has\(d\.id\)/);
  assert.match(swipe, /swipedUIDs\.add\(currentUser\.uid\)/);
});


test('expired access routes to renewal without a forbidden client-side membership write', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8');
  assert.doesNotMatch(source, /async function expireAccess\s*\(/);
  assert.match(source, /if \(isAccessExpired\(d\)\) \{[\s\S]*?\/account\/payment\//);
  assert.doesNotMatch(source, /if \(profile && isAccessExpired\(profile\)\) await expireAccess/);
});

test('Firestore rules preserve self profile access and protect wallet/payment mutations', () => {
  const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
  assert.match(rules, /match \/users\/\{uid\} \{[\s\S]*?allow read: if isOwner\(uid\)/);
  assert.match(rules, /allow create: if isOwner\(uid\)/);
  assert.match(rules, /walletBalance/);
  assert.match(rules, /match \/payments\/\{paymentId\} \{[\s\S]*?allow create, update, delete: if isAdmin\(\)/);
  assert.match(rules, /match \/otp_verifications\/\{otpId\} \{\s*allow read, write: if false;/);
});


test('expired active members enter renewal checkout without requiring a used invite token', () => {
  const auth = fs.readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8');
  const payment = fs.readFileSync(path.join(__dirname, '../account/payment/index.html'), 'utf8');
  assert.match(auth, /window\.location\.href = ["']\/account\/payment\/\?renewal=1["']/);
  assert.match(payment, /const isRenewal = params\.get\('renewal'\) === '1'/);
  assert.match(payment, /isRenewal && profile\.status === 'active_member'/);
  assert.match(payment, /!isRenewal && !isPesapalCallback && inviteToken/);
  assert.match(payment, /purpose !== 'entry' \|\| isRenewal \|\| !inviteToken/);
});

test('chat page has no literal escaped newline tokens in executable JavaScript', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/chat/index.html'), 'utf8');
  assert.doesNotMatch(source, /;assert.match(source, /if \\(\\!selected\\.length \\|\\| \\!recipient \\|\\| sendingImage\\) return;/);\\n\\s*item\.style/);
  assert.match(source, /item\.className = 'chat-item';\s*item\.style\.userSelect/);
});


test('chat block-state script contains real line breaks, not escaped newline tokens', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/chat/index.html'), 'utf8');
  assert.match(source, /const photoCost = imageTokenCost\(\);\s+const canSendPhotos = photoCost !== null;/);
  assert.doesNotMatch(source, /imageTokenCost\(\);\\\\n\s*const canSendPhotos/);
  assert.doesNotMatch(source, /const canSendPhotos = photoCost !== null;\\\\n/);
});


test('every chat conversation has a defined, non-throwing photo cost helper', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/chat/index.html'), 'utf8');
  assert.match(source, /import \{[^}]*hasActiveMembership[^}]*isSubscriptionExpired[^}]*\} from ["']\.\.\/\.\.\/js\/subscription\.js["']/);
  assert.match(source, /function imageTokenCost\(\) \{[\s\S]*?hasActiveMembership\(myProfile\)[\s\S]*?isSubscriptionExpired\(myProfile\)[\s\S]*?return \['elite', 'vault'\]\.includes\(plan\) \? 0 : 30;/);
  assert.match(source, /function applyBlockState\(\) \{[\s\S]*?const photoCost = imageTokenCost\(\);/);
});

test('chat initialization can proceed independently of photo entitlement', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/chat/index.html'), 'utf8');
  const openChat = source.slice(source.indexOf('async function openChat(uid)'), source.indexOf('function refreshBlockState(uid)'));
  assert.match(openChat, /applyBlockState\(\);\s*unsubMessages = listenMessages/);
  const costHelper = source.slice(source.indexOf('function imageTokenCost()'), source.indexOf('function isStandardPlan()'));
  assert.match(costHelper, /catch \(error\)/);
  assert.match(costHelper, /return null;/);
});


test('video-call handler uses the initialized Firestore database object', () => {
  const source = fs.readFileSync(path.join(__dirname, '../netlify/functions/video-call.js'), 'utf8');
  assert.match(source, /db = firebase\.firestore\(\)/);
  assert.match(source, /db\.collection\('users'\)/);
  assert.doesNotMatch(source, /\bdb\(\)\s*\./);
});

test('batch photo sends atomically debit only the photos that the balance can afford', () => {
  const source = fs.readFileSync(path.join(__dirname, '../netlify/functions/wallet.js'), 'utf8');
  const sendImages = source.slice(source.indexOf('async function sendImages'), source.indexOf('exports.handler'));
  assert.match(source, /body\.action === 'send_image' \|\| body\.action === 'send_images' \? await sendImages/);
  assert.match(sendImages, /Math\.min\(imageURLs\.length, Math\.floor\(current \/ cost\)\)/);
  assert.match(sendImages, /const totalCost = sentCount \* cost/);
  assert.match(sendImages, /amount: -totalCost/);
  assert.match(sendImages, /imagesSkipped: imageURLs\.length - sentCount/);
  assert.match(sendImages, /await _db\.runTransaction\(async tx =>/);
  assert.match(sendImages, /for \(let i = 0; i < sentCount; i\+\+\)/);
});

test('chat photo picker supports multiple images and batches the send', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/chat/index.html'), 'utf8');
  assert.match(source, /id="imgInput"[^>]*multiple/);
  assert.match(source, /const selected = Array\.from\(input\.files \|\| \[\]\)/);
  assert.match(source, /action: 'send_images'/);
  assert.match(source, /filesToSend = selected\.slice\(0, affordableCount\)/);
});

test('photo debits display as red outgoing wallet activity with one minus sign', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/wallet-page.js'), 'utf8');
  assert.match(source, /'chat_image'/);
  assert.match(source, /amount = Math\.abs\(Number\(t\.amount \|\| 0\)\)/);
  assert.match(source, /outgoingTransaction \? '−' : '\+'/);
  assert.match(source, /outgoingTransaction \? 'var\(--danger\)' : 'var\(--success\)'/);
});

test('login and signup password fields have working accessible visibility icons', () => {
  for (const page of ['auth/login/index.html', 'auth/signup/index.html']) {
    const source = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    assert.match(source, /aria-label="Show password"[^>]*>\\s*<svg/);
    assert.match(source, /btn\.innerHTML = showing \? '[^']*<svg/);
    assert.match(source, /aria-pressed/);
  }
});

test('custom wallet token purchases require at least 30 tokens and validate custom pricing server-side', () => {
  const walletHtml = fs.readFileSync(path.join(__dirname, '../app/wallet/index.html'), 'utf8');
  const walletPage = fs.readFileSync(path.join(__dirname, '../js/wallet-page.js'), 'utf8');
  const printpay = fs.readFileSync(path.join(__dirname, '../netlify/functions/printpay.js'), 'utf8');
  assert.match(walletHtml, /id="customTokenAmount" type="number" min="30"/);
  assert.match(walletPage, /Number\.isSafeInteger\(tokens\) && tokens >= 30/);
  assert.match(walletPage, /tokens \/ 100/);
  assert.match(printpay, /tokenCount >= 30/);
  assert.match(printpay, /usd - tokenCount \/ 100/);
});
