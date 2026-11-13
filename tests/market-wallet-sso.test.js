const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('Market wallet handoff uses a hashed, short-lived, single-use code', () => {
  const source = fs.readFileSync(path.join(root, 'netlify/functions/market-wallet-sso-redeem.js'), 'utf8');
  assert.match(source, /createHash\(["']sha256["']\)/);
  assert.match(source, /data\.audience !== ["']datevault-wallet["']/);
  assert.match(source, /data\.consumedAt/);
  assert.match(source, /expiresAt <= Date\.now\(\)/);
  assert.match(source, /createCustomToken\(uid\)/);
});

test('Market wallet callback strips the one-time code before exchanging it', () => {
  const html = fs.readFileSync(path.join(root, 'market-wallet-sso.html'), 'utf8');
  assert.ok(html.indexOf('history.replaceState') < html.indexOf('fetch("/api/market-wallet-sso-redeem"'));
  assert.match(html, /signInWithCustomToken\(auth, result\.customToken\)/);
  assert.match(html, /\/app\/wallet\//);
});

test('Market-only accounts are allowed through the token checkout gate, but banned accounts are not', () => {
  const html = fs.readFileSync(path.join(root, 'account/payment/index.html'), 'utf8');
  assert.match(html, /purpose === 'tokens' && \(!snap\.exists\(\) \|\| profile\.banned === true/);
  assert.match(html, /purpose !== 'tokens'/);
});
