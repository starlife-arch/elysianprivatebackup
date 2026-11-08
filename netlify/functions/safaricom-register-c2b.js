const { json, preflight, fetchJSON, getAdmin } = require('./_helpers');
const BASE = process.env.SAFARICOM_ENVIRONMENT === 'sandbox' ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';
async function adminUid(event) {
  const token = String(event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\\s+/i, '');
  if (!token) throw Object.assign(new Error('Sign in required.'), { status: 401 });
  const decoded = await getAdmin().auth().verifyIdToken(token);
  const snap = await getAdmin().firestore().collection('users').doc(decoded.uid).get();
  if (!snap.exists || snap.data().role !== 'admin') throw Object.assign(new Error('Admin access required.'), { status: 403 });
  return decoded.uid;
}
async function register() {
  const shortcode = process.env.SAFARICOM_PAYBILL_NUMBER;
  const key = process.env.SAFARICOM_CONSUMER_KEY, secret = process.env.SAFARICOM_CONSUMER_SECRET;
  if (!shortcode || !key || !secret) throw new Error('Set SAFARICOM_PAYBILL_NUMBER, SAFARICOM_CONSUMER_KEY and SAFARICOM_CONSUMER_SECRET first.');
  const auth = await fetchJSON(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: 'Basic ' + Buffer.from(key + ':' + secret).toString('base64'), Accept: 'application/json' }
  });
  const accessToken = auth.data?.access_token;
  if (!accessToken) throw new Error('Safaricom OAuth failed: ' + (auth.body || 'No access token returned.'));
  const site = (process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://elysiandate.site').replace(/\\/$/, '');
  const result = await fetchJSON(`${BASE}/mpesa/c2b/v1/registerurl`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  }, {
    ShortCode: shortcode,
    ResponseType: process.env.SAFARICOM_C2B_RESPONSE_TYPE || 'Completed',
    ConfirmationURL: `${site}/.netlify/functions/safaricom-c2b?action=confirmation`,
    ValidationURL: `${site}/.netlify/functions/safaricom-c2b?action=validation`
  });
  if (result.status >= 400 || !result.data || String(result.data.ResponseDescription || '').toLowerCase().includes('error')) {
    throw new Error('Safaricom URL registration failed: ' + (result.body || result.status));
  }
  return result.data;
}
exports.handler = async event => {
  const options = preflight(event); if (options) return options;
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST required' });
  try {
    await adminUid(event);
    return json(200, { ok: true, registration: await register() });
  } catch (error) {
    console.error('Safaricom C2B registration failed:', error);
    return json(error.status || 500, { error: error.message || 'Could not register Safaricom callback URLs.' });
  }
};
