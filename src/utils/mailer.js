const { Resend } = require("resend");

function readEnv(key) {
  const value = process.env[key]?.trim();
  return value || "";
}

function isPlaceholder(value) {
  return /^(GANTI|ISI|CHANGE|YOUR)_/i.test(value);
}

function getMailerConfiguration() {
  const apiKey = readEnv("RESEND_API_KEY");
  const fromEmail = readEnv("RESEND_FROM_EMAIL");
  const fromName = readEnv("RESEND_FROM_NAME");

  return {
    apiKey,
    fromEmail,
    fromName,
    fromAddress: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
  };
}

function getMailerConfigurationIssue() {
  const config = getMailerConfiguration();

  if (!config.apiKey || isPlaceholder(config.apiKey)) {
    return "RESEND_API_KEY_NOT_CONFIGURED";
  }

  if (!config.fromEmail || isPlaceholder(config.fromEmail)) {
    return "RESEND_FROM_EMAIL_NOT_CONFIGURED";
  }

  return null;
}

function isMailerConfigured() {
  return !getMailerConfigurationIssue();
}

function getFromAddress() {
  return getMailerConfiguration().fromAddress || null;
}

let cachedClient = null;
let cachedApiKey = null;

function getClient(apiKey) {
  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new Resend(apiKey);
    cachedApiKey = apiKey;
  }

  return cachedClient;
}

async function sendMail({ to, subject, text, html }) {
  const configurationIssue = getMailerConfigurationIssue();
  if (configurationIssue) {
    return {
      sent: false,
      status: "not_configured",
      reason: configurationIssue,
    };
  }

  const config = getMailerConfiguration();
  const resend = getClient(config.apiKey);
  const { data, error } = await resend.emails.send({
    from: config.fromAddress,
    to,
    subject,
    text,
    html,
  });

  if (error) {
    throw new Error(error.message || "Email gagal dikirim melalui Resend.");
  }

  const recipients = Array.isArray(to) ? to : [to];

  return {
    sent: true,
    status: "sent",
    messageId: data?.id || null,
    accepted: recipients,
    rejected: [],
  };
}

module.exports = {
  getFromAddress,
  getMailerConfigurationIssue,
  isMailerConfigured,
  sendMail,
};
