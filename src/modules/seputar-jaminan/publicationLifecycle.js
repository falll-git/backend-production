// Workflow eligibility only: endpoint permission, authority and optimistic lock
// are checked separately. Bank approval is not evidence of public visibility.
exports.withdrawalEligibility = (publication) => {
  if (publication.state === 'IN_REVIEW') {
    return { eligible: false, reason: 'Selesaikan pemeriksaan perubahan sebelum mengajukan penarikan.' };
  }
  if (!publication.published_version_id) {
    return { eligible: false, reason: 'Belum ada versi yang disetujui untuk ditarik.' };
  }
  if (publication.state === 'UNPUBLISHED') {
    return { eligible: false, reason: 'Penarikan sudah dibuat. Periksa status pengirimannya.' };
  }
  if (publication.state === 'ARCHIVED') {
    return { eligible: false, reason: 'Katalog sudah diarsipkan.' };
  }
  if (!['DRAFT', 'REVISION_REQUIRED', 'APPROVED', 'PUBLISHED'].includes(publication.state)) {
    return { eligible: false, reason: 'Status katalog belum mendukung penarikan.' };
  }
  return { eligible: true, reason: null };
};
