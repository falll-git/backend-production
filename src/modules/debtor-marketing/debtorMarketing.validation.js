const Joi = require("joi");

const uuid = Joi.string().uuid();
const optionalUuid = uuid.allow("", null);
const fileSchema = Joi.object({
  buffer: Joi.any().optional(),
  temp_path: Joi.string().trim().optional(),
  name: Joi.string().trim().required(),
  mime_type: Joi.string().trim().required(),
  size_bytes: Joi.number().integer().optional(),
})
  .or("buffer", "temp_path")
  .unknown(true);
const filesSchema = Joi.array().items(fileSchema).min(1).max(20);
const latitudeSchema = Joi.number().min(-90).max(90).messages({
  "number.base": "Latitude kunjungan harus berupa angka yang valid.",
  "number.min": "Latitude kunjungan harus berada pada rentang -90 sampai 90.",
  "number.max": "Latitude kunjungan harus berada pada rentang -90 sampai 90.",
});
const longitudeSchema = Joi.number().min(-180).max(180).messages({
  "number.base": "Longitude kunjungan harus berupa angka yang valid.",
  "number.min": "Longitude kunjungan harus berada pada rentang -180 sampai 180.",
  "number.max": "Longitude kunjungan harus berada pada rentang -180 sampai 180.",
});
const locationAccuracySchema = Joi.number().min(0).messages({
  "number.base": "Akurasi lokasi harus berupa angka yang valid.",
  "number.min": "Akurasi lokasi tidak boleh bernilai negatif.",
});

const payload = {
  debtor_id: uuid.required(),
  contract_id: optionalUuid.optional(),
  timeline_id: optionalUuid.optional(),
  timeline_group_id: Joi.string().trim().max(100).allow("", null).optional(),
  related_activity_id: optionalUuid.optional(),
  activity_date: Joi.date().allow(null).optional(),
  target_date: Joi.date().allow(null).optional(),
  status: Joi.string().trim().max(50).default("PENDING"),
  action_plan: Joi.string().trim().allow("", null).optional(),
  visit_address: Joi.string().trim().allow("", null).optional(),
  visit_latitude: latitudeSchema.optional(),
  visit_longitude: longitudeSchema.optional(),
  visit_location_accuracy_m: locationAccuracySchema.optional(),
  visit_result: Joi.string().trim().allow("", null).optional(),
  conclusion: Joi.string().trim().allow("", null).optional(),
  handling_step: Joi.string().trim().allow("", null).optional(),
  handling_result: Joi.string().trim().allow("", null).optional(),
  notes: Joi.string().trim().allow("", null).optional(),
  file: fileSchema.optional(),
  files: filesSchema.optional(),
};

function requireCoordinatePair(schema) {
  return schema
    .and("visit_latitude", "visit_longitude")
    .with("visit_location_accuracy_m", [
      "visit_latitude",
      "visit_longitude",
    ])
    .messages({
      "object.and":
        "Latitude dan longitude kunjungan wajib dikirim berpasangan.",
      "object.with":
        "Akurasi lokasi hanya dapat dikirim bersama koordinat kunjungan.",
    });
}

exports.createMarketingActivitySchema = requireCoordinatePair(
  Joi.object(payload),
);
exports.updateMarketingActivitySchema = requireCoordinatePair(
  Joi.object(
    Object.fromEntries(
      Object.entries(payload).map(([field, schema]) => [
        field,
        schema.optional(),
      ]),
    ),
  ),
)
  .prefs({ noDefaults: true })
  .min(1)
  .messages({ "object.min": "Tidak ada data yang diperbarui." });
