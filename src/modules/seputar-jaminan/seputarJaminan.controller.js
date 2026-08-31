const publicationService = require("./seputarJaminan.service");
const profileContactService = require("./profileContact.service");
const mediaService = require("./media.service");

function errorResponse(res, error) {
  return res.status(error.statusCode || 500).json({
    status: false,
    success: false,
    message: error.statusCode ? error.message : "Permintaan belum dapat diproses.",
  });
}

function action(service, message, statusCode = 200) {
  return async (req, res) => {
    try {
      const data = await service(req);
      return res.status(statusCode).json({ status: true, success: true, message, data });
    } catch (error) {
      return errorResponse(res, error);
    }
  };
}

exports.getDashboard = action(() => publicationService.getDashboard(), "Ringkasan berhasil dimuat.");
exports.getSyncSummary = action(() => publicationService.getSyncSummary(), "Status sinkronisasi berhasil dimuat.");
exports.getSettings = action(() => publicationService.getSettings(), "Pengaturan berhasil dimuat.");
exports.listTaxonomy = action(() => publicationService.listTaxonomy(), "Pilihan kategori berhasil dimuat.");
exports.updateSettings = action((req) => publicationService.updateSettings(req.body), "Pengaturan berhasil disimpan.");
exports.listPublications = action((req) => publicationService.listPublications(req.query), "Daftar katalog berhasil dimuat.");
exports.getPublication = action((req) => publicationService.getPublication(req.params.id), "Katalog berhasil dimuat.");
exports.createPublication = action((req) => publicationService.createPublication(req.body, req.user), "Draf katalog berhasil dibuat.", 201);
exports.updatePublication = action((req) => publicationService.updatePublicationDraft(req.params.id, req.body, req.user), "Draf katalog berhasil disimpan.");
exports.submitPublication = action((req) => publicationService.submitPublication(req.params.id, req.body, req.user), "Katalog berhasil diajukan untuk diperiksa.");
exports.requestPublicationRevision = action((req) => publicationService.requestRevision(req.params.id, req.body, req.user), "Katalog dikembalikan untuk diperbaiki.");
exports.approvePublication = action((req) => publicationService.approveAndPublish(req.params.id, req.body, req.user), "Katalog disetujui dan masuk antrean tayang.");
exports.unpublishPublication = action((req) => publicationService.unpublish(req.params.id, req.body, req.user), "Katalog masuk antrean untuk diturunkan.");
exports.reconfirmPublication = action((req) => publicationService.reconfirm(req.params.id, req.body, req.user), "Ketersediaan aset berhasil dikonfirmasi.");
exports.archivePublication = action((req) => publicationService.archive(req.params.id, req.body, req.user), "Katalog berhasil diarsipkan.");
exports.listEligibleCollaterals = action((req) => publicationService.listEligibleCollaterals(req.query), "Daftar agunan berhasil dimuat.");
exports.listReviews = action(() => publicationService.listReviews(), "Daftar pemeriksaan berhasil dimuat.");
exports.getSyncEvent = action((req) => publicationService.getSyncEvent(req.params.id), "Detail sinkronisasi berhasil dimuat.");
exports.retrySyncEvent = action((req) => publicationService.retrySyncEvent(req.params.id), "Sinkronisasi dijadwalkan ulang.");
exports.createReconciliation = action((req) => publicationService.createReconciliation(req.user), "Pemeriksaan kesesuaian data dijadwalkan.", 202);

exports.getProfile = action(() => profileContactService.getProfile(), "Profil BPRS berhasil dimuat.");
exports.saveProfile = action((req) => profileContactService.saveProfileDraft(req.body, req.user), "Draf profil BPRS berhasil disimpan.");
exports.submitProfile = action((req) => profileContactService.submitProfile(req.body, req.user), "Profil berhasil diajukan untuk diperiksa.");
exports.requestProfileRevision = action((req) => profileContactService.requestProfileRevision(req.body, req.user), "Profil dikembalikan untuk diperbaiki.");
exports.verifyProfile = action((req) => profileContactService.verifyProfile(req.body, req.user), "Profil disetujui dan masuk antrean sinkronisasi.");
exports.listContacts = action(() => profileContactService.listContacts(), "Kontak WhatsApp berhasil dimuat.");
exports.createContact = action((req) => profileContactService.createContact(req.body, req.user), "Kontak WhatsApp berhasil dibuat.", 201);
exports.updateContact = action((req) => profileContactService.updateContact(req.params.id, req.body, req.user), "Draf kontak WhatsApp berhasil disimpan.");
exports.submitContact = action((req) => profileContactService.submitContact(req.params.id, req.body, req.user), "Kontak WhatsApp berhasil diajukan.");
exports.requestContactRevision = action((req) => profileContactService.requestContactRevision(req.params.id, req.body, req.user), "Kontak dikembalikan untuk diperbaiki.");
exports.verifyContact = action((req) => profileContactService.verifyContact(req.params.id, req.body, req.user), "Kontak terverifikasi dan masuk antrean sinkronisasi.");
exports.revokeContact = action((req) => profileContactService.revokeContact(req.params.id, req.body, req.user), "Kontak masuk antrean pencabutan.");
exports.setDefaultContact = action((req) => profileContactService.setDefaultContact(req.params.id, req.body, req.user), "Kontak utama berhasil dipilih.");

exports.uploadMedia = action((req) => mediaService.upload({ file: req.file, purpose: req.body.purpose, user: req.user }), "Gambar berhasil disimpan dan menunggu sinkronisasi.", 201);
exports.listMedia = action((req) => mediaService.list(req.query), "Daftar gambar berhasil dimuat.");
exports.getMediaStatus = action((req) => mediaService.getStatus(req.params.id), "Status gambar berhasil dimuat.");
exports.revokeMedia = action((req) => mediaService.revoke(req.params.id, req.body), "Gambar berhasil dicabut.");
exports.getMediaContent = async (req, res) => {
  try {
    const { row, buffer } = await mediaService.getContent(req.params.id);
    res.set("Content-Type", row.detected_mime);
    res.set("Cache-Control", "private, max-age=60, no-transform");
    res.set("Content-Length", String(buffer.length));
    res.end(buffer);
    return undefined;
  } catch (error) {
    return errorResponse(res, error);
  }
};
