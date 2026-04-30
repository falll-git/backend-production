function formatExpiry(expiresAt) {
  const date = new Date(expiresAt);
  return date.toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function buildInvitationEmailTemplate({
  name,
  username,
  invitationUrl,
  expiresAt,
}) {
  const safeName = name || username;
  const expiryLabel = formatExpiry(expiresAt);

  const subject = "Undangan Aktivasi Akun";
  const text = [
    `Halo ${safeName},`,
    "",
    "Akun Anda sudah dibuat dan siap diaktivasi.",
    `Username: ${username}`,
    "",
    "Silakan buka tautan berikut untuk membuat password pertama Anda:",
    invitationUrl,
    "",
    `Link ini berlaku sampai ${expiryLabel}.`,
    "",
    "Jika Anda tidak merasa meminta akses ini, abaikan email ini.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
      <p>Halo <strong>${safeName}</strong>,</p>
      <p>Akun Anda sudah dibuat dan siap diaktivasi.</p>
      <p><strong>Username:</strong> ${username}</p>
      <p>Silakan klik tombol berikut untuk membuat password pertama Anda:</p>
      <p>
        <a
          href="${invitationUrl}"
          style="display:inline-block;padding:12px 18px;background:#0f766e;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;"
        >
          Set Password
        </a>
      </p>
      <p>Atau buka link ini secara manual:</p>
      <p><a href="${invitationUrl}">${invitationUrl}</a></p>
      <p>Link ini berlaku sampai <strong>${expiryLabel}</strong>.</p>
      <p>Jika Anda tidak merasa meminta akses ini, abaikan email ini.</p>
    </div>
  `;

  return {
    subject,
    text,
    html,
  };
}

function buildPasswordResetEmailTemplate({
  name,
  username,
  resetPasswordUrl,
  expiresAt,
}) {
  const safeName = name || username;
  const expiryLabel = formatExpiry(expiresAt);

  const subject = "Reset Password Akun";
  const text = [
    `Halo ${safeName},`,
    "",
    "Kami menerima permintaan untuk mereset password akun Anda.",
    `Username: ${username}`,
    "",
    "Silakan buka tautan berikut untuk membuat password baru:",
    resetPasswordUrl,
    "",
    `Link ini berlaku sampai ${expiryLabel}.`,
    "",
    "Jika Anda tidak meminta reset password, abaikan email ini.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
      <p>Halo <strong>${safeName}</strong>,</p>
      <p>Kami menerima permintaan untuk mereset password akun Anda.</p>
      <p><strong>Username:</strong> ${username}</p>
      <p>Silakan klik tombol berikut untuk membuat password baru:</p>
      <p>
        <a
          href="${resetPasswordUrl}"
          style="display:inline-block;padding:12px 18px;background:#b45309;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;"
        >
          Reset Password
        </a>
      </p>
      <p>Atau buka link ini secara manual:</p>
      <p><a href="${resetPasswordUrl}">${resetPasswordUrl}</a></p>
      <p>Link ini berlaku sampai <strong>${expiryLabel}</strong>.</p>
      <p>Jika Anda tidak meminta reset password, abaikan email ini.</p>
    </div>
  `;

  return {
    subject,
    text,
    html,
  };
}

module.exports = {
  buildInvitationEmailTemplate,
  buildPasswordResetEmailTemplate,
};
