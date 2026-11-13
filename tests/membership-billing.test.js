const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { videoCallPrice, photoMessageCost, videoMessageCost } = require('../netlify/functions/membership-billing');

const now = Date.parse('2026-11-08T00:00:00Z');
const future = new Date(now + 86400000).toISOString();
const tiers = [
  ['Free Trial', { freeTrial: { status: 'active', expiresAt: future }, plan: 'standard' }, 100, 30, 40],
  ['Standard', { paid: true, plan: 'standard' }, 50, 30, 40],
  ['Elite', { paid: true, plan: 'elite' }, 50, 0, 20],
  ['Vault', { paid: true, plan: 'vault' }, 50, 0, 20]
];

for (const [name, profile, callCost, photoCost, videoCost] of tiers) {
  test(name + ' membership pricing', () => {
    assert.equal(videoCallPrice(profile, now), callCost);
    assert.equal(photoMessageCost(profile, now), photoCost);
    assert.equal(videoMessageCost(profile, now), videoCost);
  });
}

test('expired free trial without paid membership is not eligible', () => {
  const profile = { freeTrial: { status: 'active', expiresAt: new Date(now - 1000).toISOString() }, plan: 'standard' };
  assert.equal(videoCallPrice(profile, now), null);
  assert.equal(photoMessageCost(profile, now), null);
  assert.equal(videoMessageCost(profile, now), null);
});

test('expired Elite or Vault subscriptions fall back to Standard entitlements', () => {
  const profile = { hasPaid: true, plan: 'elite', subscription: { plan: 'elite', status: 'active', nextBillingDate: new Date(now - 1000).toISOString() } };
  assert.equal(videoCallPrice(profile, now), 50);
  assert.equal(photoMessageCost(profile, now), 30);
});

test('photo charge, message writes and wallet deduction remain in one transaction', () => {
  const source = fs.readFileSync(path.join(__dirname, '../netlify/functions/wallet.js'), 'utf8');
  const sendImages = source.slice(source.indexOf('async function sendImages'), source.indexOf('exports.handler'));
  assert.ok(source.includes("body.action === 'send_image' || body.action === 'send_images' ? await sendImages(user.uid, body)"));
  assert.ok(sendImages.includes('await _db.runTransaction(async tx =>'));
  assert.ok(sendImages.includes('tx.update(senderRef'));
  assert.ok(sendImages.includes('tx.set(messageRefs[i]'));
  assert.ok(sendImages.includes('photoMessageCost(profile)'));
});

test('client prevents duplicate in-flight batch photo sends', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/chat/index.html'), 'utf8');
  assert.ok(source.includes('if (!selected.length || !recipient || sendingImage) return;'));
  assert.ok(source.includes('sendingImage = true;'));
  assert.ok(source.includes('sendingImage = false;'));
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


test('expired access remains in the app without a forbidden client-side membership write', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8');
  assert.doesNotMatch(source, /async function expireAccess\s*\(/);
  assert.match(source, /if \(isAccessExpired\(d\)\) \{[\s\S]*?window\.location\.href = ["']\/app\/dashboard\/["']/);
  assert.doesNotMatch(source, /if \(isAccessExpired\(d\)\) \{[\s\S]*?window\.location\.href = ["']\/account\/payment\//);
  assert.match(source, /An expired membership is not an authentication failure/);
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


test('expired members can navigate away from renewal and switch accounts', () => {
  const auth = fs.readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8');
  const payment = fs.readFileSync(path.join(__dirname, '../account/payment/index.html'), 'utf8');
  assert.match(auth, /window\.location\.href = ["']\/app\/dashboard\/["']/);
  assert.doesNotMatch(auth, /window\.location\.href = ["']\/account\/payment\/\?renewal=1["']/);
  assert.match(payment, /id="switchAccountButton"/);
  assert.match(payment, /await logout\(\)/);
  assert.match(payment, /const isRenewal = params\.get\('renewal'\) === '1'/);
  assert.match(payment, /isRenewal && profile\.status === 'active_member'/);
  assert.match(payment, /!isRenewal && !isPesapalCallback && inviteToken/);
  assert.match(payment, /purpose !== 'entry' \|\| isRenewal \|\| trialExpiredCheckout \|\| !inviteToken/);
});

test('chat page has no literal escaped newline tokens in executable JavaScript', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/chat/index.html'), 'utf8');
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
    assert.ok(source.includes('aria-label="Show password" aria-pressed="false"'));
    assert.ok(source.includes('<svg width="20" height="20"'));
    assert.ok(source.includes('btn.innerHTML = showing ?'));
    assert.ok(source.includes("btn.setAttribute('aria-pressed', String(!showing))"));
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

test('paid Trial extension is fixed-price, eligibility-checked and does not grant extra allowances', () => {
  const source = fs.readFileSync(path.join(__dirname, '../netlify/functions/printpay.js'), 'utf8');
  assert.match(source, /purpose === 'trial_extension'[\s\S]*?Number\(amountUSD\) !== 1 \|\| kes !== 130/);
  assert.match(source, /trial\.status !== 'expired'[\s\S]*?user\.paid === true/);
  const start = source.slice(source.indexOf("if (purpose === 'trial_extension')"), source.indexOf("if (!['entry'", source.indexOf("if (purpose === 'trial_extension')")));
  assert.match(start, /A 7-day Trial extension costs exactly \$1 \(KES 130\)/);
  const completeStart = source.indexOf("async function complete");
  const extensionStart = source.indexOf("} else if (payment.purpose === 'trial_extension')", completeStart);
  const extension = source.slice(extensionStart, source.indexOf("} else if (payment.purpose === 'priority_support')", extensionStart));
  assert.match(extension, /'freeTrial\.expiresAt': nextExpiry/);
  assert.match(extension, /trialExtensionCount: getAdmin\(\)\.firestore\.FieldValue\.increment\(1\)/);
  assert.doesNotMatch(extension, /likesRemaining|passesRemaining|likesGranted|passesGranted|walletBalance/);
});

test('only expired unpaid Trial accounts receive the two checkout choices', () => {
  const auth = fs.readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8');
  const payment = fs.readFileSync(path.join(__dirname, '../account/payment/index.html'), 'utf8');
  assert.match(auth, /d\.freeTrial\?\.status === "expired" && d\.paid !== true && d\.hasPaid !== true[\s\S]*?trialExpired=1/);
  assert.match(payment, /trialCheckoutChoices/);
  assert.match(payment, /selectTrialCheckout\('trial_extension'\)/);
  assert.match(payment, /isExpiredUnpaidTrial\(profile\)/);
  assert.match(payment, /purpose === 'entry' \|\| purpose === 'trial_extension'/);
});

test('expired-trial payment page has valid price rendering and no duplicated trailing document', () => {
  const payment = fs.readFileSync(path.join(__dirname, '../account/payment/index.html'), 'utf8');
  assert.ok(payment.includes("document.getElementById('paymentPrice').textContent = '$' + amountUSD.toFixed(2);"));
  assert.equal(payment.split('</html>').length - 1, 1);
  assert.ok(payment.trimEnd().endsWith('</html>'));
  assert.equal(payment.includes("textContent = '\\n"), false);
});


test('expired premium plans normalize to Standard even when legacy top-level plan remains premium', () => {
  const source = fs.readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8');
  const subscription = fs.readFileSync(path.join(__dirname, '../js/subscription.js'), 'utf8');
  assert.match(source, /activeMembership \? getSubscription\(profile\)\.plan/);
  assert.match(source, /const plan = getSubscription\(profile\)\.plan/);
  assert.match(subscription, /const previousPlan = storedSub\.plan \|\| profile\.plan \|\| 'standard'/);
  assert.match(subscription, /\.\.\.storedSub,[\s\S]*?plan: 'standard'[\s\S]*?status: 'expired'/);
});

test('paid expired subscription date remains valid through its final calendar day', () => {
  const { isPaidMember, effectivePlan, videoCallPrice, photoMessageCost } = require('../netlify/functions/membership-billing');
  const profile = {
    status: 'active_member', hasPaid: true, plan: 'vault',
    subscription: { plan: 'vault', status: 'active', nextBillingDate: '2026-11-12' }
  };
  assert.equal(isPaidMember(profile, Date.parse('2026-11-12T22:00:00Z')), true);
  assert.equal(isPaidMember(profile, Date.parse('2026-11-13T00:00:00Z')), true);
  assert.equal(effectivePlan(profile, Date.parse('2026-11-13T00:00:00Z')), 'standard');
  assert.equal(videoCallPrice(profile, Date.parse('2026-11-13T00:00:00Z')), 50);
  assert.equal(photoMessageCost(profile, Date.parse('2026-11-13T00:00:00Z')), 30);
});

test('super likes consume purchased pack uses in the same transaction except active Vault and active Trial', () => {
  const swipe = fs.readFileSync(path.join(__dirname, '../js/swipe.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(__dirname, '../app/dashboard/index.html'), 'utf8');
  const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
  assert.match(swipe, /if \(isSuperLike && !trialActive && !isActiveVaultPlan\(user\)\)/);
  assert.match(swipe, /'addons\.superlikePack\.remainingUses': remaining/);
  assert.match(rules, /function superLikePackSpent\(userPath\)/);
  assert.doesNotMatch(rules, /\|\| request\.resource\.data\.get\('isSuperLike', false\) == true/);
  assert.doesNotMatch(dashboard, /await updateDoc\(doc\(db, 'users', myUser\.uid\), \{\s*'addons\.superlikePack\.remainingUses'/);
});

test('message likes keep the simple Like/Liked control visible without extra reaction labels', () => {
  const chat = fs.readFileSync(path.join(__dirname, '../app/chat/index.html'), 'utf8');
  assert.match(chat, /const likedBy = Array\.isArray\(m\.likedBy\) \? m\.likedBy : \[\]/);
  assert.match(chat, /const liked = likedBy\.includes\(myUser\.uid\)/);
  assert.match(chat, /likedBy\.length/);
  assert.match(chat, /rgba\(255,70,105,\.28\)/);
  assert.match(chat, /aria-label', \(liked \? 'Unlike' : 'Like'\)/);
  assert.doesNotMatch(chat, /You liked this/);
  assert.doesNotMatch(chat, /theirProfile\?\.displayName/);
});
test('mobile bottom navigation uses shrinkable equal slots and a More menu for secondary actions', () => {
  const css = fs.readFileSync(path.join(__dirname, '../css/style.css'), 'utf8');
  const dashboard = fs.readFileSync(path.join(__dirname, '../app/dashboard/index.html'), 'utf8');
  assert.match(css, /\.bottom-nav \.nav-item\s*\{[^}]*flex: 1 1 0/);
  assert.match(css, /\.mobile-more-menu/);
  assert.match(dashboard, /id="mobileMoreButton"/);
  assert.match(dashboard, /id="moreCreatorMarket"/);
  assert.match(dashboard, /id="moreInstallApp"/);
});


test('expired premium membership keeps Standard plan gates while removing Elite and Vault access', () => {
  const subscription = fs.readFileSync(path.join(__dirname, '../js/subscription.js'), 'utf8');
  const auth = fs.readFileSync(path.join(__dirname, '../js/auth.js'), 'utf8');
  assert.match(subscription, /expiredPremiumDowngrade/);
  assert.match(subscription, /if \(isSubscriptionExpired\(profile\) && minimum > planRank\('standard'\)\) return false/);
  assert.match(auth, /activeMembership \? getSubscription\(profile\)\.plan/);
});

test('unpaid expired trials cannot bypass swipe limits after their trial record expires', () => {
  const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
  const swipe = fs.readFileSync(path.join(__dirname, '../js/swipe.js'), 'utf8');
  assert.match(rules, /function isUnpaidExpiredTrial\(u\)/);
  assert.match(rules, /isUnpaidExpiredTrial\(b\)\s*\?\s*false/);
  assert.match(swipe, /user\.status === "active_member" && !user\.freeTrial/);
});


test('premium swipe entitlements fail closed when expiry or active status is missing', () => {
  const swipe = fs.readFileSync(path.join(__dirname, '../js/swipe.js'), 'utf8');
  const subscription = fs.readFileSync(path.join(__dirname, '../js/subscription.js'), 'utf8');
  assert.match(swipe, /sub\.status !== "active" \|\| !expiryDate/);
  assert.match(swipe, /const validExpiry = Boolean\(expiryDate\)/);
  assert.match(swipe, /sub\.status === "active" && validExpiry/);
  assert.match(subscription, /if \(sub\.status !== 'active' \|\| !expiry \|\| Number\.isNaN\(Date\.parse\(expiry\)\)\) return true/);
});

test('dashboard header keeps member ID and filter without crowded Creator Market/install buttons', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '../app/dashboard/index.html'), 'utf8');
  assert.match(dashboard, /class="topbar dashboard-topbar"/);
  assert.match(dashboard, /class="dashboard-member-id"/);
  assert.doesNotMatch(dashboard, /id="creatorMarketButton"/);
  assert.doesNotMatch(dashboard, /id="installAppButton"/);
  assert.match(dashboard, /await openCreatorMarket\(myUser\)/);
  assert.match(dashboard, /promptEvent\.prompt\(\)/);
});


test('Firestore only grants unlimited Vault Super Likes with a future server expiry timestamp', () => {
  const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
  const printpay = fs.readFileSync(path.join(__dirname, '../netlify/functions/printpay.js'), 'utf8');
  const pesapal = fs.readFileSync(path.join(__dirname, '../netlify/functions/pesapal.js'), 'utf8');
  const sync = fs.readFileSync(path.join(__dirname, '../netlify/functions/subscription-entitlement-sync.js'), 'utf8');
  assert.match(rules, /expiresAt != null && expiresAt > request\.time/);
  assert.match(rules, /expiredPremium = \(plan == 'elite' \|\| plan == 'vault'\)/);
  assert.ok(printpay.includes("nextBillingAt: getAdmin().firestore.Timestamp.fromDate"));
  assert.ok(pesapal.includes("nextBillingAt: admin.firestore.Timestamp.fromDate"));
  assert.match(sync, /verifyIdToken\(token\)/);
  assert.match(sync, /subscription\.nextBillingAt/);
});

test('DateVault More actions no longer depend on removed topbar controls', () => {
  const dashboard = fs.readFileSync(path.join(__dirname, '../app/dashboard/index.html'), 'utf8');
  assert.ok(dashboard.includes("moreCreatorMarket") && dashboard.includes("await openCreatorMarket(myUser)"));
  assert.ok(dashboard.includes("moreInstallApp") && dashboard.includes("promptEvent.prompt()"));
  assert.match(dashboard, /dashboard-topbar-brand/);
});

test('video messages are charged atomically at the correct tier price', () => {
  const wallet = fs.readFileSync(path.join(__dirname, '../netlify/functions/wallet.js'), 'utf8');
  const sendVideo = wallet.slice(wallet.indexOf('async function sendVideo'), wallet.indexOf('exports.handler'));
  assert.match(wallet, /body\.action === 'send_video' \? await sendVideo\(user\.uid, body\)/);
  assert.match(sendVideo, /videoMessageCost\(profile\)/);
  assert.match(sendVideo, /amount: -cost/);
  assert.match(sendVideo, /type: 'chat_video'/);
  assert.match(sendVideo, /tx\.set\(messageRef, \{ senderUID: uid, text: null, videoURL/);
  assert.match(sendVideo, /await _db\.runTransaction\(async tx =>/);
  assert.match(sendVideo, /parsed\.hostname !== 'res\.cloudinary\.com'/);
});

test('chat video picker keeps tier pricing and simple visible likes on every message type', () => {
  const chat = fs.readFileSync(path.join(__dirname, '../app/chat/index.html'), 'utf8');
  assert.match(chat, /id="videoInput" accept="video\/\*"/);
  assert.match(chat, /function videoTokenCost\(\)/);
  assert.match(chat, /return \['elite', 'vault'\]\.includes\(plan\) \? 20 : 40;/);
  assert.match(chat, /video\.controls = true/);
  assert.match(chat, /m\.videoURL/);
  assert.match(chat, /m\.imageURL/);
  assert.match(chat, /const likedBy = Array\.isArray\(m\.likedBy\) \? m\.likedBy : \[\]/);
  assert.match(chat, /likedBy\.length/);
  assert.doesNotMatch(chat, /liked this/);
  assert.doesNotMatch(chat, /You liked this/);
});


test('chat actions sit below each message with compact controls, reaction choices and swipe-to-reply', () => {
  const chat = fs.readFileSync(path.join(__dirname, '../app/chat/index.html'), 'utf8');
  assert.match(chat, /align-self:'\+\(isOut\?'flex-end':'flex-start'\)/);
  assert.match(chat, /data-reply-swipe/);
  assert.match(chat, /container\.onpointerdown/);
  assert.match(chat, /container\.onpointerup/);
  assert.match(chat, /Math\.abs\(dx\) < 58/);
  assert.match(chat, /data-open-reactions/);
  assert.match(chat, /data-message-reaction/);
  assert.match(chat, /reactionGlyphs/);
  assert.match(chat, /reactions\.' \+ symbol/);
  assert.match(chat, /wrap\.appendChild\(bubble\)/);
  assert.match(chat, /wrap\.appendChild\(actions\)/);
  assert.doesNotMatch(chat, /reply\.textContent='Reply'/);
  assert.doesNotMatch(chat, /You liked this/);
});
