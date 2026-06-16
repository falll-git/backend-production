const prisma = require("../config/prisma");
const {
  canScopeAccessDocument,
  getDigitalArchiveAccessScope,
} = require("../utils/digital-archive-access");
const {
  canViewIncomingMail,
  canViewMemorandum,
  canViewOutgoingMail,
  getPersuratanAccessScope,
} = require("../utils/persuratan-access");
const {
  FILE_TOKEN_QUERY_PARAM,
  verifyFileAccessToken,
} = require("../utils/file-access-token");
const {
  DEBTOR_DATA_SCOPE_URLS,
  LEGAL_DATA_SCOPE_URLS,
  userHasAnyMenuRead,
} = require("../utils/debtor-access");
const { REPORT_ALL_FEATURE } = require("../utils/menu-access");
const { roleHasFeature } = require("../utils/rbac");

const WATERMARK_SUPPORTED_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png"]);
const PERSURATAN_PRINT_MENU_URL = "/dashboard/manajemen-surat/cetak-dokumen";
const MIME_TYPES_BY_EXTENSION = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  json: "application/json",
};

function normalizeRequestedPath(req, publicPrefix) {
  return `${publicPrefix}${req.path || ""}`;
}

function filePathMatchesRecord(record, storedPath) {
  if (!record || !storedPath) return false;
  if (record.file === storedPath) return true;
  if (record.watermark_file === storedPath) return true;

  const documentFiles = Array.isArray(record.document_files)
    ? record.document_files
    : [];
  return documentFiles.some((item) => item.file_path === storedPath);
}

function getStoredPathExtension(storedPath) {
  if (typeof storedPath !== "string" || !storedPath.trim()) return "";

  const normalized = storedPath.trim().split("?")[0].split("#")[0];
  const fileName = normalized.split(/[\\/]/).filter(Boolean).pop() || "";
  const parts = fileName.toLowerCase().split(".");

  return parts.length > 1 ? parts.pop() || "" : "";
}

function getFileNameFromPath(storedPath) {
  if (typeof storedPath !== "string" || !storedPath.trim()) return null;

  const normalized = storedPath.trim().split("?")[0].split("#")[0];
  const fileName = normalized.split(/[\\/]/).filter(Boolean).pop();
  if (!fileName) return null;

  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}

function hasFileExtension(fileName) {
  return typeof fileName === "string" && /\.[A-Za-z0-9]{1,8}$/.test(fileName);
}

function normalizeFileNameForHeader(fileName, storedPath) {
  const fallback = getFileNameFromPath(storedPath) || "dokumen";
  const rawName =
    typeof fileName === "string" && fileName.trim() ? fileName.trim() : fallback;
  const withoutUnsafeChars = rawName
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\/]+/g, "-")
    .trim();
  const extension = getStoredPathExtension(storedPath);
  const finalName =
    withoutUnsafeChars && hasFileExtension(withoutUnsafeChars)
      ? withoutUnsafeChars
      : extension
        ? `${withoutUnsafeChars || "dokumen"}.${extension}`
        : withoutUnsafeChars || fallback;

  return finalName;
}

function buildContentDisposition(fileName) {
  const fallbackName = fileName
    .replace(/["\\]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_");
  return `inline; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(
    fileName,
  )}`;
}

function inferMimeType(fileName, storedPath) {
  const fileNameExtension = getStoredPathExtension(fileName);
  const storedPathExtension = getStoredPathExtension(storedPath);
  return (
    MIME_TYPES_BY_EXTENSION[fileNameExtension] ||
    MIME_TYPES_BY_EXTENSION[storedPathExtension] ||
    null
  );
}

function normalizeFileMeta(meta, payload) {
  const fileName = normalizeFileNameForHeader(meta?.fileName, payload.path);
  return {
    fileName,
    mimeType: meta?.mimeType || inferMimeType(fileName, payload.path),
  };
}

function selectDomainFileMeta(record, fallbackName) {
  if (!record) return null;
  return {
    fileName:
      record.file_name ||
      record.generated_file_name ||
      record.document_name ||
      record.title ||
      record.type ||
      record.source_type ||
      record.activity_kind ||
      record.letter_type ||
      record.template_type ||
      record.document_type ||
      record.deed_type ||
      record.insurance_type ||
      record.appraisal_type ||
      record.claim_type ||
      fallbackName ||
      null,
    mimeType: record.mime_type || record.generated_mime_type || null,
  };
}

async function firstFileMeta(checks) {
  for (const check of checks) {
    const record = await check();
    if (record) return selectDomainFileMeta(record);
  }

  return null;
}

async function isWatermarkTargetEnabled(module) {
  const settings = await prisma.watermark_settings.findFirst({
    orderBy: {
      created_at: "asc",
    },
    select: {
      is_enabled: true,
      target_modules: true,
    },
  });

  return Boolean(
    settings?.is_enabled &&
      Array.isArray(settings.target_modules) &&
      settings.target_modules.includes(module),
  );
}

async function getDigitalArchiveFileMeta(payload) {
  const record = await prisma.digital_documents.findFirst({
    where: {
      id: payload.entity_id,
      deleted_at: null,
    },
    select: {
      document_name: true,
      file: true,
      watermark_file: true,
      document_files: {
        where: {
          deleted_at: null,
        },
        orderBy: {
          created_at: "desc",
        },
        select: {
          file_path: true,
          file_name: true,
          mime_type: true,
          is_primary: true,
        },
      },
    },
  });

  if (!record) return null;

  const files = Array.isArray(record.document_files)
    ? record.document_files
    : [];
  const matched = files.find((item) => item.file_path === payload.path);
  const primary = files.find((item) => item.is_primary) || files[0] || null;
  const sourceFile = matched || primary;

  return {
    fileName: sourceFile?.file_name || record.document_name || null,
    mimeType: sourceFile?.mime_type || null,
  };
}

async function getPersuratanFileMeta(payload, modelName) {
  const record = await prisma[modelName].findFirst({
    where: {
      id: payload.entity_id,
      deleted_at: null,
      OR: [{ file: payload.path }, { watermark_file: payload.path }],
    },
    select: {
      file_name: true,
      file: true,
      watermark_file: true,
    },
  });

  if (!record) return null;
  return selectDomainFileMeta(record);
}

async function getDebtorInformationFileMeta(payload) {
  return firstFileMeta([
    () =>
      prisma.debtor_documents.findFirst({
        where: {
          id: payload.entity_id,
          file_path: payload.path,
          deleted_at: null,
        },
        select: {
          file_name: true,
          mime_type: true,
          document_type: true,
        },
      }),
    () =>
      prisma.debtor_import_jobs.findFirst({
        where: {
          id: payload.entity_id,
          file_path: payload.path,
          deleted_at: null,
        },
        select: {
          file_name: true,
          mime_type: true,
          type: true,
        },
      }),
    () =>
      prisma.debtor_external_records.findFirst({
        where: {
          id: payload.entity_id,
          file_path: payload.path,
          deleted_at: null,
        },
        select: {
          file_name: true,
          mime_type: true,
          source_type: true,
        },
      }),
    () =>
      prisma.debtor_ideb_uploads.findFirst({
        where: {
          id: payload.entity_id,
          file_path: payload.path,
          deleted_at: null,
        },
        select: {
          file_name: true,
          mime_type: true,
        },
      }),
    () =>
      prisma.debtor_ideb_upload_files.findFirst({
        where: {
          id: payload.entity_id,
          file_path: payload.path,
        },
        select: {
          file_name: true,
          mime_type: true,
        },
      }),
    () =>
      prisma.debtor_marketing_activities.findFirst({
        where: {
          id: payload.entity_id,
          file_path: payload.path,
          deleted_at: null,
        },
        select: {
          file_name: true,
          mime_type: true,
          activity_kind: true,
        },
      }),
    () =>
      prisma.debtor_warning_letters.findFirst({
        where: {
          id: payload.entity_id,
          file_path: payload.path,
          deleted_at: null,
        },
        select: {
          file_name: true,
          mime_type: true,
          letter_type: true,
        },
      }),
  ]);
}

async function getLegalManagementFileMeta(payload) {
  return firstFileMeta([
    () =>
      prisma.legal_document_templates.findFirst({
        where: {
          id: payload.entity_id,
          file_path: payload.path,
          deleted_at: null,
        },
        select: {
          file_name: true,
          mime_type: true,
          title: true,
          template_type: true,
        },
      }),
    () =>
      prisma.legal_print_histories.findFirst({
        where: {
          id: payload.entity_id,
          generated_file_path: payload.path,
          deleted_at: null,
        },
        select: {
          generated_file_name: true,
          generated_mime_type: true,
          document_type: true,
        },
      }),
    () =>
      prisma.legal_notary_progress.findFirst({
        where: {
          id: payload.entity_id,
          file_path: payload.path,
          deleted_at: null,
        },
        select: {
          file_name: true,
          mime_type: true,
          deed_type: true,
        },
      }),
    () =>
      prisma.legal_insurance_progress.findFirst({
        where: {
          id: payload.entity_id,
          file_path: payload.path,
          deleted_at: null,
        },
        select: {
          file_name: true,
          mime_type: true,
          insurance_type: true,
        },
      }),
    () =>
      prisma.legal_kjpp_progress.findFirst({
        where: {
          id: payload.entity_id,
          file_path: payload.path,
          deleted_at: null,
        },
        select: {
          file_name: true,
          mime_type: true,
          appraisal_type: true,
        },
      }),
    () =>
      prisma.legal_claims.findFirst({
        where: {
          id: payload.entity_id,
          file_path: payload.path,
          deleted_at: null,
        },
        select: {
          file_name: true,
          mime_type: true,
          claim_type: true,
        },
      }),
  ]);
}

async function getFileResponseMeta(payload) {
  switch (payload.module) {
    case "digital_archive":
      return getDigitalArchiveFileMeta(payload);
    case "incoming_mail":
      return getPersuratanFileMeta(payload, "incoming_mails");
    case "outgoing_mail":
      return getPersuratanFileMeta(payload, "outgoing_mails");
    case "memorandum":
      return getPersuratanFileMeta(payload, "memorandums");
    case "debtor_information":
      return getDebtorInformationFileMeta(payload);
    case "legal_management":
      return getLegalManagementFileMeta(payload);
    default:
      return null;
  }
}

function applySecureFileHeaders(res, payload, meta) {
  const normalized = normalizeFileMeta(meta, payload);

  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Disposition", buildContentDisposition(normalized.fileName));
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (normalized.mimeType) {
    res.setHeader("Content-Type", normalized.mimeType);
  }
}

async function blocksOriginalWatermarkTarget({ module, record, storedPath }) {
  if (!record || record.watermark_file === storedPath) return false;
  if (record.file !== storedPath) return false;
  if (record.watermark_status !== "APPLIED" || !record.watermark_file) {
    return false;
  }

  const extension = getStoredPathExtension(storedPath);
  if (!WATERMARK_SUPPORTED_EXTENSIONS.has(extension)) return false;
  if (!(await isWatermarkTargetEnabled(module))) return false;

  return true;
}

async function isUserActive(userId) {
  if (!userId) return false;

  const user = await prisma.users.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      is_active: true,
      password_set_at: true,
    },
  });

  return Boolean(user?.is_active && user.password_set_at);
}

async function canAccessDigitalArchiveFile(payload) {
  const record = await prisma.digital_documents.findFirst({
    where: {
      id: payload.entity_id,
      deleted_at: null,
    },
    include: {
      related_users: true,
      access_requests: true,
      document_files: {
        where: {
          deleted_at: null,
        },
      },
    },
  });

  if (!filePathMatchesRecord(record, payload.path)) return false;
  if (
    await blocksOriginalWatermarkTarget({
      module: "digital_archive",
      record,
      storedPath: payload.path,
    })
  ) {
    return false;
  }

  const scope = await getDigitalArchiveAccessScope(payload.user_id);
  return canScopeAccessDocument(record, scope);
}

async function canAccessIncomingMailFile(payload) {
  const record = await prisma.incoming_mails.findFirst({
    where: {
      id: payload.entity_id,
      deleted_at: null,
    },
    include: {
      disposition_mails: true,
      target_divisions: true,
    },
  });

  if (!filePathMatchesRecord(record, payload.path)) return false;
  if (
    await blocksOriginalWatermarkTarget({
      module: "incoming_mail",
      record,
      storedPath: payload.path,
    })
  ) {
    return false;
  }

  const scope = await getPersuratanAccessScope(payload.user_id);
  return (
    canViewIncomingMail(record, scope) ||
    (await roleHasFeature(
      scope.roleId,
      PERSURATAN_PRINT_MENU_URL,
      REPORT_ALL_FEATURE,
    ))
  );
}

async function canAccessOutgoingMailFile(payload) {
  const record = await prisma.outgoing_mails.findFirst({
    where: {
      id: payload.entity_id,
      deleted_at: null,
    },
    include: {
      creator: {
        select: {
          division_id: true,
        },
      },
    },
  });

  if (!filePathMatchesRecord(record, payload.path)) return false;
  if (
    await blocksOriginalWatermarkTarget({
      module: "outgoing_mail",
      record,
      storedPath: payload.path,
    })
  ) {
    return false;
  }

  const scope = await getPersuratanAccessScope(payload.user_id);
  return (
    canViewOutgoingMail(record, scope) ||
    (await roleHasFeature(
      scope.roleId,
      PERSURATAN_PRINT_MENU_URL,
      REPORT_ALL_FEATURE,
    ))
  );
}

async function canAccessMemorandumFile(payload) {
  const record = await prisma.memorandums.findFirst({
    where: {
      id: payload.entity_id,
      deleted_at: null,
    },
    include: {
      dispositions: true,
      target_divisions: true,
    },
  });

  if (!filePathMatchesRecord(record, payload.path)) return false;
  if (
    await blocksOriginalWatermarkTarget({
      module: "memorandum",
      record,
      storedPath: payload.path,
    })
  ) {
    return false;
  }

  const scope = await getPersuratanAccessScope(payload.user_id);
  return (
    canViewMemorandum(record, scope) ||
    (await roleHasFeature(
      scope.roleId,
      PERSURATAN_PRINT_MENU_URL,
      REPORT_ALL_FEATURE,
    ))
  );
}

async function debtorFileExists(payload) {
  const checks = [
    () => prisma.debtor_documents.findFirst({
      where: {
        id: payload.entity_id,
        file_path: payload.path,
        deleted_at: null,
      },
      select: { id: true },
    }),
    () => prisma.debtor_import_jobs.findFirst({
      where: {
        id: payload.entity_id,
        file_path: payload.path,
        deleted_at: null,
      },
      select: { id: true },
    }),
    () => prisma.debtor_external_records.findFirst({
      where: {
        id: payload.entity_id,
        file_path: payload.path,
        deleted_at: null,
      },
      select: { id: true },
    }),
    () => prisma.debtor_ideb_uploads.findFirst({
      where: {
        id: payload.entity_id,
        file_path: payload.path,
        deleted_at: null,
      },
      select: { id: true },
    }),
    () => prisma.debtor_ideb_upload_files.findFirst({
      where: {
        id: payload.entity_id,
        file_path: payload.path,
      },
      select: { id: true },
    }),
    () => prisma.debtor_marketing_activities.findFirst({
      where: {
        id: payload.entity_id,
        file_path: payload.path,
        deleted_at: null,
      },
      select: { id: true },
    }),
    () => prisma.debtor_warning_letters.findFirst({
      where: {
        id: payload.entity_id,
        file_path: payload.path,
        deleted_at: null,
      },
      select: { id: true },
    }),
  ];

  for (const check of checks) {
    if (await check()) return true;
  }

  return false;
}

async function legalFileExists(payload) {
  const checks = [
    () => prisma.legal_document_templates.findFirst({
      where: {
        id: payload.entity_id,
        file_path: payload.path,
        deleted_at: null,
      },
      select: { id: true },
    }),
    () => prisma.legal_print_histories.findFirst({
      where: {
        id: payload.entity_id,
        generated_file_path: payload.path,
        deleted_at: null,
      },
      select: { id: true },
    }),
    () => prisma.legal_notary_progress.findFirst({
      where: {
        id: payload.entity_id,
        file_path: payload.path,
        deleted_at: null,
      },
      select: { id: true },
    }),
    () => prisma.legal_insurance_progress.findFirst({
      where: {
        id: payload.entity_id,
        file_path: payload.path,
        deleted_at: null,
      },
      select: { id: true },
    }),
    () => prisma.legal_kjpp_progress.findFirst({
      where: {
        id: payload.entity_id,
        file_path: payload.path,
        deleted_at: null,
      },
      select: { id: true },
    }),
    () => prisma.legal_claims.findFirst({
      where: {
        id: payload.entity_id,
        file_path: payload.path,
        deleted_at: null,
      },
      select: { id: true },
    }),
  ];

  for (const check of checks) {
    if (await check()) return true;
  }

  return false;
}

async function canAccessDebtorInformationFile(payload) {
  if (!(await debtorFileExists(payload))) return false;
  return userHasAnyMenuRead(payload.user_id, DEBTOR_DATA_SCOPE_URLS);
}

async function canAccessLegalManagementFile(payload) {
  if (!(await legalFileExists(payload))) return false;
  return userHasAnyMenuRead(payload.user_id, LEGAL_DATA_SCOPE_URLS);
}

async function canAccessFile(payload) {
  if (!(await isUserActive(payload.user_id))) return false;

  switch (payload.module) {
    case "digital_archive":
      return canAccessDigitalArchiveFile(payload);
    case "incoming_mail":
      return canAccessIncomingMailFile(payload);
    case "outgoing_mail":
      return canAccessOutgoingMailFile(payload);
    case "memorandum":
      return canAccessMemorandumFile(payload);
    case "debtor_information":
      return canAccessDebtorInformationFile(payload);
    case "legal_management":
      return canAccessLegalManagementFile(payload);
    default:
      return false;
  }
}

function secureFileAccess(publicPrefix) {
  return async (req, res, next) => {
    const token = req.query[FILE_TOKEN_QUERY_PARAM];
    const payload = verifyFileAccessToken(
      Array.isArray(token) ? token[0] : token,
    );
    const requestedPath = normalizeRequestedPath(req, publicPrefix);

    if (!payload || payload.path !== requestedPath) {
      return res.status(401).json({
        status: false,
        message: "Akses file tidak valid atau sudah kedaluwarsa.",
      });
    }

    let allowed = false;
    try {
      allowed = await canAccessFile(payload);
    } catch (error) {
      console.error("Secure file access validation failed:", error);
      return res.status(500).json({
        status: false,
        message: "Gagal memvalidasi akses file.",
      });
    }

    if (!allowed) {
      return res.status(403).json({
        status: false,
        message: "Anda tidak memiliki akses ke file ini.",
      });
    }

    try {
      const meta = await getFileResponseMeta(payload);
      applySecureFileHeaders(res, payload, meta);
    } catch (error) {
      console.error("Secure file metadata lookup failed:", error);
      applySecureFileHeaders(res, payload, null);
    }

    req.fileAccess = payload;
    res.locals.fileAccess = payload;
    return next();
  };
}

module.exports = secureFileAccess;
