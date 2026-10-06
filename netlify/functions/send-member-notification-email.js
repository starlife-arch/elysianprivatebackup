const { json, parseBody, preflight } = require("./_helpers");

function escapeHTML(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function formatAmount(usd, kes) {
  const parts = [];
  if (usd) parts.push(`$${Number(usd).toFixed(2)} USD`);
  if (kes) parts.push(`KES ${Number(kes).toLocaleString()}`);
  return parts.join(" · ") || "—";
}

function invoiceNumber(ref) {
  if (ref) return String(ref).toUpperCase().slice(-10);
  return "DV-" + Date.now().toString().slice(-8);
}

// ─── Shared email shell ───────────────────────────────────────────────────────
function shell(bodyHtml, appUrl) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>
  body{margin:0;padding:0;background:#060810;font-family:Arial,sans-serif;color:#f0f2f8;}
  .wrap{max-width:600px;margin:0 auto;background:#060810;}
  .header{background:#0d1120;padding:36px 40px;text-align:center;border-bottom:1px solid rgba(201,168,76,0.25);}
  .logo{font-family:Georgia,serif;font-size:30px;color:#e8cb7a;letter-spacing:0.2em;}
  .logo-sub{color:#6b7a99;font-size:11px;letter-spacing:0.15em;margin-top:6px;}
  .body{padding:36px 40px;}
  .invoice-badge{display:inline-block;background:rgba(201,168,76,0.12);border:1px solid rgba(201,168,76,0.35);border-radius:6px;padding:4px 14px;font-size:11px;letter-spacing:0.12em;color:#c9a84c;margin-bottom:20px;}
  h1{font-family:Georgia,serif;font-weight:400;font-size:22px;color:#f0f2f8;margin:0 0 6px;}
  .greeting{color:rgba(240,242,248,0.7);font-size:14px;margin:0 0 24px;}
  .invoice-box{background:#0d1120;border:1px solid rgba(201,168,76,0.2);border-radius:14px;overflow:hidden;margin:0 0 24px;}
  .invoice-header{background:rgba(201,168,76,0.08);padding:14px 20px;display:flex;justify-content:space-between;border-bottom:1px solid rgba(201,168,76,0.15);}
  .invoice-header-label{font-size:11px;letter-spacing:0.1em;color:#6b7a99;text-transform:uppercase;}
  .invoice-header-value{font-size:13px;color:#c9a84c;font-weight:600;margin-top:4px;}
  .invoice-row{display:flex;justify-content:space-between;align-items:center;padding:13px 20px;border-bottom:1px solid rgba(255,255,255,0.04);}
  .invoice-row:last-child{border-bottom:none;}
  .row-label{font-size:13px;color:#6b7a99;}
  .row-value{font-size:13px;color:#f0f2f8;font-weight:500;text-align:right;}
  .row-value.gold{color:#c9a84c;}
  .total-row{background:rgba(201,168,76,0.06);padding:16px 20px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(201,168,76,0.2);}
  .total-label{font-size:14px;font-weight:700;color:#f0f2f8;}
  .total-value{font-size:18px;font-weight:700;color:#c9a84c;}
  .status-paid{display:inline-block;background:rgba(52,199,89,0.12);border:1px solid rgba(52,199,89,0.35);border-radius:999px;padding:3px 12px;font-size:11px;color:#34c759;font-weight:600;letter-spacing:0.08em;}
  .cta{display:block;background:#c9a84c;color:#1a1200;text-decoration:none;padding:15px 32px;border-radius:999px;font-weight:700;text-align:center;margin:24px 0;font-size:14px;}
  .note{color:#6b7a99;font-size:12px;line-height:1.7;margin-top:16px;}
  .footer{padding:24px 40px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;}
  .footer p{color:#6b7a99;font-size:11px;line-height:1.8;margin:0;}
  .footer a{color:#c9a84c;text-decoration:none;}
</style>
</head><body>
<div class="wrap">
  <div class="header">
    <div class="logo">DateVault</div>
    <div class="logo-sub">PRIVATE MEMBERSHIP</div>
  </div>
  <div class="body">${bodyHtml}</div>
  <div class="footer">
    <p>DateVault Private Membership &nbsp;·&nbsp; <a href="${appUrl}">${appUrl.replace('https://','')}</a></p>
    <p>If you did not make this purchase, contact <a href="mailto:support@elysiandate.site">support@elysiandate.site</a></p>
  </div>
</div>
</body></html>`;
}

// ─── Invoice rows helper ──────────────────────────────────────────────────────
function row(label, value, gold = false) {
  return `<div class="invoice-row"><span class="row-label">${label}</span><span class="row-value${gold ? ' gold' : ''}">${value}</span></div>`;
}

// ─── INVOICE: Entry Payment ───────────────────────────────────────────────────
function invoiceEntry(data, appUrl) {
  const now = new Date().toISOString();
  return shell(`
    <div class="invoice-badge">RECEIPT</div>
    <h1>Membership payment confirmed.</h1>
    <p class="greeting">Hi ${escapeHTML(data.name || "Member")}, your DateVault Standard membership is now active.</p>
    <div class="invoice-box">
      <div class="invoice-header">
        <div><div class="invoice-header-label">Invoice No.</div><div class="invoice-header-value">#${invoiceNumber(data.reference || data.memberId)}</div></div>
        <div style="text-align:right"><div class="invoice-header-label">Date</div><div class="invoice-header-value">${formatDate(now)}</div></div>
      </div>
      ${row("Member Name", escapeHTML(data.name || "—"))}
      ${row("Member ID", escapeHTML(data.memberId || "—"))}
      ${row("Email", escapeHTML(data.email || "—"))}
      ${row("Description", "DateVault — One-Time Entry Fee")}
      ${row("Plan", "Standard Membership")}
      ${row("Billing", "One-time · Lifetime access")}
      ${row("Payment Method", escapeHTML(data.method || "M-Pesa"))}
      ${row("Status", '<span class="status-paid">PAID</span>')}
      <div class="total-row"><span class="total-label">Amount Paid</span><span class="total-value">${formatAmount(data.amountUSD, data.amountKes)}</span></div>
    </div>
    <a class="cta" href="${appUrl}/app/dashboard/">Open My Dashboard</a>
    <p class="note">This is your official payment receipt. Please keep it for your records.</p>
  `, appUrl);
}

// ─── INVOICE: Subscription Payment ───────────────────────────────────────────
function invoiceSubscription(data, appUrl) {
  const now = new Date().toISOString();
  const billing = data.billing || "monthly";
  const nextDate = data.nextBillingDate || (() => {
    const d = new Date();
    billing === "annual" ? d.setFullYear(d.getFullYear() + 1) : d.setMonth(d.getMonth() + 1);
    return d.toISOString();
  })();
  return shell(`
    <div class="invoice-badge">SUBSCRIPTION RECEIPT</div>
    <h1>Your ${escapeHTML(data.plan || "Standard")} plan is active.</h1>
    <p class="greeting">Hi ${escapeHTML(data.name || "Member")}, your subscription payment was received and your plan benefits are live.</p>
    <div class="invoice-box">
      <div class="invoice-header">
        <div><div class="invoice-header-label">Invoice No.</div><div class="invoice-header-value">#${invoiceNumber(data.reference || data.memberId)}</div></div>
        <div style="text-align:right"><div class="invoice-header-label">Date</div><div class="invoice-header-value">${formatDate(now)}</div></div>
      </div>
      ${row("Member Name", escapeHTML(data.name || "—"))}
      ${row("Member ID", escapeHTML(data.memberId || "—"))}
      ${row("Email", escapeHTML(data.email || "—"))}
      ${row("Plan", escapeHTML(data.plan || "Standard") + " Plan", true)}
      ${row("Billing Cycle", billing === "annual" ? "Annual" : "Monthly")}
      ${row("Period Start", formatDate(now))}
      ${row("Next Billing Date", formatDate(nextDate))}
      ${row("Payment Method", escapeHTML(data.method || "M-Pesa"))}
      ${row("Status", '<span class="status-paid">PAID</span>')}
      <div class="total-row"><span class="total-label">Amount Paid</span><span class="total-value">${formatAmount(data.amountUSD, data.amountKes)}</span></div>
    </div>
    <a class="cta" href="${appUrl}/app/dashboard/">Open My Dashboard</a>
    <p class="note">Your plan renews automatically on ${formatDate(nextDate)}. To manage your subscription, visit your dashboard.</p>
  `, appUrl);
}

// ─── INVOICE: Token Purchase ──────────────────────────────────────────────────
function invoiceTokens(data, appUrl) {
  const now = new Date().toISOString();
  const tokens = Number(data.tokens || 0);
  return shell(`
    <div class="invoice-badge">TOKEN RECEIPT</div>
    <h1>Token purchase confirmed.</h1>
    <p class="greeting">Hi ${escapeHTML(data.name || "Member")}, your tokens have been added to your wallet.</p>
    <div class="invoice-box">
      <div class="invoice-header">
        <div><div class="invoice-header-label">Invoice No.</div><div class="invoice-header-value">#${invoiceNumber(data.reference || data.memberId)}</div></div>
        <div style="text-align:right"><div class="invoice-header-label">Date</div><div class="invoice-header-value">${formatDate(now)}</div></div>
      </div>
      ${row("Member Name", escapeHTML(data.name || "—"))}
      ${row("Member ID", escapeHTML(data.memberId || "—"))}
      ${row("Email", escapeHTML(data.email || "—"))}
      ${row("Description", "DateVault Token Pack")}
      ${row("Tokens Added", tokens.toLocaleString() + " tokens", true)}
      ${row("Token Rate", "100 tokens = $1.00 USD")}
      ${row("Payment Method", escapeHTML(data.method || "M-Pesa"))}
      ${row("Status", '<span class="status-paid">PAID</span>')}
      <div class="total-row"><span class="total-label">Amount Paid</span><span class="total-value">${formatAmount(data.amountUSD, data.amountKes)}</span></div>
    </div>
    <a class="cta" href="${appUrl}/app/wallet/">Open Token Wallet</a>
    <p class="note">Tokens are non-refundable and can be used for gifts and add-ons within the DateVault platform.</p>
  `, appUrl);
}

// ─── INVOICE: Add-on Purchase ─────────────────────────────────────────────────
function invoiceAddon(data, appUrl) {
  const now = new Date().toISOString();
  const addonLabels = { boost: "Profile Boost (24 hours)", superlike_pack: "Super Like Pack (10 super likes)", incognito: "Incognito Mode (7 days)" };
  const addonLabel = addonLabels[data.addon] || escapeHTML(data.addon || "Add-on");
  return shell(`
    <div class="invoice-badge">ADD-ON RECEIPT</div>
    <h1>Add-on purchase confirmed.</h1>
    <p class="greeting">Hi ${escapeHTML(data.name || "Member")}, your add-on is now active on your account.</p>
    <div class="invoice-box">
      <div class="invoice-header">
        <div><div class="invoice-header-label">Invoice No.</div><div class="invoice-header-value">#${invoiceNumber(data.reference || data.memberId)}</div></div>
        <div style="text-align:right"><div class="invoice-header-label">Date</div><div class="invoice-header-value">${formatDate(now)}</div></div>
      </div>
      ${row("Member Name", escapeHTML(data.name || "—"))}
      ${row("Member ID", escapeHTML(data.memberId || "—"))}
      ${row("Email", escapeHTML(data.email || "—"))}
      ${row("Add-on", addonLabel, true)}
      ${row("Type", "One-time purchase")}
      ${row("Activated", formatDate(now))}
      ${row("Payment Method", escapeHTML(data.method || "M-Pesa"))}
      ${row("Status", '<span class="status-paid">PAID</span>')}
      <div class="total-row"><span class="total-label">Amount Paid</span><span class="total-value">${formatAmount(data.amountUSD, data.amountKes)}</span></div>
    </div>
    <a class="cta" href="${appUrl}/app/profile/">Open My Profile</a>
    <p class="note">This is your official receipt for your add-on purchase.</p>
  `, appUrl);
}

// ─── INVOICE: Priority Support ────────────────────────────────────────────────
function invoicePrioritySupport(data, appUrl) {
  const now = new Date().toISOString();
  return shell(`
    <div class="invoice-badge">PRIORITY SUPPORT RECEIPT</div>
    <h1>Priority Support request received.</h1>
    <p class="greeting">Hi ${escapeHTML(data.name || "Member")}, your payment has been received. The admin team will confirm your scheduled video call manually.</p>
    <div class="invoice-box">
      <div class="invoice-header">
        <div><div class="invoice-header-label">Invoice No.</div><div class="invoice-header-value">#${invoiceNumber(data.reference || data.memberId)}</div></div>
        <div style="text-align:right"><div class="invoice-header-label">Date</div><div class="invoice-header-value">${formatDate(now)}</div></div>
      </div>
      ${row("Member Name", escapeHTML(data.name || "—"))}
      ${row("Member ID", escapeHTML(data.memberId || "—"))}
      ${row("Email", escapeHTML(data.email || "—"))}
      ${row("Description", "DateVault — Priority Support Request")}
      ${row("Includes", "1-on-1 Video Call with Admin Team")}
      ${row("Status", "Paid · Pending Confirmation")}
      ${row("Payment Method", escapeHTML(data.method || "M-Pesa"))}
      <div class="total-row"><span class="total-label">Amount Paid</span><span class="total-value">${formatAmount(data.amountUSD || 100, data.amountKes)}</span></div>
    </div>
    <a class="cta" href="${appUrl}/app/chat/?tab=support">Open Support</a>
    <p class="note">The admin team will reach out to schedule your video call. Please allow up to 48 hours for confirmation.</p>
  `, appUrl);
}

// ─── Non-payment notification emails (unchanged style) ───────────────────────
function notificationEmail(type, data, appUrl) {
  const plan = escapeHTML(data.plan || "membership");
  const cases = {
    access_granted: { subject: "DateVault access granted", title: "Your access has been granted.", body: `Your DateVault member access is active${data.days ? ` for ${escapeHTML(data.days)} days` : ""}. You can now return to the member dashboard.`, cta: "Open Dashboard", url: `${appUrl}/app/dashboard/` },
    plan_assigned: { subject: `${plan} plan assigned — DateVault`, title: `Your ${plan} plan has been assigned.`, body: `An admin has assigned your DateVault account to the ${plan} plan. Your plan benefits are available immediately.`, cta: "Open Dashboard", url: `${appUrl}/app/dashboard/` },
    access_revoked: { subject: "DateVault access revoked", title: "Your access has been revoked.", body: "Your DateVault member access has been moved back to payment-required status. If you believe this is a mistake, contact support.", cta: "Review Payment", url: `${appUrl}/account/payment/` },
    user_banned: { subject: "DateVault account suspended", title: "Your account has been suspended.", body: "Your DateVault account has been suspended due to an account or community issue. If you believe this is an error, contact support for review.", cta: "Contact Support", url: `${appUrl}/auth/login/` },
    user_unbanned: { subject: "DateVault account restored", title: "Your account has been restored.", body: "Your DateVault account suspension has been lifted. You can sign in again and continue using your available member features.", cta: "Sign In", url: `${appUrl}/auth/login/` },
    reapply_allowed: { subject: "You can reapply to DateVault", title: "Your reapply chance is open.", body: "The DateVault team has reopened your application. Sign in and complete verification again when you are ready.", cta: "Complete Verification", url: `${appUrl}/account/verification/` },
    subscription_expired: { subject: `${plan} plan expired — DateVault`, title: `Your ${plan} plan has expired.`, body: "Your account is still active on Standard. Renew to restore your paid benefits, including boosts, premium filters, read receipts, and Vault access where applicable.", cta: "Renew Plan", url: `${appUrl}/pricing.html` },
    verification_submitted: { subject: "DateVault verification received", title: "Your verification was submitted.", body: "Your profile and identity verification are now with the DateVault review team. We will notify you after review before asking for the entry payment.", cta: "Check Status", url: `${appUrl}/account/status/` },
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
    html: shell(`
      <h1>${escapeHTML(c.title)}</h1>
      <p style="color:rgba(240,242,248,0.75);font-size:15px;line-height:1.7;">Hi ${safeName},</p>
      <p style="color:rgba(240,242,248,0.75);font-size:15px;line-height:1.7;">${c.body}</p>
      ${memberId ? `<div style="background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);border-radius:14px;padding:16px;margin:22px 0;color:#c9a84c;font-size:13px;">Member ID: ${memberId}</div>` : ""}
      <a class="cta" href="${c.url}">${escapeHTML(c.cta)}</a>
    `, appUrl)
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async function(event) {
  const options = preflight(event);
  if (options) return options;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const data = parseBody(event);
  if (!data.email) return json(400, { error: "Missing email" });

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) return json(500, { error: "Brevo not configured" });

  const APP_URL = (process.env.APP_URL || "https://elysiandate.site").replace("https://elysiandate.netlify.app", "https://elysiandate.site");

  const invoiceTypes = new Set(["payment_received", "subscription_renewed", "token_purchase", "addon_purchased", "priority_support_requested"]);
  const paymentTypes = new Set(["subscription_expired", "subscription_renewed", "payment_received", "token_purchase", "addon_purchased", "wallet_credit", "wallet_debit", "wallet_set", "withdrawal_paid", "withdrawal_rejected", "priority_support_requested"]);
  const adminTypes = new Set(["access_granted", "access_revoked", "plan_assigned", "user_banned", "user_unbanned", "reapply_allowed"]);

  const FROM_EMAIL = paymentTypes.has(data.type)
    ? (process.env.EMAIL_PAYMENT || process.env.FROM_EMAIL || "noreply@elysiandate.site")
    : adminTypes.has(data.type)
      ? (process.env.EMAIL_ADMIN || process.env.FROM_EMAIL || "noreply@elysiandate.site")
      : (process.env.EMAIL_ALERTS || process.env.FROM_EMAIL || "noreply@elysiandate.site");

  const FROM_NAME = process.env.FROM_NAME || "DateVault";

  let subject, htmlContent;

  if (data.type === "payment_received") {
    subject = `Payment Confirmed — DateVault Receipt #${invoiceNumber(data.reference || data.memberId)}`;
    htmlContent = invoiceEntry(data, APP_URL);
  } else if (data.type === "subscription_renewed") {
    subject = `${escapeHTML(data.plan || "Standard")} Plan Active — DateVault Receipt`;
    htmlContent = invoiceSubscription(data, APP_URL);
  } else if (data.type === "token_purchase") {
    subject = `Token Purchase Confirmed — DateVault Receipt`;
    htmlContent = invoiceTokens(data, APP_URL);
  } else if (data.type === "addon_purchased") {
    subject = `Add-on Purchase Confirmed — DateVault Receipt`;
    htmlContent = invoiceAddon(data, APP_URL);
  } else if (data.type === "priority_support_requested") {
    subject = `Priority Support Request Received — DateVault Receipt`;
    htmlContent = invoicePrioritySupport(data, APP_URL);
  } else {
    const n = notificationEmail(data.type, data, APP_URL);
    subject = n.subject;
    htmlContent = n.html;
  }

  const safeName = escapeHTML(data.name || "Member");

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json", "api-key": BREVO_API_KEY },
      body: JSON.stringify({
        sender: { email: process.env.EMAIL_ADMIN, name: process.env.EMAIL_ADMIN_NAME || FROM_NAME },
        to: [{ email: data.email, name: safeName }],
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
