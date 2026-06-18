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

function notificationModuleLabel(moduleName) {
  const normalized = String(moduleName || "").trim().toUpperCase();
  if (normalized === "DIGITAL_ARCHIVE") return "Arsip Digital";
  if (normalized === "CORRESPONDENCE") return "Manajemen Surat";
  return "Pemberitahuan";
}

function notificationStateLabel(eventType, title = "", message = "") {
  const normalized = String(eventType || "").trim().toUpperCase();
  const text = `${title} ${message}`.toLowerCase();

  switch (normalized) {
    case "ACTION_REQUIRED":
      return "Perlu Tindakan";
    case "DUE_SOON":
      return "Mendekati Tenggat";
    case "OVERDUE":
      return "Lewat Tenggat";
    case "APPROVED":
      return "Disetujui";
    case "REJECTED":
      return "Ditolak";
    case "COMPLETED":
      return "Selesai";
    case "RETURNED":
      return "Dikembalikan";
    default:
      if (
        text.includes("selesai") ||
        text.includes("dikembalikan") ||
        text.includes("disetujui")
      ) {
        return "Selesai";
      }
      return "Info";
  }
}

function toneByEventType(eventType, title = "", message = "") {
  const normalized = String(eventType || "").trim().toUpperCase();
  const text = `${title} ${message}`.toLowerCase();

  if (normalized === "REJECTED" || normalized === "OVERDUE") return "danger";
  if (normalized === "ACTION_REQUIRED" || normalized === "DUE_SOON") {
    return "warning";
  }
  if (
    normalized === "APPROVED" ||
    normalized === "COMPLETED" ||
    normalized === "RETURNED" ||
    text.includes("selesai") ||
    text.includes("dikembalikan") ||
    text.includes("disetujui")
  ) {
    return "success";
  }

  return "brand";
}

function getPalette(tone = "brand") {
  switch (tone) {
    case "warning":
      return {
        accent: "#d97706",
        accentSoft: "#fff7ed",
        accentBorder: "#fed7aa",
        buttonBg: "#d97706",
        buttonText: "#ffffff",
        badgeBg: "#fffbeb",
        badgeText: "#b45309",
        badgeBorder: "#fcd34d",
      };
    case "danger":
      return {
        accent: "#dc2626",
        accentSoft: "#fef2f2",
        accentBorder: "#fecaca",
        buttonBg: "#dc2626",
        buttonText: "#ffffff",
        badgeBg: "#fff1f2",
        badgeText: "#be123c",
        badgeBorder: "#fecdd3",
      };
    case "success":
      return {
        accent: "#059669",
        accentSoft: "#ecfdf3",
        accentBorder: "#bbf7d0",
        buttonBg: "#059669",
        buttonText: "#ffffff",
        badgeBg: "#ecfdf3",
        badgeText: "#047857",
        badgeBorder: "#bbf7d0",
      };
    case "info":
      return {
        accent: "#2563eb",
        accentSoft: "#eff6ff",
        accentBorder: "#bfdbfe",
        buttonBg: "#2563eb",
        buttonText: "#ffffff",
        badgeBg: "#eff6ff",
        badgeText: "#1d4ed8",
        badgeBorder: "#bfdbfe",
      };
    default:
      return {
        accent: "#0f766e",
        accentSoft: "#f0fdfa",
        accentBorder: "#99f6e4",
        buttonBg: "#0f766e",
        buttonText: "#ffffff",
        badgeBg: "#f0fdfa",
        badgeText: "#0f766e",
        badgeBorder: "#99f6e4",
      };
  }
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

function renderInlineBadges(badges, palette) {
  const items = (badges || []).filter(Boolean);
  if (items.length === 0) return "";

  return `
    <div style="margin:0 0 18px;">
      ${items
        .map(
          (badge) => `
            <span style="display:inline-block;margin:0 8px 8px 0;padding:6px 10px;border-radius:999px;border:1px solid ${
              badge.kind === "neutral" ? "#dbe5f0" : palette.badgeBorder
            };background:${badge.kind === "neutral" ? "#f8fafc" : palette.badgeBg};color:${
              badge.kind === "neutral" ? "#475569" : palette.badgeText
            };font-size:12px;font-weight:700;line-height:1.2;">${escapeHtml(
              badge.label,
            )}</span>`,
        )
        .join("")}
    </div>
  `;
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
  summaryBadges = [],
  tone = "brand",
}) {
  const safeTitle = escapeHtml(title);
  const safeGreetingName = escapeHtml(greetingName);
  const safeIntro = escapeHtml(intro);
  const safeActionLabel = escapeHtml(actionLabel);
  const safeActionUrl = escapeHtml(actionUrl);
  const safeClosingNote = escapeHtml(closingNote);
  const safeExpiryLabel = escapeHtml(expiryLabel);
  const palette = getPalette(tone);
  const detailRows = details
    .filter(Boolean)
    .map(
      (detail) => `
        <tr>
          <td style="padding:0 0 10px;color:#334155;font-size:14px;line-height:1.65;">&bull; ${escapeHtml(detail)}</td>
        </tr>`,
    )
    .join("");

  return `
    <div style="margin:0;padding:0;background:#f4f7fb;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f4f7fb;">
        <tr>
          <td align="center" style="padding:28px 16px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #dbe5f0;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
              <tr>
                <td style="padding:22px 28px 18px;background:${palette.accentSoft};border-bottom:1px solid ${palette.accentBorder};">
                  <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${palette.accent};">Pemberitahuan ${BRAND_NAME}</div>
                  <div style="margin-top:8px;font-size:26px;font-weight:800;line-height:1.2;color:#0f172a;">${safeTitle}</div>
                  <div style="margin-top:6px;font-size:13px;line-height:1.6;color:#64748b;">${BRAND_TAGLINE}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 28px;">
                  ${renderInlineBadges(summaryBadges, palette)}
                  <p style="margin:0 0 14px;font-size:15px;line-height:1.75;color:#334155;">Yth. Bapak/Ibu <strong>${safeGreetingName}</strong>,</p>
                  <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:#334155;">${safeIntro}</p>
                  ${
                    detailRows
                      ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;border-collapse:collapse;padding:16px 18px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">${detailRows}</table>`
                      : ""
                  }
                  ${
                    actionUrl
                      ? `<p style="margin:0 0 20px;"><a href="${safeActionUrl}" style="display:inline-block;padding:12px 18px;background:${palette.buttonBg};color:${palette.buttonText};text-decoration:none;border-radius:10px;font-size:14px;font-weight:700;">${safeActionLabel}</a></p>`
                      : ""
                  }
                  ${
                    actionUrl
                      ? `<p style="margin:0 0 16px;font-size:13px;line-height:1.65;color:#64748b;">Jika tombol tidak dapat dibuka, gunakan tautan berikut:<br><a href="${safeActionUrl}" style="color:#0369a1;word-break:break-all;">${safeActionUrl}</a></p>`
                      : ""
                  }
                  ${
                    expiryLabel
                      ? `<p style="margin:0 0 14px;font-size:13px;line-height:1.65;color:#475569;">Tautan ini berlaku sampai <strong>${safeExpiryLabel}</strong>.</p>`
                      : ""
                  }
                  <p style="margin:0;font-size:13px;line-height:1.7;color:#64748b;">${safeClosingNote}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
                  <p style="margin:0;font-size:12px;line-height:1.65;color:#64748b;">Email ini dikirim otomatis oleh ${BRAND_NAME}. Mohon tidak membalas email ini.</p>
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
  const intro =
    "Akun Anda telah dibuat dan perlu diaktivasi sebelum dapat digunakan.";
  const details = [`Username: ${username}`];
  const closingNote =
    "Jika Anda tidak merasa meminta atau menerima akses ini, abaikan email ini.";

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
      summaryBadges: [{ label: "Akses Akun", kind: "neutral" }],
      tone: "brand",
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
  const closingNote =
    "Jika Anda tidak meminta reset password, abaikan email ini dan password Anda tidak akan berubah.";

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
      summaryBadges: [{ label: "Keamanan Akun", kind: "neutral" }],
      tone: "info",
    }),
  };
}

function buildNotificationEmailTemplate({
  name,
  title,
  message,
  actionUrl,
  module,
  eventType,
}) {
  const safeName = name || "Pengguna";
  const subject = `[Ruwang Arsip] ${title}`;
  const intro = message;
  const moduleText = notificationModuleLabel(module);
  const statusText = notificationStateLabel(eventType, title, message);
  const closingNote =
    "Email ini hanya berisi ringkasan. Silakan login ke aplikasi untuk melihat detail dan menindaklanjuti pemberitahuan.";
  const details = [`Modul: ${moduleText}`, `Status: ${statusText}`];
  const tone = toneByEventType(eventType, title, message);

  return {
    subject,
    text: buildTextEmail({
      greetingName: safeName,
      intro,
      details,
      actionLabel: "Buka Ruwang Arsip",
      actionUrl,
      closingNote,
    }),
    html: buildEmailLayout({
      title,
      greetingName: safeName,
      intro,
      details,
      actionLabel: "Buka Ruwang Arsip",
      actionUrl,
      closingNote,
      summaryBadges: [
        { label: moduleText, kind: "neutral" },
        { label: statusText },
      ],
      tone,
    }),
  };
}

module.exports = {
  buildInvitationEmailTemplate,
  buildNotificationEmailTemplate,
  buildPasswordResetEmailTemplate,
};
