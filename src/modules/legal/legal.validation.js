const Joi = require("joi");

const uuid = Joi.string().uuid();
const optionalUuid = uuid.allow("", null);
const amount = Joi.number().min(0).precision(2);
const positiveAmount = Joi.number().greater(0).precision(2);
const fileSchema = Joi.object({
  buffer: Joi.any().required(),
  name: Joi.string().trim().required(),
  mime_type: Joi.string().trim().required(),
  size_bytes: Joi.number().integer().optional(),
}).unknown(true);
const filesSchema = Joi.array().items(fileSchema).min(1).max(20);
const depositType = Joi.string().valid("NOTARIS", "ASURANSI", "ANGSURAN", "LAINNYA");
const depositTransactionAction = Joi.string().valid("TITIPAN", "PEMBAYARAN", "REFUND");

exports.templateSchema = Joi.object({
  template_type: Joi.string()
    .valid("AKAD", "HAFTSHEET", "SURAT_PERINGATAN", "SURAT_PENGANTAR", "SKL", "SAMSAT", "DOKUMEN_LAINNYA")
    .required(),
  version: Joi.number().integer().min(1).default(1),
  title: Joi.string().trim().min(1).max(255).required(),
  content_template: Joi.string().trim().allow("", null).optional(),
  is_active: Joi.boolean().default(true),
  file: fileSchema.optional(),
  files: filesSchema.optional(),
});

exports.printDocumentSchema = Joi.object({
  template_id: uuid.required(),
  numbering_template_id: optionalUuid.optional(),
  contract_id: uuid.required(),
  collateral_id: optionalUuid.optional(),
  document_type: Joi.string()
    .valid("AKAD", "HAFTSHEET", "SURAT_PERINGATAN", "SURAT_PENGANTAR", "SKL", "SAMSAT", "DOKUMEN_LAINNYA")
    .required(),
  payload_snapshot: Joi.object().optional(),
  generated_number: Joi.any().strip(),
  file: fileSchema.optional(),
  files: filesSchema.optional(),
});

exports.printDocumentContextQuerySchema = Joi.object({
  contract_id: uuid.required(),
  document_type: Joi.string()
    .valid("AKAD", "HAFTSHEET", "SURAT_PERINGATAN", "SURAT_PENGANTAR", "SKL", "SAMSAT", "DOKUMEN_LAINNYA")
    .required(),
  collateral_id: optionalUuid.optional(),
});

exports.notaryProgressSchema = Joi.object({
  contract_id: uuid.required(),
  collateral_id: optionalUuid.optional(),
  third_party_id: uuid.required(),
  deed_type: Joi.string().trim().min(1).max(100).required(),
  received_at: Joi.date().required(),
  estimated_completed_at: Joi.date().allow(null).optional(),
  completed_at: Joi.date().allow(null).optional(),
  status: Joi.string().valid("PROSES", "SELESAI", "BERMASALAH").default("PROSES"),
  deed_number: Joi.string().trim().allow("", null).optional(),
  notes: Joi.string().trim().allow("", null).optional(),
  file: fileSchema.optional(),
  files: filesSchema.optional(),
});

exports.insuranceProgressSchema = Joi.object({
  contract_id: uuid.required(),
  collateral_id: optionalUuid.optional(),
  third_party_id: uuid.required(),
  insurance_type: Joi.string().trim().min(1).max(100).required(),
  coverage_amount: amount.default(0),
  premium_amount: amount.default(0),
  period_start: Joi.date().required(),
  period_end: Joi.date().allow(null).optional(),
  policy_number: Joi.string().trim().allow("", null).optional(),
  status: Joi.string().valid("AKTIF", "EXPIRED", "KLAIM").default("AKTIF"),
  notes: Joi.string().trim().allow("", null).optional(),
  file: fileSchema.optional(),
  files: filesSchema.optional(),
});

exports.kjppProgressSchema = Joi.object({
  contract_id: uuid.required(),
  collateral_id: optionalUuid.optional(),
  third_party_id: uuid.required(),
  appraisal_type: Joi.string().trim().min(1).max(100).required(),
  received_at: Joi.date().required(),
  estimated_completed_at: Joi.date().allow(null).optional(),
  completed_at: Joi.date().allow(null).optional(),
  status: Joi.string().valid("PROSES", "SELESAI", "BERMASALAH").default("PROSES"),
  report_number: Joi.string().trim().allow("", null).optional(),
  collateral_object: Joi.string().trim().allow("", null).optional(),
  appraisal_value: amount.allow(null).optional(),
  notes: Joi.string().trim().allow("", null).optional(),
  file: fileSchema.optional(),
  files: filesSchema.optional(),
});

exports.claimSchema = Joi.object({
  contract_id: uuid.required(),
  collateral_id: optionalUuid.optional(),
  insurance_progress_id: optionalUuid.optional(),
  policy_number: Joi.string().trim().allow("", null).optional(),
  claim_type: Joi.string().trim().min(1).max(100).required(),
  claim_amount: amount.default(0),
  submitted_at: Joi.date().required(),
  status: Joi.string()
    .valid("PENGAJUAN", "VERIFIKASI", "DISETUJUI", "DITOLAK", "CAIR")
    .default("PENGAJUAN"),
  approved_amount: amount.allow(null).optional(),
  disbursed_amount: amount.allow(null).optional(),
  disbursed_at: Joi.date().allow(null).optional(),
  rejection_reason: Joi.string().trim().allow("", null).optional(),
  notes: Joi.string().trim().allow("", null).optional(),
  file: fileSchema.optional(),
  files: filesSchema.optional(),
});

exports.depositSchema = Joi.object({
  deposit_type_id: optionalUuid.optional(),
  type: depositType.required(),
  contract_id: uuid.required(),
  third_party_id: optionalUuid.optional(),
  nominal: amount.optional(),
  paid_amount: amount.optional(),
  processed_amount: amount.optional(),
  remaining_amount: amount.allow(null).optional(),
  status: Joi.string().trim().max(50).default("PENDING"),
  notes: Joi.string().trim().allow("", null).optional(),
  opening_transaction: Joi.object({
    transaction_date: Joi.date().required(),
    action: depositTransactionAction.default("TITIPAN"),
    amount: positiveAmount.required(),
    notes: Joi.string().trim().allow("", null).optional(),
  }).optional(),
  file: fileSchema.optional(),
  files: filesSchema.optional(),
});

exports.depositTransactionSchema = Joi.object({
  deposit_id: uuid.required(),
  transaction_date: Joi.date().required(),
  action: depositTransactionAction.required(),
  amount: positiveAmount.required(),
  notes: Joi.string().trim().allow("", null).optional(),
  file: fileSchema.optional(),
  files: filesSchema.optional(),
});

function makeUpdate(schema) {
  return schema
    .fork(Object.keys(schema.describe().keys), (item) =>
      item.optional(),
    )
    .prefs({ noDefaults: true })
    .min(1)
    .messages({ "object.min": "Tidak ada data yang diperbarui." });
}

exports.updateTemplateSchema = makeUpdate(exports.templateSchema);
exports.updateNotaryProgressSchema = makeUpdate(exports.notaryProgressSchema);
exports.updateInsuranceProgressSchema = makeUpdate(exports.insuranceProgressSchema);
exports.updateKjppProgressSchema = makeUpdate(exports.kjppProgressSchema);
exports.updateClaimSchema = makeUpdate(exports.claimSchema);
exports.updateDepositSchema = makeUpdate(exports.depositSchema);
