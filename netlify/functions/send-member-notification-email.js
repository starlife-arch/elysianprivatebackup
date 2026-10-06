const { json, parseBody, preflight } = require("./_helpers");

function escapeHTML(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d)) return String(dateStr);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function formatAmount(usd, kes) {
  const parts = [];
  if (usd) parts.push(`$${Number(usd).toFixed(2)} USD`);
  if (kes) parts.push(`KES ${Number(kes).toLocaleString()}`);
  return parts.join(" &nbsp;&middot;&nbsp; ") || "—";
}

function invoiceNumber(ref) {
  if (ref) return "DV-" + String(ref).replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(-8);
  return "DV-" + Date.now().toString().slice(-8);
}

// Gmail-safe table row
function row(label, value, highlight) {
  const valColor = highlight ? "#c9a84c" : "#f0f2f8";
  return `<tr>
    <td style="padding:13px 24px;border-bottom:1px solid #111827;font-family:Arial,sans-serif;font-size:13px;color:#8a96b0;width:48%;">${label}</td>
    <td style="padding:13px 24px;border-bottom:1px solid #111827;font-family:Arial,sans-serif;font-size:13px;color:${valColor};font-weight:600;text-align:right;">${value}</td>
  </tr>`;
}

function invoiceHeaderRow(ref, date) {
  return `<tr style="background-color:#111827;">
    <td style="padding:16px 24px;font-family:Arial,sans-serif;border-bottom:2px solid rgba(201,168,76,0.25);">
      <div style="font-size:10px;letter-spacing:0.12em;color:#6b7a99;text-transform:uppercase;margin-bottom:5px;">Invoice No.</div>
      <div style="font-size:14px;color:#c9a84c;font-weight:700;">#${invoiceNumber(ref)}</div>
    </td>
    <td style="padding:16px 24px;font-family:Arial,sans-serif;border-bottom:2px solid rgba(201,168,76,0.25);text-align:right;">
      <div style="font-size:10px;letter-spacing:0.12em;color:#6b7a99;text-transform:uppercase;margin-bottom:5px;">Date</div>
      <div style="font-size:14px;color:#c9a84c;font-weight:700;">${formatDate(date)}</div>
    </td>
  </tr>`;
}

function totalRow(usd, kes) {
  return `<tr style="background-color:#0f1623;">
    <td style="padding:18px 24px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#f0f2f8;border-top:2px solid rgba(201,168,76,0.3);">Total Amount Paid</td>
    <td style="padding:18px 24px;font-family:Arial,sans-serif;font-size:17px;font-weight:700;color:#c9a84c;text-align:right;border-top:2px solid rgba(201,168,76,0.3);">${formatAmount(usd, kes)}</td>
  </tr>`;
}

function invoiceTable(rows) {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background-color:#0d1120;border:1px solid rgba(201,168,76,0.2);border-radius:12px;margin:0 0 28px;">${rows}</table>`;
}

const PAID_BADGE = `<span style="background-color:#0a2e14;border:1px solid #34c759;border-radius:99px;padding:3px 12px;font-family:Arial,sans-serif;font-size:11px;color:#34c759;font-weight:700;letter-spacing:0.08em;">&#10003; PAID</span>`;

function ctaButton(label, url) {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
    <tr><td align="center">
      <a href="${url}" style="display:inline-block;background-color:#c9a84c;color:#1a1200;text-decoration:none;padding:16px 48px;border-radius:999px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;">${label}</a>
    </td></tr>
  </table>`;
}

function shell({ badge, title, greeting, invoiceRows, cta, ctaUrl, note, appUrl }) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#060810;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#060810">
<tr><td align="center" style="padding:32px 16px;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#060810;">

  <!-- HEADER -->
  <tr>
    <td align="center" style="background-color:#0d1120;padding:32px 40px;border-bottom:1px solid rgba(201,168,76,0.2);">
      <div style="font-family:Georgia,serif;font-size:28px;color:#e8cb7a;letter-spacing:0.2em;">DateVault</div>
      <div style="font-family:Arial,sans-serif;color:#6b7a99;font-size:11px;letter-spacing:0.15em;margin-top:6px;">PRIVATE MEMBERSHIP</div>
    </td>
  </tr>

  <!-- BODY -->
  <tr>
    <td style="padding:36px 40px;">
      <div style="display:inline-block;background-color:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);border-radius:6px;padding:4px 14px;font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.14em;color:#c9a84c;margin-bottom:18px;">${badge}</div>
      <h1 style="font-family:Georgia,serif;font-weight:400;font-size:22px;color:#f0f2f8;margin:0 0 10px;">${title}</h1>
      <p style="font-family:Arial,sans-serif;font-size:14px;color:rgba(240,242,248,0.65);margin:0 0 28px;line-height:1.65;">${greeting}</p>
      ${invoiceTable(invoiceRows)}
      ${ctaButton(cta, ctaUrl)}
      <p style="font-family:Arial,sans-serif;font-size:12px;color:#6b7a99;line-height:1.7;margin:20px 0 0;">${note}</p>
    </td>
  </tr>

  <!-- FOOTER -->
  <tr>
    <td align="center" style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);">
      <p style="font-family:Arial,sans-serif;font-size:11px;color:#6b7a99;line-height:1.8;margin:0;">
        DateVault Private Membership &nbsp;&middot;&nbsp;
        <a href="${appUrl}" style="color:#c9a84c;text-decoration:none;">${appUrl.replace("https://", "")}</a>
      </p>
      <p style="font-family:Arial,sans-serif;font-size:11px;color:#6b7a99;margin:6px 0 0;">
        Questions? <a href="mailto:support@elysiandate.site" style="color:#c9a84c;text-decoration:none;">support@elysiandate.site</a>
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── Entry Payment ────────────────────────────────────────────────────────────
function invoiceEntry(data, appUrl) {
  const now = new Date().toISOString();
  return shell({
    badge: "RECEIPT",
    title: "Membership payment confirmed.",
    greeting: `Hi ${escapeHTML(data.name || "Member")}, your DateVault Standard membership is now active. Here is your receipt.`,
    invoiceRows:
      invoiceHeaderRow(data.reference || data.memberId, now) +
      row("Member Name", escapeHTML(data.name || "—")) +
      row("Member ID", escapeHTML(data.memberId || "—")) +
      row("Email", escapeHTML(data.email || "—")) +
      row("Description", "DateVault — One-Time Entry Fee") +
      row("Plan", "Standard Membership", true) +
      row("Billing", "One-time &nbsp;&middot;&nbsp; Lifetime access") +
      row("Payment Method", escapeHTML(data.method || "M-Pesa Africa")) +
      row("Status", PAID_BADGE) +
      totalRow(data.amountUSD, data.amountKes),
    cta: "Open My Dashboard",
    ctaUrl: `${appUrl}/app/dashboard/`,
    note: "This is your official payment receipt. Please keep it for your records.",
    appUrl
  });
}

// ─── Subscription ─────────────────────────────────────────────────────────────
function invoiceSubscription(data, appUrl) {
  const now = new Date().toISOString();
  const billing = data.billing || "monthly";
  const nextDate = data.nextBillingDate || (() => {
    const d = new Date();
    billing === "annual" ? d.setFullYear(d.getFullYear() + 1) : d.setMonth(d.getMonth() + 1);
    return d.toISOString();
  })();
  return shell({
    badge: "SUBSCRIPTION RECEIPT",
    title: `Your ${escapeHTML(data.plan || "Standard")} plan is active.`,
    greeting: `Hi ${escapeHTML(data.name || "Member")}, your subscription payment was received and your benefits are now live.`,
    invoiceRows:
      invoiceHeaderRow(data.reference || data.memberId, now) +
      row("Member Name", escapeHTML(data.name || "—")) +
      row("Member ID", escapeHTML(data.memberId || "—")) +
      row("Email", escapeHTML(data.email || "—")) +
      row("Plan", escapeHTML(data.plan || "Standard") + " Plan", true) +
      row("Billing Cycle", billing === "annual" ? "Annual" : "Monthly") +
      row("Period Start", formatDate(now)) +
      row("Next Billing Date", formatDate(nextDate), true) +
      row("Payment Method", escapeHTML(data.method || "M-Pesa Africa")) +
      row("Status", PAID_BADGE) +
      totalRow(data.amountUSD, data.amountKes),
    cta: "Open My Dashboard",
    ctaUrl: `${appUrl}/app/dashboard/`,
    note: `Your plan renews automatically on ${formatDate(nextDate)}. Manage your subscription from your dashboard.`,
    appUrl
  });
}

// ─── Token Purchase ───────────────────────────────────────────────────────────
function invoiceTokens(data, appUrl) {
  const now = new Date().toISOString();
  const tokens = Number(data.tokens || 0);
  return shell({
    badge: "TOKEN RECEIPT",
    title: "Token purchase confirmed.",
    greeting: `Hi ${escapeHTML(data.name || "Member")}, your tokens have been added to your DateVault wallet.`,
    invoiceRows:
      invoiceHeaderRow(data.reference || data.memberId, now) +
      row("Member Name", escapeHTML(data.name || "—")) +
      row("Member ID", escapeHTML(data.memberId || "—")) +
      row("Email", escapeHTML(data.email || "—")) +
      row("Description", "DateVault Token Pack") +
      row("Tokens Added", tokens.toLocaleString() + " tokens", true) +
      row("Token Rate", "100 tokens = $1.00 USD") +
      row("Payment Method", escapeHTML(data.method || "M-Pesa Africa")) +
      row("Status", PAID_BADGE) +
      totalRow(data.amountUSD, data.amountKes),
    cta: "Open Token Wallet",
    ctaUrl: `${appUrl}/app/wallet/`,
    note: "Tokens are non-refundable and can be used for gifts and add-ons within the DateVault platform.",
    appUrl
  });
}

// ─── Add-on ───────────────────────────────────────────────────────────────────
function invoiceAddon(data, appUrl) {
  const now = new Date().toISOString();
  const addonLabels = { boost: "Profile Boost (24 hours)", superlike_pack: "Super Like Pack (10 super likes)", incognito: "Incognito Mode (7 days)" };
  const addonLabel = addonLabels[data.addon] || escapeHTML(data.addon || "Add-on");
  return shell({
    badge: "ADD-ON RECEIPT",
    title: "Add-on purchase confirmed.",
    greeting: `Hi ${escapeHTML(data.name || "Member")}, your add-on is now active on your account.`,
    invoiceRows:
      invoiceHeaderRow(data.reference || data.memberId, now) +
      row("Member Name", escapeHTML(data.name || "—")) +
      row("Member ID", escapeHTML(data.memberId || "—")) +
      row("Email", escapeHTML(data.email || "—")) +
      row("Add-on", addonLabel, true) +
      row("Type", "One-time purchase") +
      row("Activated", formatDate(now)) +
      row("Payment Method", escapeHTML(data.method || "M-Pesa Africa")) +
      row("Status", PAID_BADGE) +
      totalRow(data.amountUSD, data.amountKes),
    cta: "Open My Profile",
    ctaUrl: `${appUrl}/app/profile/`,
    note: "This is your official receipt for your add-on purchase.",
    appUrl
  });
}

// ─── Priority Support ─────────────────────────────────────────────────────────
function invoicePrioritySupport(data, appUrl) {
  const now = new Date().toISOString();
  const PENDING_BADGE = `<span style="background-color:#1a1a00;border:1px solid #c9a84c;border-radius:99px;padding:3px 12px;font-family:Arial,sans-serif;font-size:11px;color:#c9a84c;font-weight:700;">PENDING CONFIRMATION</span>`;
  return shell({
    badge: "PRIORITY SUPPORT RECEIPT",
    title: "Priority Support request received.",
    greeting: `Hi ${escapeHTML(data.name || "Member")}, your payment has been received. The admin team will confirm your video call manually.`,
    invoiceRows:
      invoiceHeaderRow(data.reference || data.memberId, now) +
      row("Member Name", escapeHTML(data.name || "—")) +
      row("Member ID", escapeHTML(data.memberId || "—")) +
      row("Email", escapeHTML(data.email || "—")) +
      row("Description", "DateVault — Priority Support") +
      row("Includes", "1-on-1 Video Call with Admin Team") +
      row("Payment Method", escapeHTML(data.method || "M-Pesa Africa")) +
      row("Status", PENDING_BADGE) +
      totalRow(data.amountUSD || 100, data.amountKes),
    cta: "Open Support",
    ctaUrl: `${appUrl}/app/chat/?tab=support`,
    note: "The admin team will reach out to schedule your video call. Please allow up to 48 hours for confirmation.",
    appUrl
  });
}

// ─── Non-payment notifications ────────────────────────────────────────────────
function notificationEmail(type, data, appUrl) {
  const plan = escapeHTML(data.plan || "membership");
  const cases = {
    access_granted: { subject: "DateVault access granted", title: "Your access has been granted.", body: `Your DateVault member access is active${data.days ? ` for ${escapeHTML(data.days)} days` : ""}. You can now return to the member dashboard.`, cta: "Open Dashboard", url: `${appUrl}/app/dashboard/` },
    plan_assigned: { subject: `${plan} plan assigned — DateVault`, title: `Your ${plan} plan has been assigned.`, body: `An admin has assigned your DateVault account to the ${plan} plan. Your plan benefits are available immediately.`, cta: "Open Dashboard", url: `${appUrl}/app/dashboard/` },
    access_revoked: { subject: "DateVault access revoked", title: "Your access has been revoked.", body: "Your DateVault member access has been moved back to payment-required status. Contact support if you believe this is a mistake.", cta: "Review Payment", url: `${appUrl}/account/payment/` },
    user_banned: { subject: "DateVault account suspended", title: "Your account has been suspended.", body: "Your DateVault account has been suspended due to a community issue. Contact support if you believe this is an error.", cta: "Contact Support", url: `${appUrl}/auth/login/` },
    user_unbanned: { subject: "DateVault account restored", title: "Your account has been restored.", body: "Your DateVault account suspension has been lifted. You can sign in and continue using your member features.", cta: "Sign In", url: `${appUrl}/auth/login/` },
    reapply_allowed: { subject: "You can reapply to DateVault", title: "Your reapply chance is open.", body: "The DateVault team has reopened your application. Sign in and complete verification again when you are ready.", cta: "Complete Verification", url: `${appUrl}/account/verification/` },
    subscription_expired: { subject: `${plan} plan expired — DateVault`, title: `Your ${plan} plan has expired.`, body: "Your account is still active on Standard. Renew to restore your paid benefits including boosts, premium filters, read receipts, and Vault access.", cta: "Renew Plan", url: `${appUrl}/pricing.html` },
    verification_submitted: { subject: "DateVault verification received", title: "Your verification was submitted.", body: "Your profile and identity verification are now with the DateVault review team. We will notify you after review.", cta: "Check Status", url: `${appUrl}/account/status/` },
    wallet_credit: { subject: "Tokens added to your DateVault wallet", title: "Tokens were added to your wallet.", body: `${Number(data.amount || 0).toLocaleString()} tokens were added by the DateVault team.${data.reason ? ` Reason: ${escapeHTML(data.reason)}` : ""}`, cta: "Open Token Wallet", url: `${appUrl}/app/wallet/` },
    wallet_debit: { subject: "DateVault wallet adjustment", title: "Tokens were deducted from your wallet.", body: `${Number(data.amount || 0).toLocaleString()} tokens were deducted by the DateVault team.${data.reason ? ` Reason: ${escapeHTML(data.reason)}` : ""}`, cta: "Open Token Wallet", url: `${appUrl}/app/wallet/` },
    wallet_set: { subject: "DateVault wallet balance updated", title: "Your wallet balance was updated.", body: `The DateVault team updated your token wallet balance.${data.reason ? ` Reason: ${escapeHTML(data.reason)}` : ""}`, cta: "Open Token Wallet", url: `${appUrl}/app/wallet/` },
    withdrawal_paid: { subject: "Your DateVault withdrawal was paid", title: "Your withdrawal has been paid.", body: "Your withdrawal request has been marked as paid by the DateVault team.", cta: "Open Token Wallet", url: `${appUrl}/app/wallet/` },
    withdrawal_rejected: { subject: "Your DateVault withdrawal was rejected", title: "Your withdrawal was rejected and refunded.", body: `${Number(data.amount || 0).toLocaleString()} tokens were returned to your wallet.${data.reason ? ` Reason: ${escapeHTML(data.reason)}` : ""}`, cta: "Open Token Wallet", url: `${appUrl}/app/wallet/` },
  };
  const c = cases[type] || { subject: "DateVault notification", title: "DateVault update", body: "There is an update on your DateVault account.", cta: "Open DateVault", url: appUrl };
  const safeName = escapeHTML(data.name || "Member");
  const memberId = escapeHTML(data.memberId || "");
  return {
    subject: c.subject,
    html: shell({
      badge: "NOTIFICATION",
      title: c.title,
      greeting: `Hi ${safeName},`,
      invoiceRows: `
        <tr><td colspan="2" style="padding:20px 24px;font-family:Arial,sans-serif;font-size:14px;color:rgba(240,242,248,0.75);line-height:1.7;">${c.body}</td></tr>
        ${memberId ? `<tr><td colspan="2" style="padding:4px 24px 20px;"><div style="background-color:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.25);border-radius:10px;padding:12px 16px;font-family:Arial,sans-serif;font-size:13px;color:#c9a84c;">Member ID: ${memberId}</div></td></tr>` : ""}
      `,
      cta: c.cta,
      ctaUrl: c.url,
      note: "If you did not expect this update, please contact DateVault support.",
      appUrl
    })
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────
exports.handler = async function(event) {
  const options = preflight(event);
  if (options) return options;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const data = parseBody(event);
  if (!data.email) return json(400, { error: "Missing email" });

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) return json(500, { error: "Brevo not configured" });

  const APP_URL = (process.env.APP_URL || "https://elysiandate.site").replace("https://elysiandate.netlify.app", "https://elysiandate.site");

  const paymentTypes = new Set(["payment_received", "subscription_renewed", "token_purchase", "addon_purchased", "priority_support_requested", "subscription_expired", "wallet_credit", "wallet_debit", "wallet_set", "withdrawal_paid", "withdrawal_rejected"]);
  const adminTypes = new Set(["access_granted", "access_revoked", "plan_assigned", "user_banned", "user_unbanned", "reapply_allowed"]);

  const senderEmail = paymentTypes.has(data.type)
    ? (process.env.EMAIL_PAYMENT || process.env.EMAIL_ADMIN)
    : adminTypes.has(data.type)
      ? process.env.EMAIL_ADMIN
      : (process.env.EMAIL_ALERTS || process.env.EMAIL_ADMIN);

  let subject, htmlContent;

  if (data.type === "payment_received") {
    subject = `Payment Confirmed — Receipt #${invoiceNumber(data.reference || data.memberId)}`;
    htmlContent = invoiceEntry(data, APP_URL);
  } else if (data.type === "subscription_renewed") {
    subject = `${escapeHTML(data.plan || "Standard")} Plan Active — Receipt`;
    htmlContent = invoiceSubscription(data, APP_URL);
  } else if (data.type === "token_purchase") {
    subject = `Token Purchase Confirmed — DateVault Receipt`;
    htmlContent = invoiceTokens(data, APP_URL);
  } else if (data.type === "addon_purchased") {
    subject = `Add-on Purchase Confirmed — DateVault Receipt`;
    htmlContent = invoiceAddon(data, APP_URL);
  } else if (data.type === "priority_support_requested") {
    subject = `Priority Support Request Received — DateVault`;
    htmlContent = invoicePrioritySupport(data, APP_URL);
  } else {
    const n = notificationEmail(data.type, data, APP_URL);
    subject = n.subject;
    htmlContent = n.html;
  }

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json", "api-key": BREVO_API_KEY },
      body: JSON.stringify({
        sender: { email: process.env.EMAIL_ADMIN, name: process.env.EMAIL_ADMIN_NAME || "DateVault" },
        to: [{ email: data.email, name: escapeHTML(data.name || "Member") }],
        subject,
        htmlContent
      })
    });
    const resData = await response.json();
    if (!response.ok) return json(500, { error: resData.message || "Email send failed", details: resData });
    return json(200, { success: true, messageId: resData.messageId });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
