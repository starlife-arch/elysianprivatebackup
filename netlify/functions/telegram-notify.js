const { json, parseBody, preflight } = require("./_helpers");

exports.handler = async function(event) {
  const options = preflight(event);
  if (options) return options;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!BOT_TOKEN || !CHAT_ID) return json(200, { skipped: true, reason: "Telegram not configured" });

  const {
    event: eventName, uid, memberId, name, email, country, method, reason, days, plan, billing, amountUSD,
    reporterUID, reporterName, reporterEmail, reportedUID, reportedName, reportedEmail, preview, message
  } = parseBody(event);

  const userLabel = name || email || uid || "Member";
  const userLine = `${userLabel}${memberId ? ` (${memberId})` : ""}${email ? `\n ${email}` : ""}`;
  const reporterLine = reporterName || reporterEmail || reporterUID || "Unknown reporter";
  const reportedLine = reportedName || reportedEmail || reportedUID || "Unknown member";
  const messages = {
    user_joined: ` New Application\n ${userLine}\n ${country || "Unknown"}`,
    verification_submitted: ` Verification Submitted\n ${userLine}\n ${country || "Unknown"}`,
    user_approved: ` Member Approved\n ${userLine}\n ${country || "Unknown"}`,
    user_rejected: ` Application Rejected\n ${userLine}\nReason: ${reason || "Not specified"}`,
    reapply_allowed: `↻ Reapply Allowed\n ${userLine}`,
    user_banned: ` User Banned\n ${userLine}`,
    user_unbanned: ` User Unbanned\n ${userLine}`,
    token_purchase: `Token Purchase\n ${userLine}\nTokens: ${amountUSD || 'unknown'} USD`,
    payment_received: ` Payment Received\n ${userLine}\nMethod: ${method || "unknown"}`,
    access_granted: ` Admin Access Granted\n ${userLine}\nDuration: ${days || "lifetime"}`,
    plan_assigned: ` Admin Plan Assigned\n ${userLine}\nPlan: ${plan || "unknown"}${billing ? ` ${billing}` : ""}`,
    access_revoked: ` Access Revoked\n ${userLine}`,
    subscription_payment_received: ` Subscription Payment Received\n ${userLine}\nPlan: ${plan || "unknown"} ${billing || ""}\nAmount: $${amountUSD || "—"}\nMethod: ${method || "unknown"}`,
    subscription_expired: `⌛ Subscription Expired\n ${userLine}\nPlan: ${plan || "unknown"}`,
    priority_support_requested: `️ Priority Support Requested\n ${userLine}\nAmount: $${amountUSD || 100}\nMethod: ${method || "unknown"}`,
    user_reported: ` User Report\nReporter: ${reporterLine}\nReported: ${reportedLine}\nReason: ${reason}\n\n Preview:\n${(preview || "").slice(0, 200)}`
  };
  const text = message || messages[eventName] || ` Event: ${eventName}\n ${userLine}`;

  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) return json(500, { success: false, data });
    return json(200, { success: true, data });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
