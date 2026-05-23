const BRAND_NAME = "Ruwang Arsip";
const BRAND_TAGLINE = "Sistem pengelolaan arsip dan persuratan";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatExpiry(expiresAt) {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function buildTextEmail({
  greetingName,
  intro,
  details = [],
  actionLabel,
  actionUrl,
  expiryLabel,
  closingNote,
}) {
  return [
    `Yth. Bapak/Ibu ${greetingName},`,
    "",
    intro,
    "",
    ...details.filter(Boolean),
    details.filter(Boolean).length > 0 ? "" : null,
    actionUrl ? `${actionLabel}: ${actionUrl}` : null,
    expiryLabel ? `Tautan ini berlaku sampai ${expiryLabel}.` : null,
    "",
    closingNote,
    "",
    "Email ini dikirim otomatis oleh Ruwang Arsip. Mohon tidak membalas email ini.",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildEmailLayout({
  title,
  greetingName,
  intro,
  details = [],
  actionLabel,
  actionUrl,
  expiryLabel,
  closingNote,
}) {
  const safeTitle = escapeHtml(title);
  const safeGreetingName = escapeHtml(greetingName);
  const safeIntro = escapeHtml(intro);
  const safeActionLabel = escapeHtml(actionLabel);
  const safeActionUrl = escapeHtml(actionUrl);
  const safeClosingNote = escapeHtml(closingNote);
  const safeExpiryLabel = escapeHtml(expiryLabel);
  const detailItems = details
    .filter(Boolean)
    .map((detail) => `<li style="margin:0 0 8px;color:#334155;">${escapeHtml(detail)}</li>`)
    .join("");

  return `
    <div style="margin:0;padding:0;background:#f1f5f9;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f1f5f9;">
        <tr>
          <td align="center" style="padding:32px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;border-collapse:collapse;background:#ffffff;border:1px solid #dbeafe;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
              <tr>
                <td style="padding:24px 28px;background:#0f766e;color:#ffffff;">
                  <div style="font-size:20px;font-weight:800;letter-spacing:0;">${BRAND_NAME}</div>
                  <div style="font-size:13px;margin-top:4px;color:#ccfbf1;">${BRAND_TAGLINE}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:28px;">
                  <h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:#0f172a;">${safeTitle}</h1>
                  <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#334155;">Yth. Bapak/Ibu <strong>${safeGreetingName}</strong>,</p>
                  <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#334155;">${safeIntro}</p>
                  ${
                    detailItems
                      ? `<ul style="margin:0 0 20px;padding-left:20px;font-size:14px;line-height:1.6;">${detailItems}</ul>`
                      : ""
                  }
                  ${
                    actionUrl
                      ? `<p style="margin:0 0 22px;"><a href="${safeActionUrl}" style="display:inline-block;padding:12px 18px;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;">${safeActionLabel}</a></p>`
                      : ""
                  }
                  ${
                    actionUrl
                      ? `<p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#64748b;">Jika tombol tidak dapat dibuka, salin tautan berikut ke browser:<br><a href="${safeActionUrl}" style="color:#0369a1;word-break:break-all;">${safeActionUrl}</a></p>`
                      : ""
                  }
                  ${
                    expiryLabel
                      ? `<p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#475569;">Tautan ini berlaku sampai <strong>${safeExpiryLabel}</strong>.</p>`
                      : ""
                  }
                  <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">${safeClosingNote}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
                  <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">Email ini dikirim otomatis oleh ${BRAND_NAME}. Mohon tidak membalas email ini.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;
}

function buildInvitationEmailTemplate({
  name,
  username,
  invitationUrl,
  expiresAt,
}) {
  const safeName = name || username || "Pengguna";
  const expiryLabel = formatExpiry(expiresAt);
  const subject = "Aktivasi Akun Ruwang Arsip";
  const intro = "Akun Anda telah dibuat dan perlu diaktivasi sebelum dapat digunakan.";
  const details = [`Username: ${username}`];
  const closingNote = "Jika Anda tidak merasa meminta atau menerima akses ini, abaikan email ini.";

  return {
    subject,
    text: buildTextEmail({
      greetingName: safeName,
      intro,
      details,
      actionLabel: "Aktivasi Akun",
      actionUrl: invitationUrl,
      expiryLabel,
      closingNote,
    }),
    html: buildEmailLayout({
      title: subject,
      greetingName: safeName,
      intro,
      details,
      actionLabel: "Aktivasi Akun",
      actionUrl: invitationUrl,
      expiryLabel,
      closingNote,
    }),
  };
}

function buildPasswordResetEmailTemplate({
  name,
  username,
  resetPasswordUrl,
  expiresAt,
}) {
  const safeName = name || username || "Pengguna";
  const expiryLabel = formatExpiry(expiresAt);
  const subject = "Reset Password Ruwang Arsip";
  const intro = "Kami menerima permintaan untuk mereset password akun Anda.";
  const details = [`Username: ${username}`];
  const closingNote = "Jika Anda tidak meminta reset password, abaikan email ini dan password Anda tidak akan berubah.";

  return {
    subject,
    text: buildTextEmail({
      greetingName: safeName,
      intro,
      details,
      actionLabel: "Reset Password",
      actionUrl: resetPasswordUrl,
      expiryLabel,
      closingNote,
    }),
    html: buildEmailLayout({
      title: subject,
      greetingName: safeName,
      intro,
      details,
      actionLabel: "Reset Password",
      actionUrl: resetPasswordUrl,
      expiryLabel,
      closingNote,
    }),
  };
}

function buildNotificationEmailTemplate({
  name,
  title,
  message,
  actionUrl,
}) {
  const safeName = name || "Pengguna";
  const subject = `[Ruwang Arsip] ${title}`;
  const intro = message;
  const closingNote = "Email ini hanya berisi ringkasan. Silakan login ke aplikasi untuk melihat detail dan menindaklanjuti pemberitahuan.";

  return {
    subject,
    text: buildTextEmail({
      greetingName: safeName,
      intro,
      actionLabel: "Buka Ruwang Arsip",
      actionUrl,
      closingNote,
    }),
    html: buildEmailLayout({
      title,
      greetingName: safeName,
      intro,
      actionLabel: "Buka Ruwang Arsip",
      actionUrl,
      closingNote,
    }),
  };
}

module.exports = {
  buildInvitationEmailTemplate,
  buildNotificationEmailTemplate,
  buildPasswordResetEmailTemplate,
};
