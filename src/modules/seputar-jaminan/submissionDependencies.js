const { AppError } = require('../../utils/errors');

// Match the database review guard before changing DRAFT to IN_REVIEW. Older
// approved versions remain readable, but cannot be submitted as current data.
function assertCurrentSubmissionDependencies(version) {
  const profileVersion = version?.profile_version;
  const profile = profileVersion?.profile;
  if (!version?.profile_version_id || profileVersion?.state !== 'APPROVED'
      || profile?.state !== 'VERIFIED'
      || profile.current_version_id !== version.profile_version_id) {
    const error = new AppError('Profil BPRS sudah berubah atau belum disetujui. Muat ulang data sebelum mengajukan.', 409);
    error.code = 'SJ_SUBMISSION_PROFILE_NOT_CURRENT';
    throw error;
  }
  const contactVersion = version.whatsapp_contact_version;
  const contact = contactVersion?.contact;
  if (!version.whatsapp_contact_version_id || contactVersion?.state !== 'VERIFIED'
      || contact?.state !== 'VERIFIED' || contact.revoked_at
      || contact.current_version_id !== version.whatsapp_contact_version_id) {
    const error = new AppError('Kontak WhatsApp sudah berubah atau dicabut. Pilih kontak aktif sebelum mengajukan.', 409);
    error.code = 'SJ_SUBMISSION_CONTACT_NOT_CURRENT';
    throw error;
  }
}

module.exports = { assertCurrentSubmissionDependencies };
