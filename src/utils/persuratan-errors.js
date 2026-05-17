const { AppError } = require("./errors");

const UNIQUE_FIELD_MESSAGES = {
  "incoming-mail": {
    mail_number: "Nomor surat masuk sudah digunakan.",
  },
  "outgoing-mail": {
    mail_number: "Nomor surat keluar sudah digunakan.",
  },
  memorandum: {
    memo_number: "Nomor memorandum sudah digunakan.",
  },
};

const REFERENCE_FIELD_MESSAGES = {
  letter_prioritie_id: "Prioritas surat tidak ditemukan.",
  storage_id: "Tempat penyimpanan fisik tidak ditemukan.",
  origin_division_id: "Divisi asal memorandum tidak ditemukan.",
  division_id: "Divisi tujuan tidak ditemukan.",
  receiver_id: "Penerima disposisi tidak ditemukan.",
  sender_id: "Pengirim disposisi tidak ditemukan.",
  created_by: "Pengguna pembuat tidak ditemukan.",
  updated_by: "Pengguna pengubah tidak ditemukan.",
  deleted_by: "Pengguna penghapus tidak ditemukan.",
};

function normalizePrismaMetaValues(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  if (typeof value === "string") {
    return [value];
  }

  return [];
}

function getPrismaErrorFields(error) {
  return [
    ...normalizePrismaMetaValues(error?.meta?.target),
    ...normalizePrismaMetaValues(error?.meta?.field_name),
  ];
}

function fieldMatches(fields, fieldName) {
  return fields.some((field) => field.includes(fieldName));
}

function mapPersuratanPrismaError(error, documentKind) {
  const fields = getPrismaErrorFields(error);

  if (error?.code === "P2002") {
    const messages = UNIQUE_FIELD_MESSAGES[documentKind] || {};
    const matchedField = Object.keys(messages).find((field) =>
      fieldMatches(fields, field),
    );

    if (matchedField) {
      return new AppError(messages[matchedField], 409);
    }
  }

  if (error?.code === "P2003") {
    const matchedField = Object.keys(REFERENCE_FIELD_MESSAGES).find((field) =>
      fieldMatches(fields, field),
    );

    if (matchedField) {
      return new AppError(REFERENCE_FIELD_MESSAGES[matchedField], 422);
    }

    return new AppError("Referensi data tidak valid.", 422);
  }

  return error;
}

module.exports = {
  mapPersuratanPrismaError,
};
