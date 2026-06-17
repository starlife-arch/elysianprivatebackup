const { json, parseBody, preflight } = require("./_helpers");

function escapeHTML(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

exports.handler = async function(event) {
  const options = preflight(event);
  if (options) return options;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const { email, memberName, ticketId, subject, message, phone, priority, requestType } = parseBody(event);
  if (!email || !memberName || !ticketId || !subject || !message) return json(400, { error: "Missing fields" });

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) return json(500, { error: "Brevo not configured" });

  const safeName = escapeHTML(memberName);
  const safeTicketId = escapeHTML(ticketId);
  const safeSubject = escapeHTML(subject);
  const safeMessage = escapeHTML(message);
  const safePhone = escapeHTML(phone || "");
  const isPriority = priority === true || requestType === "priority_support" || requestType === "vault_call";
  const title = requestType === "vault_call" ? "Vault call request received." : (isPriority ? "Priority support request received." : "Support request received.");
  const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#060810;font-family:Arial,sans-serif;color:#f0f2f8;">
  <div style="max-width:560px;margin:0 auto;background:#060810;">
    <div style="background:#0d1120;padding:40px;text-align:center;border-bottom:1px solid rgba(201,168,76,0.2);">
      <div style="font-family:Georgia,serif;font-size:32px;color:#e8cb7a;letter-spacing:0.2em;">DateVault</div>
      <div style="color:#6b7a99;font-size:13px;letter-spacing:0.1em;margin-top:8px;">PRIVATE MEMBERSHIP</div>
    </div>
    <div style="padding:40px;">
      <h1 style="font-family:Georgia,serif;font-weight:400;color:#f0f2f8;">${title}</h1>
      <p style="color:rgba(240,242,248,0.75);font-size:15px;line-height:1.7;">Hi ${safeName},</p>
      <p style="color:rgba(240,242,248,0.75);font-size:15px;line-height:1.7;">Thank you for contacting DateVault Support.</p>
      <p style="color:rgba(240,242,248,0.75);font-size:15px;line-height:1.7;">We have received your request and our team will review it shortly.</p>
      <div style="background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.3);border-radius:16px;padding:20px;margin:24px 0;">
        <div style="color:#c9a84c;font-size:13px;font-weight:bold;letter-spacing:0.08em;margin-bottom:14px;">TICKET DETAILS</div>
        <p style="color:rgba(240,242,248,0.8);font-size:15px;line-height:1.7;margin:0 0 10px;"><strong>Ticket ID:</strong> ${safeTicketId}</p>
        <p style="color:rgba(240,242,248,0.8);font-size:15px;line-height:1.7;margin:0 0 10px;"><strong>Subject:</strong> ${safeSubject}</p>
        <p style="color:rgba(240,242,248,0.8);font-size:15px;line-height:1.7;margin:0 0 10px;"><strong>Message:</strong> ${safeMessage}</p>${safePhone ? `<p style="color:rgba(240,242,248,0.8);font-size:15px;line-height:1.7;margin:0;"><strong>Callback phone:</strong> ${safePhone}</p>` : ""}
      </div>
      <p style="color:#c9a84c;font-size:15px;font-weight:600;line-height:1.7;margin:0 0 10px;">What happens next?</p>
      <p style="color:rgba(240,242,248,0.75);font-size:15px;line-height:1.7;">${isPriority ? "Your Vault priority request has been flagged for faster admin review." : "Our support team aims to respond within 2–5 business days."}</p>
      <p style="color:rgba(240,242,248,0.75);font-size:15px;line-height:1.7;">You can send follow-up questions or additional information by replying directly to this email. Please include your Ticket ID ${safeTicketId} in all correspondence.</p>
      <p style="color:#6b7a99;font-size:12px;line-height:1.6;">If you did not submit this request, please ignore this email. If you believe someone is attempting to access your account, contact us immediately by replying to this email.</p>
      <p style="color:rgba(240,242,248,0.75);font-size:15px;line-height:1.7;">— The DateVault Support Team<br/><a href="https://elysiandate.site" style="color:#c9a84c;text-decoration:none;">https://elysiandate.site</a></p>
    </div>
  </div>
</body>
</html>`;

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "api-key": BREVO_API_KEY
      },
      body: JSON.stringify({
        sender: {
          email: process.env.EMAIL_SUPPORT,
          name: process.env.EMAIL_SUPPORT_NAME
        },
        to: [{ email, name: memberName }],
        replyTo: {
          email: process.env.EMAIL_SUPPORT,
          name: process.env.EMAIL_SUPPORT_NAME
        },
        subject: `${isPriority ? "Priority support" : "Support request"} received — DateVault [${ticketId}]`,
        htmlContent: htmlBody
      })
    });
    const data = await response.json();
    if (!response.ok) return json(500, { error: data.message || "Email send failed", details: data });
    return json(200, { success: true });
  } catch (e) {
    console.error("Ticket email error:", e);
    return json(500, { error: e.message });
  }
};
