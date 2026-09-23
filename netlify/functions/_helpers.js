const https = require("https");

function getAdmin() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    const credential = process.env.FIREBASE_SERVICE_ACCOUNT
      ? admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      : admin.credential.applicationDefault();
    admin.initializeApp({ credential });
  }
  return admin;
}

function json(statusCode, data, headers = {}) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(data)
  };
}

function text(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      ...headers
    },
    body
  };
}

function redirect(location) {
  return {
    statusCode: 302,
    headers: { Location: location },
    body: ""
  };
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  return JSON.parse(raw);
}

function preflight(event) {
  if (event.httpMethod !== "OPTIONS") return null;
  return text(204, "");
}

function fetchJSON(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url); let payload = null;
    const headers = { ...(options.headers || {}) };
    if (body !== null) { payload = typeof body === 'string' ? body : options.form ? new URLSearchParams(body).toString() : JSON.stringify(body); headers['Content-Type'] ||= options.form ? 'application/x-www-form-urlencoded' : 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    const req = https.request({ hostname:urlObj.hostname, path:urlObj.pathname+urlObj.search, method:options.method||'GET', headers }, res => { let response=''; res.on('data', chunk => response += chunk); res.on('end', () => { let data; try { data=JSON.parse(response); } catch (_) { data=null; } resolve({ status:res.statusCode, headers:res.headers, body:response, data }); }); });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}

module.exports = { json, text, redirect, parseBody, preflight, fetchJSON, getAdmin };
