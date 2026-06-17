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

  const { email, memberName, dateTime, meetLink } = parseBody(event);
  if (!email || !dateTime || !meetLink) return json(400, { error: "Missing required fields" });

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const FROM_EMAIL = process.env.EMAIL_ADMIN || process.env.FROM_EMAIL || "noreply@datevault.com";
  const FROM_NAME = process.env.FROM_NAME || "DateVault";

  if (!BREVO_API_KEY) return json(500, { error: "Brevo not configured" });

  const safeName = escapeHTML(memberName || "Member");
  const safeDateTime = escapeHTML(dateTime);
  const safeMeetLink = escapeHTML(meetLink);
  const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#060810;font-family:Arial,sans-serif;color:#f0f2f8;">
  <div style="max-width:560px;margin:0 auto;background:#060810;">
    <div style="background:#0d1120;padding:40px;text-align:center;border-bottom:1px solid rgba(201,168,76,0.2);">
      <div style="font-family:Georgia,serif;font-size:32px;color:#e8cb7a;letter-spacing:0.2em;">DateVault</div>
      <div style="color:#6b7a99;font-size:13px;letter-spacing:0.1em;margin-top:8px;">VIDEO VERIFICATION</div>
    </div>
    <div style="padding:40px;">
      <h1 style="font-family:Georgia,serif;font-weight:400;color:#f0f2f8;">Hi ${safeName}.</h1>
      <p style="color:rgba(240,242,248,0.75);font-size:15px;line-height:1.7;">Your video verification call has been scheduled.</p>
      <div style="background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.25);border-radius:16px;padding:20px;margin:24px 0;">
        <div style="color:#c9a84c;font-size:13px;font-weight:bold;letter-spacing:0.08em;margin-bottom:10px;">CALL DETAILS</div>
        <p style="color:rgba(240,242,248,0.8);font-size:15px;line-height:1.7;margin:0 0 10px;"><strong>Date &amp; Time:</strong> ${safeDateTime}</p>
        <p style="color:rgba(240,242,248,0.8);font-size:15px;line-height:1.7;margin:0;"><strong>Join here:</strong> <a href="${safeMeetLink}" style="color:#c9a84c;word-break:break-all;">${safeMeetLink}</a></p>
      </div>
      <a href="${safeMeetLink}" style="display:block;background:#c9a84c;color:#1a1200;text-decoration:none;padding:16px 32px;border-radius:999px;font-weight:600;text-align:center;margin:28px 0;">Join Video Call</a>
      <p style="color:rgba(240,242,248,0.75);font-size:15px;line-height:1.7;">Please be on time. If you need to reschedule, contact support.</p>
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
          email: process.env.EMAIL_ADMIN,
          name: process.env.EMAIL_ADMIN_NAME
        },
        to: [{ email, name: memberName || "Member" }],
        subject: "Your Video Verification Call is Scheduled — DateVault",
        htmlContent: htmlBody
      })
    });
    const data = await response.json();
    if (!response.ok) return json(500, { error: data.message || "Email send failed", details: data });
    return json(200, { success: true, messageId: data.messageId });
  } catch (e) {
    console.error("Video call email error:", e);
    return json(500, { error: e.message });
  }
};
