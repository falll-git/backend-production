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
const SUMMARY = `${ROOT}/ringkasan`;
const PROFILE = `${ROOT}/profil`;
const CONTACTS = `${ROOT}/kontak`;
const PUBLICATIONS = `${ROOT}/publikasi`;
const SUBMISSIONS = `${ROOT}/pengajuan`;
const submissionFeature = (name) =>
  authorize(SUBMISSIONS, "update", { feature: name });

router.use(auth);
router.param('id', (req,res,next) => validate(validation.idParamsSchema,{source:'params',stripUnknown:false})(req,res,next));

router.get('/save-operations/:id', authorize([PROFILE,CONTACTS,PUBLICATIONS],'read'), controller.readSaveOperation);
for (const [kind, segment, menu] of [['PROFILE','profile',PROFILE],['CONTACT','contacts',CONTACTS],['PUBLICATION','publications',PUBLICATIONS]]) {
  router.post(`/${segment}/save-operations/:id`,
    authorize(menu,'read'),
    validate(validation.saveOperationSchema(kind),{stripUnknown:false}),
    (req,res,next) => authorize(menu,kind === 'PROFILE' || req.body.resource_id ? 'update' : 'create')(req,res,next),
    (req,res,next) => req.body.intent === 'SAVE_AND_SUBMIT' ? authorize(menu,'update')(req,res,next) : next(),
    controller.saveOperation(kind));
}

router.get("/dashboard", authorize(SUMMARY, "read"), controller.getDashboard);
router.get("/sync-summary", authorize(SUMMARY, "read"), controller.getSyncSummary);
router.get(
  "/settings",
  authorize([SUMMARY, PROFILE, CONTACTS, PUBLICATIONS, SUBMISSIONS], "read"),
  controller.getSettings,
);
router.get("/taxonomy", authorize(PUBLICATIONS, "read"), controller.listTaxonomy);
router.patch("/settings", authorize(SUMMARY, "update"), validate(validation.integrationSettingsSchema), controller.updateSettings);

router.get(
  "/eligible-collaterals",
  authorize(PUBLICATIONS, "read"),
  validate(validation.eligibleListQuerySchema, { source: "query", stripUnknown:false }),
  controller.listEligibleCollaterals,
);
router.get("/publications", authorize(PUBLICATIONS, "read"), validate(validation.listQuerySchema, { source: "query", stripUnknown:false }), controller.listPublications);
router.post("/publications", authorize(PUBLICATIONS, "create"), validate(validation.createPublicationSchema), controller.createPublication);
router.get("/publications/:id", authorize(PUBLICATIONS, "read"), validate(validation.publicationDetailQuerySchema,{source:'query',stripUnknown:false}), controller.getPublication);
router.get('/publications/:id/history',authorize(PUBLICATIONS,'read'),validate(validation.historyQuerySchema,{source:'query',stripUnknown:false}),controller.publicationHistory);
router.get('/publications/:id/public-observation', authorize(PUBLICATIONS,'read'), controller.readPublicationObservation);
router.post('/publications/:id/public-observation', authorize(PUBLICATIONS,'update'), reportRateLimit, controller.checkPublicationObservation);
router.patch("/publications/:id/draft", authorize(PUBLICATIONS, "update"), validate(validation.updatePublicationDraftSchema), controller.updatePublication);
router.post("/publications/:id/submit", authorize(PUBLICATIONS, "update"), validate(validation.versionCommandSchema), controller.submitPublication);
router.post("/publications/:id/request-revision", submissionFeature(SJ_REVIEW_FEATURE), validate(validation.reasonCommandSchema), controller.requestPublicationRevision);
router.post("/publications/:id/approve-and-publish", submissionFeature(SJ_PUBLISH_FEATURE), validate(validation.versionCommandSchema), controller.approvePublication);
router.post("/publications/:id/unpublish", submissionFeature(SJ_UNPUBLISH_FEATURE), validate(validation.reasonCodeCommandSchema), controller.unpublishPublication);
router.post("/publications/:id/reconfirm", authorize(SUMMARY, "update", { feature: SJ_RECONFIRM_FEATURE }), validate(validation.versionCommandSchema), controller.reconfirmPublication);
router.post("/publications/:id/archive", submissionFeature(SJ_ARCHIVE_FEATURE), validate(validation.versionCommandSchema), controller.archivePublication);
router.post("/publications/:id/change-requests", authorize(PUBLICATIONS, "update"), validate(validation.publicationChangeRequestSchema), controller.createPublicationChangeRequest);

router.get("/profile", authorize(PROFILE, "read"), controller.getProfile);
router.get('/profile/history',authorize(PROFILE,'read'),validate(validation.historyQuerySchema,{source:'query',stripUnknown:false}),controller.profileHistory);
router.get('/profile/public-observation', authorize(PROFILE,'read'), controller.readProfileObservation);
router.post('/profile/public-observation', authorize(PROFILE,'update'), reportRateLimit, controller.checkProfileObservation);
router.patch("/profile/draft", authorize(PROFILE, "update"), validate(validation.profileDraftSchema), controller.saveProfile);
router.post("/profile/submit", authorize(PROFILE, "update"), validate(validation.profileCommandSchema), controller.submitProfile);
router.post("/profile/request-revision", submissionFeature(SJ_PROFILE_VERIFY_FEATURE), validate(validation.reasonCommandSchema), controller.requestProfileRevision);
router.post("/profile/verify", submissionFeature(SJ_PROFILE_VERIFY_FEATURE), validate(validation.profileCommandSchema), controller.verifyProfile);
router.post("/profile/change-requests", authorize(PROFILE, "update"), validate(validation.resourceChangeRequestSchema), controller.createProfileRemovalRequest);

router.get("/contacts", authorize(CONTACTS, "read"), validate(validation.contactListQuerySchema,{source:'query',stripUnknown:false}), controller.listContacts);
router.get("/contacts/:id", authorize(CONTACTS, "read"), controller.getContact);
router.get('/contacts/:id/history',authorize(CONTACTS,'read'),validate(validation.historyQuerySchema,{source:'query',stripUnknown:false}),controller.contactHistory);
router.post("/contacts", authorize(CONTACTS, "create"), validate(validation.contactDraftSchema), controller.createContact);
router.patch("/contacts/:id/draft", authorize(CONTACTS, "update"), validate(validation.contactUpdateSchema), controller.updateContact);
router.post("/contacts/:id/submit", authorize(CONTACTS, "update"), validate(validation.versionCommandSchema), controller.submitContact);
router.post("/contacts/:id/request-revision", submissionFeature(SJ_CONTACT_VERIFY_FEATURE), validate(validation.reasonCommandSchema), controller.requestContactRevision);
router.post("/contacts/:id/verify", submissionFeature(SJ_CONTACT_VERIFY_FEATURE), validate(validation.versionCommandSchema), controller.verifyContact);
router.post("/contacts/:id/revoke", submissionFeature(SJ_CONTACT_VERIFY_FEATURE), validate(validation.reasonCodeCommandSchema), controller.revokeContact);
router.post("/contacts/:id/set-default", authorize(CONTACTS, "update"), validate(validation.versionCommandSchema), controller.setDefaultContact);
router.post("/contacts/:id/change-requests", authorize(CONTACTS, "update"), validate(validation.resourceChangeRequestSchema), controller.createContactRemovalRequest);

router.get("/media", authorize([PROFILE, PUBLICATIONS], "read"), validate(validation.mediaListQuerySchema,{source:'query',stripUnknown:false}), controller.listMedia);
router.post("/media", authorize([PROFILE, PUBLICATIONS], "create"), uploadRateLimit, uploadPublicImage, controller.uploadMedia);
router.get("/media/:id/status", authorize([PROFILE, PUBLICATIONS], "read"), controller.getMediaStatus);
router.get("/media/:id/content", authorize([PROFILE, PUBLICATIONS], "read"), controller.getMediaContent);
router.delete("/media/:id", authorize(PUBLICATIONS, "update"), validate(validation.mediaRevokeSchema), controller.revokeMedia);
router.post("/media/:id/change-requests", authorize([PROFILE, PUBLICATIONS], "update"), validate(validation.mediaChangeRequestSchema), controller.createMediaRemovalRequest);

router.get("/reviews", authorize(SUBMISSIONS, "read"), validate(validation.reviewListQuerySchema,{source:'query',stripUnknown:false}), controller.listReviews);
router.get(
  "/submissions",
  authorize(SUBMISSIONS, "read"),
  validate(validation.submissionListQuerySchema, { source: "query", stripUnknown:false }),
  controller.listSubmissions,
);
router.get("/change-requests", authorize(SUBMISSIONS, "read"), validate(validation.changeRequestListQuerySchema, { source: "query", stripUnknown:false }), controller.listChangeRequests);
router.post("/change-requests/:id/resubmit", authorize(SUBMISSIONS, "update"), validate(validation.resubmitChangeRequestSchema), controller.resubmitChangeRequest);
router.get("/sync-events/:id", authorize(SUMMARY, "read"), controller.getSyncEvent);
router.get("/sync-events", authorize(SUMMARY, "read"), validate(validation.syncEventListQuerySchema, {source:'query',stripUnknown:false}), controller.listSyncEvents);
router.get("/reconciliation/latest", authorize(SUMMARY, "read"), controller.getLatestReconciliation);
router.post("/sync-events/:id/retry", authorize(SUMMARY, "update", { feature: SJ_SYNC_RETRY_FEATURE }), controller.retrySyncEvent);
router.post("/reconciliation", authorize(SUMMARY, "update", { feature: SJ_SYNC_RETRY_FEATURE }), reportRateLimit, controller.createReconciliation);

module.exports = router;
