const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Creator Market SSO does not depend on dating membership or application state', () => {
  const source = fs.readFileSync(path.join(__dirname, '../netlify/functions/market-sso-issue.js'), 'utf8');
  assert.match(source, /function eligibleForMarket\(profile = \{\}\)/);
  assert.doesNotMatch(source, /profile\.status === ["']rejected["']/);
  assert.doesNotMatch(source, /profile\.adminApproved === true/);
  assert.doesNotMatch(source, /active_member/);
});

test('Creator Market SSO preserves explicit platform safety restrictions', () => {
  const source = fs.readFileSync(path.join(__dirname, '../netlify/functions/market-sso-issue.js'), 'utf8');
  for (const field of ['banned', 'suspended', 'accountSuspended', 'marketBanned']) {
    assert.match(source, new RegExp('profile\\.' + field + ' === true'));
  }
});

test('Market administrator destination still requires DateVault admin authorization', () => {
  const source = fs.readFileSync(path.join(__dirname, '../netlify/functions/market-sso-issue.js'), 'utf8');
  assert.match(source, /destination === ["']\/admin["']/);
  assert.match(source, /profile\.role !== ["']admin["'] && profile\.isAdmin !== true/);
});
