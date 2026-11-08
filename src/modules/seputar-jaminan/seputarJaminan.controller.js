const publicationService = require("./seputarJaminan.service");
const profileContactService = require("./profileContact.service");
const mediaService = require("./media.service");
const submissionService = require("./submission.service");
const changeRequestService = require("./changeRequest.service");
const { runWithDatabaseUserContext } = require("../../config/database-context");

function errorResponse(res, error) {
  return require('./requestError').requestError(res, error);
}

function action(service, message, statusCode = 200) {
  return async (req, res) => {
    try {
      // Middleware asynchronous seperti rate limiter dan parser multipart dapat
      // berpindah async boundary. Pasang ulang identitas pengguna tepat sebelum
      // service SJ menyentuh tabel ber-RLS agar konteks selalu deterministik.
      const data = req.user?.id
        ? await runWithDatabaseUserContext(req.user.id, () => service(req))
        : await service(req);
      return res.status(statusCode).json({ status: true, success: true, message, data });
    } catch (error) {
      return errorResponse(res, error);
    }
  };
}

exports.getDashboard = action(() => publicationService.getDashboard(), "Ringkasan berhasil dimuat.");
exports.saveOperation = kind => action(req => require('./saveOperation.service').execute(kind,req.params.id,req.body,req.user), 'Perubahan tersimpan.');
exports.readSaveOperation = action(req => require('./saveOperation.service').read(req.params.id,req.user), 'Hasil permintaan dimuat.');
exports.getSyncSummary = action(() => publicationService.getSyncSummary(), "Status sinkronisasi berhasil dimuat.");
exports.getSettings = action(() => publicationService.getSettings(), "Pengaturan berhasil dimuat.");
exports.listTaxonomy = action(() => publicationService.listTaxonomy(), "Pilihan kategori berhasil dimuat.");
exports.updateSettings = action((req) => publicationService.updateSettings(req.body), "Pengaturan berhasil disimpan.");
exports.listPublications = action((req) => publicationService.listPublications(req.query), "Daftar katalog berhasil dimuat.");
exports.getPublication = action((req) => publicationService.getPublication(req.params.id,req.query), "Katalog berhasil dimuat.");
exports.publicationHistory=action(req=>require('./history.service').read('publication',req.params.id,req.query),'Riwayat katalog berhasil dimuat.');
exports.profileHistory=action(req=>require('./history.service').read('profile',null,req.query),'Riwayat profil berhasil dimuat.');
exports.contactHistory=action(req=>require('./history.service').read('contact',req.params.id,req.query),'Riwayat kontak berhasil dimuat.');
exports.createPublication = action((req) => publicationService.createPublication(req.body, req.user), "Draf katalog berhasil dibuat.", 201);
exports.updatePublication = action((req) => publicationService.updatePublicationDraft(req.params.id, req.body, req.user), "Draf katalog berhasil disimpan.");
exports.submitPublication = action((req) => publicationService.submitPublication(req.params.id, req.body, req.user), "Katalog berhasil diajukan untuk diperiksa.");
exports.requestPublicationRevision = action((req) => publicationService.requestRevision(req.params.id, req.body, req.user), "Katalog dikembalikan untuk diperbaiki.");
exports.approvePublication = action((req) => publicationService.approveAndPublish(req.params.id, req.body, req.user), "Katalog disetujui dan masuk antrean pengiriman.");
exports.unpublishPublication = action((req) => publicationService.unpublish(req.params.id, req.body, req.user), "Katalog masuk antrean untuk diturunkan.");
exports.reconfirmPublication = action((req) => publicationService.reconfirm(req.params.id, req.body, req.user), "Ketersediaan aset berhasil dikonfirmasi.");
exports.archivePublication = action((req) => publicationService.archive(req.params.id, req.body, req.user), "Katalog berhasil diarsipkan.");
exports.listEligibleCollaterals = action((req) => publicationService.listEligibleCollaterals(req.query), "Daftar agunan berhasil dimuat.");
exports.listReviews = action(req => publicationService.listReviews(req.query), "Daftar pemeriksaan berhasil dimuat.");
exports.listSubmissions = action(
  (req) => submissionService.listSubmissions(req.query),
  "Daftar pengajuan berhasil dimuat.",
);
exports.listChangeRequests = action(
  (req) => changeRequestService.listRequests(req.query),
  "Daftar permintaan perubahan berhasil dimuat.",
);
exports.createPublicationChangeRequest = action(
  (req) => changeRequestService.createPublicationRequest(req.params.id, req.body, req.user),
  "Permintaan publikasi berhasil dikirim ke Control.",
  201,
);
exports.createProfileRemovalRequest = action(
  (req) => changeRequestService.createProfileRemovalRequest(req.body, req.user),
  "Permintaan penghapusan profil berhasil dikirim ke Control.",
  201,
);
exports.createContactRemovalRequest = action(
  (req) => changeRequestService.createContactRemovalRequest(req.params.id, req.body, req.user),
  "Permintaan pencabutan kontak berhasil dikirim ke Control.",
  201,
);
exports.createMediaRemovalRequest = action(
  (req) => changeRequestService.createMediaRemovalRequest(req.params.id, req.body, req.user),
  "Permintaan penghapusan gambar berhasil dikirim ke Control.",
  201,
);
exports.resubmitChangeRequest = action(
  (req) => changeRequestService.resubmitRequest(req.params.id, req.body, req.user),
  "Permintaan perubahan berhasil diajukan ulang.",
);
exports.getSyncEvent = action((req) => publicationService.getSyncEvent(req.params.id), "Detail sinkronisasi berhasil dimuat.");
exports.listSyncEvents = action(req => publicationService.listSyncEvents(req.query), "Daftar pengiriman dimuat.");
exports.getLatestReconciliation = action(() => publicationService.getLatestReconciliation(), "Hasil pemeriksaan dimuat.");
exports.retrySyncEvent = action((req) => publicationService.retrySyncEvent(req.params.id), "Sinkronisasi dijadwalkan ulang.");
exports.createReconciliation = action((req) => publicationService.createReconciliation(req.user), "Pemeriksaan kesesuaian data dijadwalkan.", 202);

exports.getProfile = action(() => profileContactService.getProfile(), "Profil BPRS berhasil dimuat.");
exports.readPublicationObservation = action(req => require('./publicObservation.service').read('PUBLICATION',req.params.id), 'Hasil pemeriksaan dimuat.');
exports.checkPublicationObservation = action(req => require('./publicObservation.service').check('PUBLICATION',req.params.id), 'Pemeriksaan selesai; lihat hasil pemeriksaan.');
exports.readProfileObservation = action(() => require('./publicObservation.service').read('PROFILE'), 'Hasil pemeriksaan dimuat.');
exports.checkProfileObservation = action(() => require('./publicObservation.service').check('PROFILE'), 'Pemeriksaan selesai; lihat hasil pemeriksaan.');
exports.saveProfile = action((req) => profileContactService.saveProfileDraft(req.body, req.user), "Draf profil BPRS berhasil disimpan.");
exports.submitProfile = action((req) => profileContactService.submitProfile(req.body, req.user), "Profil berhasil diajukan untuk diperiksa.");
exports.requestProfileRevision = action((req) => profileContactService.requestProfileRevision(req.body, req.user), "Profil dikembalikan untuk diperbaiki.");
exports.verifyProfile = action((req) => profileContactService.verifyProfile(req.body, req.user), "Profil disetujui dan masuk antrean sinkronisasi.");
exports.listContacts = action(req => profileContactService.listContacts(req.query), "Kontak WhatsApp berhasil dimuat.");
exports.getContact = action(req => profileContactService.getContact(req.params.id), "Kontak WhatsApp berhasil dimuat.");
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
    const { mime, buffer } = await mediaService.getContent(req.params.id, req.query.variant);
    res.set("Content-Type", mime);
    res.set("Cache-Control", "private, no-store, no-transform");
    res.set("Content-Length", String(buffer.length));
    res.end(buffer);
    return undefined;
  } catch (error) {
    return errorResponse(res, error);
  }
};
