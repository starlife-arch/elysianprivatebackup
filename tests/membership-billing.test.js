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

test('photo charge, message write and wallet deduction remain in one transaction', () => {
  const source = fs.readFileSync(path.join(__dirname, '../netlify/functions/wallet.js'), 'utf8');
  const sendImage = source.slice(source.indexOf('async function sendImage'), source.indexOf('exports.handler'));
  assert.match(source, /body\.action === 'send_image'\s*\? await sendImage\(user\.uid, body\)/);
  assert.match(sendImage, /await _db\.runTransaction\(async tx =>/);
  assert.ok(sendImage.indexOf('tx.update(senderRef') > sendImage.indexOf('await _db.runTransaction'));
  assert.ok(sendImage.indexOf('tx.set(messageRef') > sendImage.indexOf('await _db.runTransaction'));
  assert.match(sendImage, /photoMessageCost\(profile\)/);
});

test('client blocks duplicate in-flight photo sends', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/chat/index.html'), 'utf8');
  assert.match(source, /if \(!file \|\| !recipient \|\| sendingImage\) return;/);
  assert.match(source, /sendingImage = true;/);
  assert.match(source, /finally \{ sendingImage = false;/);
});
