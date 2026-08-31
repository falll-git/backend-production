const express = require("express");

const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const { uploadRateLimit, reportRateLimit } = require("../../middlewares/rate-limit.middleware");
const { uploadPublicImage } = require("../../middlewares/seputar-jaminan-media.middleware");
const {
  SJ_ARCHIVE_FEATURE,
  SJ_CONTACT_VERIFY_FEATURE,
  SJ_PROFILE_VERIFY_FEATURE,
  SJ_PUBLISH_FEATURE,
  SJ_RECONFIRM_FEATURE,
  SJ_REVIEW_FEATURE,
  SJ_SYNC_RETRY_FEATURE,
  SJ_UNPUBLISH_FEATURE,
} = require("../../utils/menu-access");
const controller = require("./seputarJaminan.controller");
const validation = require("./seputarJaminan.validation");

const router = express.Router();
const ROOT = "/dashboard/seputar-jaminan";
const CATALOG = `${ROOT}/katalog`;
const REVIEW = `${ROOT}/pemeriksaan`;
const PROFILE = `${ROOT}/profil-kontak`;
const feature = (name) => authorize(ROOT, "update", { feature: name });

router.use(auth);

router.get("/dashboard", authorize(ROOT, "read"), controller.getDashboard);
router.get("/sync-summary", authorize(ROOT, "read"), controller.getSyncSummary);
router.get("/settings", authorize(ROOT, "read"), controller.getSettings);
router.get("/taxonomy", authorize(ROOT, "read"), controller.listTaxonomy);
router.patch("/settings", authorize(ROOT, "update"), validate(validation.integrationSettingsSchema), controller.updateSettings);

router.get(
  "/eligible-collaterals",
  authorize(CATALOG, "read"),
  validate(validation.listQuerySchema, { source: "query" }),
  controller.listEligibleCollaterals,
);
router.get("/publications", authorize(CATALOG, "read"), validate(validation.listQuerySchema, { source: "query" }), controller.listPublications);
router.post("/publications", authorize(CATALOG, "create"), validate(validation.createPublicationSchema), controller.createPublication);
router.get("/publications/:id", authorize(CATALOG, "read"), controller.getPublication);
router.patch("/publications/:id/draft", authorize(CATALOG, "update"), validate(validation.updatePublicationDraftSchema), controller.updatePublication);
router.post("/publications/:id/submit", authorize(CATALOG, "update"), validate(validation.versionCommandSchema), controller.submitPublication);
router.post("/publications/:id/request-revision", feature(SJ_REVIEW_FEATURE), validate(validation.reasonCommandSchema), controller.requestPublicationRevision);
router.post("/publications/:id/approve-and-publish", feature(SJ_PUBLISH_FEATURE), validate(validation.versionCommandSchema), controller.approvePublication);
router.post("/publications/:id/unpublish", feature(SJ_UNPUBLISH_FEATURE), validate(validation.reasonCodeCommandSchema), controller.unpublishPublication);
router.post("/publications/:id/reconfirm", feature(SJ_RECONFIRM_FEATURE), validate(validation.versionCommandSchema), controller.reconfirmPublication);
router.post("/publications/:id/archive", feature(SJ_ARCHIVE_FEATURE), validate(validation.versionCommandSchema), controller.archivePublication);

router.get("/profile", authorize(PROFILE, "read"), controller.getProfile);
router.patch("/profile/draft", authorize(PROFILE, "update"), validate(validation.profileDraftSchema), controller.saveProfile);
router.post("/profile/submit", authorize(PROFILE, "update"), validate(validation.profileCommandSchema), controller.submitProfile);
router.post("/profile/request-revision", feature(SJ_PROFILE_VERIFY_FEATURE), validate(validation.reasonCommandSchema), controller.requestProfileRevision);
router.post("/profile/verify", feature(SJ_PROFILE_VERIFY_FEATURE), validate(validation.profileCommandSchema), controller.verifyProfile);

router.get("/contacts", authorize(PROFILE, "read"), controller.listContacts);
router.post("/contacts", authorize(PROFILE, "create"), validate(validation.contactDraftSchema), controller.createContact);
router.patch("/contacts/:id/draft", authorize(PROFILE, "update"), validate(validation.contactUpdateSchema), controller.updateContact);
router.post("/contacts/:id/submit", authorize(PROFILE, "update"), validate(validation.versionCommandSchema), controller.submitContact);
router.post("/contacts/:id/request-revision", feature(SJ_CONTACT_VERIFY_FEATURE), validate(validation.reasonCommandSchema), controller.requestContactRevision);
router.post("/contacts/:id/verify", feature(SJ_CONTACT_VERIFY_FEATURE), validate(validation.versionCommandSchema), controller.verifyContact);
router.post("/contacts/:id/revoke", feature(SJ_CONTACT_VERIFY_FEATURE), validate(validation.reasonCodeCommandSchema), controller.revokeContact);
router.post("/contacts/:id/set-default", authorize(PROFILE, "update"), validate(validation.versionCommandSchema), controller.setDefaultContact);

router.get("/media", authorize(PROFILE, "read"), controller.listMedia);
router.post("/media", authorize([CATALOG, PROFILE], "create"), uploadRateLimit, uploadPublicImage, controller.uploadMedia);
router.get("/media/:id/status", authorize(CATALOG, "read"), controller.getMediaStatus);
router.get("/media/:id/content", authorize([CATALOG, PROFILE], "read"), controller.getMediaContent);
router.delete("/media/:id", authorize(CATALOG, "delete"), validate(validation.mediaRevokeSchema), controller.revokeMedia);

router.get("/reviews", authorize(REVIEW, "read"), controller.listReviews);
router.get("/sync-events/:id", authorize(ROOT, "read"), controller.getSyncEvent);
router.post("/sync-events/:id/retry", feature(SJ_SYNC_RETRY_FEATURE), controller.retrySyncEvent);
router.post("/reconciliation", feature(SJ_SYNC_RETRY_FEATURE), reportRateLimit, controller.createReconciliation);

module.exports = router;
