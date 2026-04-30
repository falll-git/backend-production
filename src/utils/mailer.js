const nodemailer = require("nodemailer");

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  return String(value).toLowerCase() === "true";
}

function getMailerConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  const fromEmail = process.env.SMTP_FROM_EMAIL?.trim();
  const fromName = process.env.SMTP_FROM_NAME?.trim();

  return {
    host,
    port,
    user,
    pass,
    fromEmail,
    fromName,
    secure: parseBoolean(process.env.SMTP_SECURE, port === 465),
    ignoreTLS: parseBoolean(process.env.SMTP_IGNORE_TLS, false),
  };
}

function isMailerConfigured() {
  const config = getMailerConfig();

  return Boolean(
    config.host &&
    Number.isFinite(config.port) &&
    config.port > 0 &&
    config.user &&
    config.pass &&
    config.fromEmail,
  );
}

function getFromAddress() {
  const config = getMailerConfig();

  if (!config.fromEmail) {
    return null;
  }

  return config.fromName
    ? `"${config.fromName.replace(/"/g, '\\"')}" <${config.fromEmail}>`
    : config.fromEmail;
}

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const config = getMailerConfig();

  cachedTransporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ignoreTLS: config.ignoreTLS,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  return cachedTransporter;
}

async function sendMail({ to, subject, text, html }) {
  if (!isMailerConfigured()) {
    return {
      sent: false,
      status: "not_configured",
      reason: "SMTP_NOT_CONFIGURED",
    };
  }

  const from = getFromAddress();
  const transporter = getTransporter();
  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });

  return {
    sent: true,
    status: "sent",
    messageId: info.messageId,
    accepted: info.accepted,
    rejected: info.rejected,
  };
}

module.exports = {
  getFromAddress,
  getMailerConfig,
  isMailerConfigured,
  sendMail,
};
