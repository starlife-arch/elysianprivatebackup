const { json, parseBody, preflight } = require("./_helpers");

exports.handler = async function(event) {
  const options = preflight(event);
  if (options) return options;
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const { recipients, subject, htmlContent } = parseBody(event);
  if (!Array.isArray(recipients) || !recipients.length || !subject || !htmlContent) return json(400, { error: "Missing fields" });
  if (recipients.length > 50) return json(400, { error: "Max 50 recipients per call" });

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  if (!BREVO_API_KEY) return json(500, { error: "Brevo not configured" });

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json", "api-key": BREVO_API_KEY },
      body: JSON.stringify({
        sender: { email: process.env.EMAIL_SUPPORT, name: process.env.EMAIL_SUPPORT_NAME },
        subject,
        htmlContent,
        messageVersions: recipients.map(r => ({ to: [{ email: r.email, name: r.name || "Member" }] }))
      })
    });
    const data = await response.json();
    if (!response.ok) return json(500, { error: data.message || "Broadcast send failed", details: data });
    return json(200, { success: true, sent: recipients.length });
  } catch (e) {
    console.error("Broadcast email error:", e);
    return json(500, { error: e.message });
  }
};
