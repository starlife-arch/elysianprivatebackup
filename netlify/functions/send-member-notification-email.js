const { json, parseBody, preflight } = require("./_helpers");

function escapeHTML(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function copyFor(type, data, appUrl) {
  const plan = escapeHTML(data.plan || "membership");
  const cases = {
    access_granted: {
      subject: "DateVault access granted",
      title: "Your access has been granted.",
      body: `Your DateVault member access is active${data.days ? ` for ${escapeHTML(data.days)} days` : ""}. You can now return to the member dashboard.`,
      cta: "Open Dashboard", url: `${appUrl}/app/dashboard/`
    },
    plan_assigned: {
      subject: `${plan} plan assigned — DateVault`,
      title: `Your ${plan} plan has been assigned.`,
      body: `An admin has assigned your DateVault account to the ${plan} plan. Your plan benefits are available immediately.`,
      cta: "Open Dashboard", url: `${appUrl}/app/dashboard/`
    },
    access_revoked: {
      subject: "DateVault access revoked",
      title: "Your access has been revoked.",
      body: "Your DateVault member access has been moved back to payment-required status. If you believe this is a mistake, contact support.",
      cta: "Review Payment", url: `${appUrl}/account/payment/`
    },
    user_banned: {
      subject: "DateVault account suspended",
      title: "Your account has been suspended.",
      body: "Your DateVault account has been suspended due to an account or community issue. If you believe this is an error, contact support for review.",
      cta: "Contact Support", url: `${appUrl}/auth/login/`
    },
    user_unbanned: {
      subject: "DateVault account restored",
      title: "Your account has been restored.",
      body: "Your DateVault account suspension has been lifted. You can sign in again and continue using your available member features.",
      cta: "Sign In", url: `${appUrl}/auth/login/`
    },
    reapply_allowed: {
      subject: "You can reapply to DateVault",
      title: "Your reapply chance is open.",
      body: "The DateVault team has reopened your application. Sign in and complete verification again when you are ready.",
      cta: "Complete Verification", url: `${appUrl}/account/verification/`
    },
    subscription_expired: {
      subject: `${plan} plan expired — DateVault`,
      title: `Your ${plan} plan has expired.`,
      body: "Your account is still active on Standard. Renew to restore your paid benefits, including boosts, premium filters, read receipts, and Vault access where applicable.",
      cta: "Renew Plan", url: `${appUrl}/pricing.html`
    },
    subscription_renewed: {
      subject: `${plan} plan active — DateVault`,
      title: `Your ${plan} plan is active.`,
      body: `Your DateVault ${plan} benefits have been restored and are available immediately.`,
      cta: "Open Dashboard", url: `${appUrl}/app/dashboard/`
    },
    verification_submitted: {
      subject: "DateVault verification received",
      title: "Your verification was submitted.",
      body: "Your profile and identity verification are now with the DateVault review team. We will notify you after review before asking for the entry payment.",
      cta: "Check Status", url: `${appUrl}/account/status/`
    },
    wallet_credit: { subject: 'Tokens added to your DateVault wallet', title: 'Tokens were added to your wallet.', body: `${Number(data.amount||0).toLocaleString()} tokens were added by the DateVault team.${data.reason ? ` Reason: ${escapeHTML(data.reason)}` : ''}`, cta: 'Open Token Wallet', url: `${appUrl}/app/wallet/` },
    wallet_debit: { subject: 'DateVault wallet adjustment', title: 'Tokens were deducted from your wallet.', body: `${Number(data.amount||0).toLocaleString()} tokens were deducted by the DateVault team.${data.reason ? ` Reason: ${escapeHTML(data.reason)}` : ''}`, cta: 'Open Token Wallet', url: `${appUrl}/app/wallet/` },
    wallet_set: { subject: 'DateVault wallet balance updated', title: 'Your wallet balance was updated.', body: `The DateVault team updated your token wallet balance.${data.reason ? ` Reason: ${escapeHTML(data.reason)}` : ''}`, cta: 'Open Token Wallet', url: `${appUrl}/app/wallet/` },
    withdrawal_paid: { subject: 'Your DateVault withdrawal was paid', title: 'Your withdrawal has been paid.', body: 'Your withdrawal request has been marked as paid by the DateVault team.', cta: 'Open Token Wallet', url: `${appUrl}/app/wallet/` },
    withdrawal_rejected: { subject: 'Your DateVault withdrawal was rejected', title: 'Your withdrawal was rejected and refunded.', body: `${Number(data.amount||0).toLocaleString()} tokens were returned to your wallet.${data.reason ? ` Reason: ${escapeHTML(data.reason)}` : ''}`, cta: 'Open Token Wallet', url: `${appUrl}/app/wallet/` },
    token_purchase: {
      subject: "Your DateVault tokens are ready",
      title: "Your token purchase was successful.",
      body: `${Number(data.tokens || 0).toLocaleString()} tokens were added to your DateVault wallet. Your new tokens are ready to use for gifts and other wallet features.`,
      cta: "Open Token Wallet", url: `${appUrl}/app/wallet/`
    },
    payment_received: {
      subject: "DateVault payment received",
      title: "Your payment was received.",
      body: "Your DateVault entry payment has been confirmed. Your Standard membership benefits are active now.",
      cta: "Open Dashboard", url: `${appUrl}/app/dashboard/`
    },
    priority_support_requested: {
      subject: "Priority Support request received — DateVault",
      title: "Priority Support request received.",
      body: "Your $100 Priority Support request has been recorded. The admin team will confirm your scheduled video call manually after reviewing your request.",
      cta: "Open Support", url: `${appUrl}/chat.html?tab=support`
    }
  };
  return cases[type] || { subject: "DateVault notification", title: "DateVault update", body: "There is an update on your DateVault account.", cta: "Open DateVault", url: appUrl };
}

exports.handler = async function(event) {
  const options = preflight(event);
  if (options) return options;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  const data = parseBody(event);
  if (!data.email) return json(400, { error: "Missing email" });

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const paymentTypes = new Set(["subscription_expired", "subscription_renewed", "payment_received", "token_purchase", "wallet_credit", "wallet_debit", "wallet_set", "withdrawal_paid", "withdrawal_rejected", "priority_support_requested"]);
  const adminTypes = new Set(["access_granted", "access_revoked", "plan_assigned", "user_banned", "user_unbanned", "reapply_allowed"]);
  const FROM_EMAIL = paymentTypes.has(data.type)
    ? (process.env.EMAIL_PAYMENT || process.env.FROM_EMAIL || "noreply@datevault.com")
    : adminTypes.has(data.type)
      ? (process.env.EMAIL_ADMIN || process.env.FROM_EMAIL || "noreply@datevault.com")
      : (process.env.EMAIL_ALERTS || process.env.FROM_EMAIL || "noreply@datevault.com");
  const FROM_NAME = process.env.FROM_NAME || "DateVault";
  const APP_URL = (process.env.APP_URL || "https://elysiandate.site").replace("https://elysiandate.netlify.app", "https://elysiandate.site");
  if (!BREVO_API_KEY) return json(500, { error: "Brevo not configured" });

  const safeName = escapeHTML(data.name || "Member");
  const memberId = escapeHTML(data.memberId || "");
  const c = copyFor(data.type, data, APP_URL);
  const htmlBody = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head><body style="margin:0;padding:0;background:#060810;font-family:Arial,sans-serif;color:#f0f2f8;"><div style="max-width:560px;margin:0 auto;background:#060810;"><div style="background:#0d1120;padding:40px;text-align:center;border-bottom:1px solid rgba(201,168,76,0.2);"><div style="font-family:Georgia,serif;font-size:32px;color:#e8cb7a;letter-spacing:0.2em;">DateVault</div><div style="color:#6b7a99;font-size:13px;letter-spacing:0.1em;margin-top:8px;">PRIVATE MEMBERSHIP</div></div><div style="padding:40px;"><h1 style="font-family:Georgia,serif;font-weight:400;color:#f0f2f8;">${escapeHTML(c.title)}</h1><p style="color:rgba(240,242,248,0.75);font-size:15px;line-height:1.7;">Hi ${safeName},</p><p style="color:rgba(240,242,248,0.75);font-size:15px;line-height:1.7;">${c.body}</p>${memberId ? `<div style="background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);border-radius:14px;padding:16px;margin:22px 0;color:#c9a84c;font-size:13px;">Member ID: ${memberId}</div>` : ""}<a href="${c.url}" style="display:block;background:#c9a84c;color:#1a1200;text-decoration:none;padding:16px 32px;border-radius:999px;font-weight:600;text-align:center;margin:28px 0;">${escapeHTML(c.cta)}</a><p style="color:#6b7a99;font-size:12px;line-height:1.6;">If you did not expect this update, please contact DateVault support.</p></div></div></body></html>`;

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json", "api-key": BREVO_API_KEY },
      body: JSON.stringify({ sender: {
        email: process.env.EMAIL_ADMIN,
        name: process.env.EMAIL_ADMIN_NAME
      }, to: [{ email: data.email, name: safeName }], subject: c.subject, htmlContent: htmlBody })
    });
    const resData = await response.json();
    if (!response.ok) return json(500, { error: resData.message || "Email send failed", details: resData });
    return json(200, { success: true, messageId: resData.messageId });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
