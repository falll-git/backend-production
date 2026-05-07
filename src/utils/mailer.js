const { Resend } = require("resend");

function isMailerConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function getFromAddress() {
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  const fromName = process.env.RESEND_FROM_NAME?.trim();

  if (!fromEmail) {
    return null;
  }

  return fromName ? `${fromName} <${fromEmail}>` : fromEmail;
}

let cachedClient = null;

function getClient() {
  if (!cachedClient) {
    cachedClient = new Resend(process.env.RESEND_API_KEY);
  }

  return cachedClient;
}

async function sendMail({ to, subject, text, html }) {
  if (!isMailerConfigured()) {
    return {
      sent: false,
      status: "not_configured",
      reason: "RESEND_NOT_CONFIGURED",
    };
  }

  const resend = getClient();
  const { data, error } = await resend.emails.send({
    from: getFromAddress(),
    to,
    subject,
    text,
    html,
  });

  if (error) {
    throw new Error(error.message);
  }

  return {
    sent: true,
    status: "sent",
    messageId: data.id,
    accepted: [to],
    rejected: [],
  };
}

module.exports = {
  getFromAddress,
  isMailerConfigured,
  sendMail,
};
