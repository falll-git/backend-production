const Joi = require("joi");

const uuid = Joi.string().uuid();
const optionalUuid = uuid.allow("", null);
const fileSchema = Joi.object({
  buffer: Joi.any().optional(),
  temp_path: Joi.string().trim().optional(),
  name: Joi.string().trim().required(),
  mime_type: Joi.string().trim().allow("", null).optional(),
  size_bytes: Joi.number().integer().optional(),
})
  .unknown(true)
  .or("buffer", "temp_path");

exports.importJobSchema = Joi.object({
  file: fileSchema.required(),
  debtor_id: optionalUuid.optional(),
  contract_id: optionalUuid.optional(),
  period_month: Joi.string()
    .trim()
    .pattern(/^\d{4}-(0[1-9]|1[0-2])$/)
    .allow("", null)
    .optional(),
  raw_reference: Joi.string().trim().allow("", null).optional(),
  summary: Joi.alternatives().try(Joi.object(), Joi.array()).optional(),
  total_rows: Joi.number().integer().min(0).optional(),
});

exports.idebImportJobSchema = exports.importJobSchema;

exports.restrikImportJobSchema = exports.importJobSchema.keys({
  period_month: Joi.string()
    .trim()
    .pattern(/^\d{4}-(0[1-9]|1[0-2])$/)
    .required()
    .messages({
      "any.required": "Periode Data wajib dipilih untuk Import Restrukturisasi.",
      "string.empty": "Periode Data wajib dipilih untuk Import Restrukturisasi.",
      "string.pattern.base": "Format Periode Data harus YYYY-MM.",
    }),
});

exports.slikImportJobSchema = Joi.object({
  file: fileSchema.optional(),
  files: Joi.array().items(fileSchema).min(1).max(20).optional(),
  import_segment: Joi.string().trim().uppercase().valid("D01", "D02", "F01", "A01").required(),
  cif_status: Joi.string().trim().uppercase().valid("I", "B").allow("", null).optional(),
  period_month: Joi.string()
    .trim()
    .pattern(/^\d{4}-(0[1-9]|1[0-2])$/)
    .allow("", null)
    .optional(),
})
  .custom((value, helpers) => {
    if (value.import_segment === "D01" && value.cif_status && value.cif_status !== "I") {
      return helpers.error("any.custom", {
        message: "Status CIF D01 harus I - Perorangan.",
      });
    }
    if (value.import_segment === "D02" && value.cif_status && value.cif_status !== "B") {
      return helpers.error("any.custom", {
        message: "Status CIF D02 harus B - Badan Usaha/Yayasan.",
      });
    }
    if (!["D01", "D02"].includes(value.import_segment) && value.cif_status) {
      return helpers.error("any.custom", {
        message: "Status CIF hanya boleh diisi untuk import D01 atau D02.",
      });
    }
    if (value.import_segment === "F01" && !value.period_month) {
      return helpers.error("any.custom", {
        message: "Periode Data wajib dipilih untuk import F01.",
      });
    }
    return value;
  })
  .or("file", "files")
  .messages({
    "object.missing": "File SLIK wajib diunggah.",
    "any.custom": "{{#message}}",
  });
