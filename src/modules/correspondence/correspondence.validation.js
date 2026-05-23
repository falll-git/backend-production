const Joi = require("joi");

const paginationQuerySchema = Joi.object({
  page: Joi.alternatives()
    .try(Joi.number().integer().min(1), Joi.string().valid("all"))
    .optional(),
  limit: Joi.alternatives()
    .try(Joi.number().integer().min(1).max(500), Joi.string().valid("all"))
    .optional(),
  search: Joi.string().trim().allow("", null).optional(),
  sort_by: Joi.string().trim().allow("", null).optional(),
  sort_order: Joi.string().valid("asc", "desc", "ASC", "DESC").optional(),
}).unknown(true);

exports.reportQuerySchema = paginationQuerySchema.keys({
  kind: Joi.string()
    .valid(
      "all",
      "incoming-mail",
      "incoming_mails",
      "incoming-mails",
      "surat-masuk",
      "outgoing-mail",
      "outgoing_mails",
      "outgoing-mails",
      "surat-keluar",
      "memorandum",
      "memorandums",
    )
    .optional(),
  scope: Joi.string()
    .valid(
      "my",
      "mine",
      "me",
      "saya",
      "laporan-saya",
      "cetak-saya",
      "division",
      "divisi",
      "data-divisi",
      "data_divisi",
      "laporan-divisi",
      "laporan_divisi",
      "cetak-divisi",
      "cetak_divisi",
      "all",
      "semua",
      "laporan-semua",
      "cetak-semua",
    )
    .optional(),
  my_filter: Joi.string()
    .valid(
      "all",
      "active",
      "aktif",
      "masih-aktif",
      "masih_aktif",
      "completed",
      "selesai",
      "done",
      "forwarded",
      "diteruskan",
      "redisposed",
    )
    .optional(),
});

exports.printableDocumentsQuerySchema = exports.reportQuerySchema.keys({
  only_with_file: Joi.boolean()
    .truthy("true", "1", "yes", "ya")
    .falsy("false", "0", "no", "tidak")
    .optional(),
});
