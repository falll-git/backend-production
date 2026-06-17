const Joi = require("joi");

const uuid = Joi.string().uuid();
const optionalUuid = uuid.allow(null, "");
const fileSchema = Joi.object({
  buffer: Joi.any().required(),
  name: Joi.string().trim().required(),
  mime_type: Joi.string().trim().required(),
  size_bytes: Joi.number().integer().optional(),
}).unknown(true);
const filesSchema = Joi.array().items(fileSchema).min(1).max(20);

const optionalText = Joi.string().trim().allow("", null).optional();
const optionalDate = Joi.date().iso().allow("", null).optional();

const individualProfileSchema = Joi.object({
  identity_type_code: optionalText,
  name_as_identity: optionalText,
  full_name: optionalText,
  education_degree_code: optionalText,
  gender: optionalText,
  birth_place: optionalText,
  birth_date: optionalDate,
  tax_number: optionalText,
  address_detail: optionalText,
  village: optionalText,
  district: optionalText,
  city_code: optionalText,
  postal_code: optionalText,
  phone: optionalText,
  mobile_phone: optionalText,
  email: optionalText,
  domicile_country_code: optionalText,
  occupation_code: optionalText,
  workplace: optionalText,
  workplace_business_field_code: optionalText,
  workplace_address: optionalText,
  annual_gross_income: Joi.number().min(0).allow("", null).optional(),
  income_source_code: optionalText,
  dependent_count: Joi.number().integer().min(0).allow("", null).optional(),
  relationship_with_reporter_code: optionalText,
  debtor_group_code: optionalText,
  marital_status_code: optionalText,
  spouse_identity_number: optionalText,
  spouse_name: optionalText,
  spouse_birth_date: optionalDate,
  separate_assets_agreement: optionalText,
  violates_bmpk: optionalText,
  exceeds_bmpk: optionalText,
  mother_maiden_name: optionalText,
  branch_code: optionalText,
  operation_code: optionalText,
  status_code: Joi.string().trim().valid("I").allow("", null).optional(),
}).optional();

const legalEntityProfileSchema = Joi.object({
  business_identity_number: optionalText,
  business_name: optionalText,
  legal_form_code: optionalText,
  establishment_place: optionalText,
  establishment_deed_number: optionalText,
  establishment_deed_date: optionalDate,
  latest_amendment_deed_number: optionalText,
  latest_amendment_deed_date: optionalDate,
  phone: optionalText,
  mobile_phone: optionalText,
  email: optionalText,
  address_detail: optionalText,
  village: optionalText,
  district: optionalText,
  city_code: optionalText,
  postal_code: optionalText,
  domicile_country_code: optionalText,
  business_field_code: optionalText,
  relationship_with_reporter_code: optionalText,
  violates_bmpk: optionalText,
  exceeds_bmpk: optionalText,
  go_public: optionalText,
  debtor_group_code: optionalText,
  rating: optionalText,
  rating_agency: optionalText,
  rating_date: optionalDate,
  debtor_group_name: optionalText,
  branch_code: optionalText,
  operation_code: optionalText,
  status_code: Joi.string().trim().valid("B").allow("", null).optional(),
}).optional();

const debtorPayload = {
  debtor_number: Joi.string().trim().max(100).allow("", null).optional(),
  identity_number: Joi.string().trim().max(100).allow("", null).optional(),
  name: Joi.string().trim().min(2).max(255).required(),
  address: Joi.string().trim().allow("", null).optional(),
  phone: Joi.string().trim().allow("", null).optional(),
  branch_id: optionalUuid.optional(),
  marketing_user_id: optionalUuid.optional(),
  financing_number: Joi.string().trim().max(100).allow("", null).optional(),
  customer_type: Joi.string()
    .trim()
    .valid("INDIVIDUAL", "LEGAL_ENTITY", "I", "B", "PERORANGAN", "BADAN_HUKUM")
    .allow("", null)
    .optional(),
  slik_segment: Joi.string().trim().valid("D01", "D02").allow("", null).optional(),
  slik_status_code: Joi.string().trim().valid("I", "B").allow("", null).optional(),
  slik_operation_code: optionalText,
  individual_profile: individualProfileSchema,
  legal_entity_profile: legalEntityProfileSchema,
  status: Joi.string().trim().max(50).default("ACTIVE"),
  description: Joi.string().trim().allow("", null).optional(),
};

exports.createDebtorSchema = Joi.object(debtorPayload);
exports.updateDebtorSchema = Joi.object(
  Object.fromEntries(
    Object.entries(debtorPayload).map(([field, schema]) => [
      field,
      schema.optional(),
    ]),
  ),
)
  .prefs({ noDefaults: true })
  .min(1)
  .messages({ "object.min": "Tidak ada data yang diperbarui." });

exports.createDebtorDocumentSchema = Joi.object({
  contract_id: optionalUuid.optional(),
  document_checklist_id: optionalUuid.optional(),
  document_type: Joi.string().trim().min(1).max(100).required(),
  category: Joi.string().valid("AWAL", "LAINNYA").default("LAINNYA"),
  description: Joi.string().trim().allow("", null).optional(),
  file: fileSchema.optional(),
  files: filesSchema.optional(),
}).or("file", "files");
