const Joi = require("joi");

const uuid = Joi.string().guid({ version: ["uuidv4"] });
const expectedVersion = Joi.number().integer().min(0).required();
const controlledCode = Joi.string().pattern(/^[A-Z][A-Z0-9_]*$/);
const publicText = (min, max) => Joi.string().trim().min(min).max(max);
const publicCondition = Joi.string().valid(
  "SANGAT_BAIK",
  "BAIK",
  "CUKUP",
  "PERLU_PERBAIKAN",
);

const mediaLinkSchema = Joi.object({
  media_asset_id: uuid.required(),
  sort_order: Joi.number().integer().min(0).max(9).required(),
  is_cover: Joi.boolean().required(),
  alt_text: publicText(3, 240).required(),
});

const attributesSchema = Joi.object({
  land_area_m2: Joi.number().positive(),
  contour: Joi.string().valid("DATAR", "MIRING", "BERKONTUR"),
  road_access: Joi.string().valid("RODA_DUA", "MOBIL", "TRUK"),
  building_area_m2: Joi.number().positive(),
  floor_count: Joi.number().integer().min(1).max(200),
  public_usage: Joi.string().valid(
    "HUNIAN",
    "KOMERSIAL",
    "PERKANTORAN",
    "PERGUDANGAN",
    "INDUSTRI",
    "SERBAGUNA",
  ),
  brand_or_manufacturer: publicText(1, 160),
  brand: publicText(1, 160),
  model_or_type: publicText(1, 160),
  manufacture_year: Joi.number().integer().min(1900).max(2200),
  public_capacity: publicText(1, 160),
  transmission: Joi.string().valid("MANUAL", "OTOMATIS"),
  fuel_type: Joi.string().valid("BENSIN", "DIESEL", "LISTRIK", "HIBRIDA", "GAS"),
  mileage_km: Joi.number().min(0),
  public_condition: publicCondition,
}).required();

const publicationDraftFields = {
  taxonomy_item_id: uuid.required(),
  title: publicText(5, 160).required(),
  description: publicText(20, 5000).required(),
  city_regency: publicText(2, 120).required(),
  province: publicText(2, 120).required(),
  whatsapp_contact_version_id: uuid.required(),
  profile_version_id: uuid.required(),
  attributes: attributesSchema,
  media: Joi.array().items(mediaLinkSchema).min(1).max(10).unique("sort_order").required(),
};

const createPublicationSchema = Joi.object({
  source_type: Joi.string().valid("COLLATERAL", "MANUAL").required(),
  source_collateral_id: uuid.when("source_type", {
    is: "COLLATERAL",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  manual_reason: publicText(10, 500).when("source_type", {
    is: "MANUAL",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  manual_evidence_document_id: uuid.when("source_type", {
    is: "MANUAL",
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  owner_division_id: uuid,
  asset_category: Joi.string()
    .valid("LAND", "BUILDING", "MACHINE_EQUIPMENT", "VEHICLE")
    .required(),
  ...publicationDraftFields,
});

const updatePublicationDraftSchema = Joi.object({
  expected_version: expectedVersion,
  asset_category: Joi.string().valid(
    "LAND",
    "BUILDING",
    "MACHINE_EQUIPMENT",
    "VEHICLE",
  ),
  ...Object.fromEntries(
    Object.entries(publicationDraftFields).map(([key, schema]) => [
      key,
      schema.optional(),
    ]),
  ),
}).min(2);

const versionCommandSchema = Joi.object({ expected_version: expectedVersion });
const reasonCommandSchema = Joi.object({
  expected_version: expectedVersion,
  reason: publicText(5, 500).required(),
});
const reasonCodeCommandSchema = Joi.object({
  expected_version: expectedVersion,
  reason_code: controlledCode.required(),
});
const mediaRevokeSchema = Joi.object({
  reason_code: controlledCode.required(),
});

const integrationSettingsSchema = Joi.object({
  institution_id: uuid,
  installation_id: uuid,
  key_id: uuid,
  central_base_url: Joi.string().uri({ scheme: ["http", "https"] }).max(500),
  contract_version: Joi.number().integer().valid(1),
  taxonomy_version: Joi.number().integer().valid(1),
  module_visible: Joi.boolean(),
  draft_enabled: Joi.boolean(),
  review_enabled: Joi.boolean(),
  sync_enabled: Joi.boolean(),
  publish_enabled: Joi.boolean(),
  filesystem_upload_enabled: Joi.boolean(),
  s3_upload_enabled: Joi.boolean(),
}).min(1);

const profileDraftSchema = Joi.object({
  expected_version: expectedVersion.optional(),
  display_name: publicText(3, 160).required(),
  public_slug: Joi.string().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120).required(),
  city_regency: publicText(2, 120).required(),
  province: publicText(2, 120).required(),
  short_description: publicText(20, 500).required(),
  logo_media_id: uuid.required(),
  website_url: Joi.string().uri({ scheme: ["https"] }).max(500).allow(null),
});

const profileCommandSchema = Joi.object({
  expected_version: expectedVersion,
});

const contactDraftSchema = Joi.object({
  label: publicText(2, 80).required(),
  phone_e164: Joi.string().pattern(/^\+[1-9][0-9]{7,14}$/).required(),
  is_default: Joi.forbidden().messages({
    "any.unknown": "Kontak baru harus diverifikasi sebelum dapat dijadikan kontak utama.",
  }),
});

const contactUpdateSchema = Joi.object({
  expected_version: expectedVersion,
  label: publicText(2, 80),
  phone_e164: Joi.string().pattern(/^\+[1-9][0-9]{7,14}$/),
}).min(2);

const listQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  state: Joi.string().valid(
    "DRAFT",
    "IN_REVIEW",
    "REVISION_REQUIRED",
    "APPROVED",
    "PUBLISHED",
    "UNPUBLISHED",
    "ARCHIVED",
  ),
  category: Joi.string().valid("LAND", "BUILDING", "MACHINE_EQUIPMENT", "VEHICLE"),
  search: Joi.string().trim().max(120),
});

module.exports = {
  contactDraftSchema,
  contactUpdateSchema,
  createPublicationSchema,
  integrationSettingsSchema,
  listQuerySchema,
  mediaRevokeSchema,
  profileCommandSchema,
  profileDraftSchema,
  reasonCodeCommandSchema,
  reasonCommandSchema,
  updatePublicationDraftSchema,
  versionCommandSchema,
};
