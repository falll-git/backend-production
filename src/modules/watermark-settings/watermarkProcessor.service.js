const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
} = require("pdf-lib");
const prisma = require("../../config/prisma");
const { AppError } = require("../../utils/errors");
const {
  PUBLIC_PREFIX: DIGITAL_ARCHIVE_PUBLIC_PREFIX,
  STORAGE_ROOT: DIGITAL_ARCHIVE_STORAGE_ROOT,
} = require("../../utils/digital-archive-files");
const {
  PUBLIC_PREFIX: PERSURATAN_PUBLIC_PREFIX,
  STORAGE_ROOT: PERSURATAN_STORAGE_ROOT,
} = require("../../utils/persuratan-files");
const {
  resolveWatermarkAssetPath,
} = require("../../utils/watermark-files");
const {
  appendFileAccessToken,
} = require("../../utils/file-access-token");
const {
  PUBLIC_PREFIX: WATERMARKED_PUBLIC_PREFIX,
  STORAGE_ROOT: WATERMARKED_STORAGE_ROOT,
} = require("../../utils/watermarked-files");
const { toSizeBytesBigInt } = require("../../utils/size-bytes");

const DEFAULT_WATERMARK_MAX_PROCESS_SIZE_BYTES = 512 * 1024 * 1024;
const WATERMARK_MAX_PROCESS_SIZE_BYTES =
  Number(process.env.WATERMARK_MAX_PROCESS_SIZE_BYTES) ||
  DEFAULT_WATERMARK_MAX_PROCESS_SIZE_BYTES;

const MODULE_CONFIG = {
  digital_archive: {
    model: "digital_documents",
    label: "Arsip Digital",
    numberField: "document_number",
    nameField: "document_name",
    fileField: "file",
    deletedField: "deleted_at",
    creatorInclude: "creator",
  },
  incoming_mail: {
    model: "incoming_mails",
    label: "Surat Masuk",
    numberField: "mail_number",
    nameField: "regarding",
    fileField: "file",
    deletedField: "deleted_at",
    creatorInclude: "creator",
  },
  outgoing_mail: {
    model: "outgoing_mails",
    label: "Surat Keluar",
    numberField: "mail_number",
    nameField: "name",
    fileField: "file",
    deletedField: "deleted_at",
    creatorInclude: "creator",
  },
  memorandum: {
    model: "memorandums",
    label: "Memorandum",
    numberField: "memo_number",
    nameField: "regarding",
    fileField: "file",
    deletedField: "deleted_at",
    creatorInclude: "creator",
  },
};

const WATERMARK_LABELS = {
  PENDING: "Belum Diterapkan",
  PROCESSING: "Dalam Proses",
  APPLIED: "Aktif",
  SKIPPED: "Nonaktif",
  FAILED: "Gagal",
  UNSUPPORTED: "Belum Didukung",
};

let isWorkerRunning = false;

function ensureDirectory(target) {
  fs.mkdirSync(target, { recursive: true });
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sanitizeFileNameBase(value) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function getFileExtension(value) {
  const normalized = String(value || "")
    .split("?")[0]
    .split("#")[0]
    .toLowerCase();
  const fileName = normalized.split(/[\\/]/).filter(Boolean).pop() || "";
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop() : "";
}

function isPdf(extension) {
  return extension === "pdf";
}

function isImage(extension) {
  return ["jpg", "jpeg", "png"].includes(extension);
}

function isOffice(extension) {
  return ["doc", "docx", "xls", "xlsx"].includes(extension);
}

function createUnsupportedWatermarkError(extension) {
  const error = new Error(
    isOffice(extension)
      ? "Watermark DOC/DOCX/XLS/XLSX belum didukung. File tetap bisa diunduh sesuai izin akses."
      : "Format file belum didukung untuk watermark.",
  );
  error.code = "UNSUPPORTED";
  return error;
}

function normalizeHexColor(value) {
  const normalized = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : "#1F2937";
}

function hexToRgbParts(value) {
  const hex = normalizeHexColor(value).replace("#", "");
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  };
}

function hexToPdfRgb(value) {
  const color = hexToRgbParts(value);
  return rgb(color.r / 255, color.g / 255, color.b / 255);
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveStoredFilePath(storedPath) {
  if (typeof storedPath !== "string" || !storedPath.trim()) return null;

  const trimmed = storedPath.trim();
  const pairs = [
    [DIGITAL_ARCHIVE_PUBLIC_PREFIX, DIGITAL_ARCHIVE_STORAGE_ROOT],
    [PERSURATAN_PUBLIC_PREFIX, PERSURATAN_STORAGE_ROOT],
    [WATERMARKED_PUBLIC_PREFIX, WATERMARKED_STORAGE_ROOT],
  ];

  for (const [publicPrefix, storageRoot] of pairs) {
    if (!trimmed.startsWith(`${publicPrefix}/`)) continue;

    const relativePath = trimmed
      .replace(`${publicPrefix}/`, "")
      .split("/")
      .filter(Boolean);
    const resolvedPath = path.resolve(storageRoot, ...relativePath);
    const rootWithSeparator = `${storageRoot}${path.sep}`;
    if (
      resolvedPath === storageRoot ||
      !resolvedPath.startsWith(rootWithSeparator)
    ) {
      return null;
    }

    return resolvedPath;
  }

  return null;
}

function getFileSizeBytes(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

function formatSizeMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

function buildWatermarkedFileUrl(req, storedPath, { module, entityId } = {}) {
  if (typeof storedPath !== "string" || !storedPath.trim()) return null;
  if (/^https?:\/\//i.test(storedPath)) return storedPath;
  if (!storedPath.startsWith("/")) return storedPath;

  const origin =
    process.env.PUBLIC_BASE_URL ||
    process.env.API_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.PUBLIC_ASSET_BASE_URL ||
    (req ? `${req.protocol}://${req.get("host")}` : "");

  const fileUrl = origin ? new URL(storedPath, origin).toString() : storedPath;
  return appendFileAccessToken(req, fileUrl, {
    storedPath,
    module,
    entityId,
  });
}

function persistWatermarkedBuffer({ module, sourcePath, extension, buffer }) {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const targetDirectory = path.join(WATERMARKED_STORAGE_ROOT, module, year, month);
  ensureDirectory(targetDirectory);

  const sourceBaseName =
    sanitizeFileNameBase(path.parse(sourcePath || "").name) || module;
  const fileName = `${Date.now()}-${crypto
    .randomBytes(8)
    .toString("hex")}-${sourceBaseName}.watermarked.${extension}`;
  const absolutePath = path.join(targetDirectory, fileName);

  fs.writeFileSync(absolutePath, buffer);

  return {
    storedPath: `${WATERMARKED_PUBLIC_PREFIX}/${module}/${year}/${month}/${fileName}`,
    sizeBytes: buffer.length,
  };
}

function getWatermarkSettingsHash(settings) {
  const relevantSettings = {
    is_enabled: Boolean(settings?.is_enabled),
    target_modules: Array.isArray(settings?.target_modules)
      ? [...settings.target_modules].sort()
      : [],
    watermark_type: settings?.watermark_type || "TEXT",
    text_template: settings?.text_template || "",
    text_color: settings?.text_color || "#1F2937",
    text_opacity: settings?.text_opacity ?? 0.16,
    font_family: settings?.font_family || "Arial",
    font_size: settings?.font_size ?? 42,
    image_path: settings?.image_path || null,
    image_opacity: settings?.image_opacity ?? 0.16,
    image_scale: settings?.image_scale ?? 0.35,
    position: settings?.position || "CENTER",
    repeat_pattern: Boolean(settings?.repeat_pattern),
    rotation: settings?.rotation ?? -35,
    spacing_x: settings?.spacing_x ?? 280,
    spacing_y: settings?.spacing_y ?? 180,
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(relevantSettings))
    .digest("hex");
}

async function getSettings() {
  return prisma.watermark_settings.findFirst({
    orderBy: {
      created_at: "asc",
    },
  });
}

function normalizeTargetModules(settings) {
  return Array.isArray(settings?.target_modules)
    ? settings.target_modules.filter((module) => MODULE_CONFIG[module])
    : [];
}

function shouldApplyWatermark({ settings, record, module }) {
  if (!record?.file) return false;
  return (
    Boolean(settings?.is_enabled) &&
    normalizeTargetModules(settings).includes(module)
  );
}

function getPrismaModel(module) {
  const config = MODULE_CONFIG[module];
  if (!config) {
    throw new AppError("Target modul watermark tidak valid.", 422);
  }

  const model = prisma[config.model];
  if (!model) {
    throw new AppError("Model watermark tidak tersedia.", 500);
  }

  return model;
}

function getRecordInclude(module) {
  const config = MODULE_CONFIG[module];
  if (!config?.creatorInclude) return undefined;

  return {
    [config.creatorInclude]: {
      include: {
        division: true,
      },
    },
  };
}

async function findRecord(module, entityId) {
  const model = getPrismaModel(module);
  const include = getRecordInclude(module);
  return model.findUnique({
    where: {
      id: entityId,
    },
    ...(include ? { include } : {}),
  });
}

function buildTokenContext({ settings, record, module }) {
  const config = MODULE_CONFIG[module];
  const creator = record?.creator || null;
  const documentName =
    record?.[config.nameField] ||
    record?.[config.numberField] ||
    config.label;
  const documentNumber = record?.[config.numberField] || record?.id || "";
  const now = new Date();

  return {
    "{document_name}": documentName,
    "{document_number}": documentNumber,
    "{username}": creator?.name || creator?.username || "System",
    "{division}": creator?.division?.name || "-",
    "{date}": now.toLocaleDateString("id-ID"),
    "{time}": now.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    "{module}": config.label,
    "{watermark_id}": settings?.id || "",
  };
}

function resolveWatermarkText({ settings, record, module }) {
  if (!["TEXT", "TEXT_IMAGE"].includes(settings?.watermark_type)) return "";

  const template =
    String(settings?.text_template || "").trim() ||
    "{document_name} - {username} - {date}";
  const tokens = buildTokenContext({ settings, record, module });

  return Object.entries(tokens).reduce(
    (text, [token, value]) => text.split(token).join(String(value || "")),
    template,
  );
}

function getPositionPoint({ width, height, itemWidth, itemHeight, position }) {
  const padding = 36;
  switch (position) {
    case "TOP_LEFT":
      return { x: padding, y: height - itemHeight - padding };
    case "TOP_RIGHT":
      return { x: width - itemWidth - padding, y: height - itemHeight - padding };
    case "BOTTOM_LEFT":
      return { x: padding, y: padding };
    case "BOTTOM_RIGHT":
      return { x: width - itemWidth - padding, y: padding };
    case "CENTER":
    default:
      return { x: (width - itemWidth) / 2, y: (height - itemHeight) / 2 };
  }
}

async function drawPdfTextWatermark({ pdfDoc, settings, record, module }) {
  const text = resolveWatermarkText({ settings, record, module });
  if (!text) return;

  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = clampNumber(settings.font_size, 8, 96, 42);
  const opacity = clampNumber(settings.text_opacity, 0.02, 1, 0.16);
  const color = hexToPdfRgb(settings.text_color);
  const rotation = degrees(clampNumber(settings.rotation, -90, 90, -35));
  const repeatPattern = Boolean(settings.repeat_pattern);
  const spacingX = clampNumber(settings.spacing_x, 120, 720, 280);
  const spacingY = clampNumber(settings.spacing_y, 90, 720, 180);

  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const textHeight = fontSize;

    if (!repeatPattern) {
      const point = getPositionPoint({
        width,
        height,
        itemWidth: textWidth,
        itemHeight: textHeight,
        position: settings.position,
      });
      page.drawText(text, {
        x: point.x,
        y: point.y,
        size: fontSize,
        font,
        color,
        opacity,
        rotate: rotation,
      });
      continue;
    }

    for (let y = -height; y <= height * 2; y += spacingY) {
      for (let x = -width; x <= width * 2; x += spacingX) {
        page.drawText(text, {
          x,
          y,
          size: fontSize,
          font,
          color,
          opacity,
          rotate: rotation,
        });
      }
    }
  }
}

async function drawPdfImageWatermark({ pdfDoc, settings }) {
  if (!["IMAGE", "TEXT_IMAGE"].includes(settings?.watermark_type)) return;
  if (!settings?.image_path) return;

  const imagePath = resolveWatermarkAssetPath(settings.image_path);
  if (!imagePath || !fs.existsSync(imagePath)) return;

  const extension = getFileExtension(imagePath);
  if (!["png", "jpg", "jpeg"].includes(extension)) return;

  const imageBytes = fs.readFileSync(imagePath);
  const image =
    extension === "png"
      ? await pdfDoc.embedPng(imageBytes)
      : await pdfDoc.embedJpg(imageBytes);
  const opacity = clampNumber(settings.image_opacity, 0.02, 1, 0.16);
  const imageScale = clampNumber(settings.image_scale, 0.05, 1, 0.35);

  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();
    const maxWidth = width * imageScale;
    const scaled = image.scale(maxWidth / image.width);
    const point = getPositionPoint({
      width,
      height,
      itemWidth: scaled.width,
      itemHeight: scaled.height,
      position: settings.position,
    });

    page.drawImage(image, {
      x: point.x,
      y: point.y,
      width: scaled.width,
      height: scaled.height,
      opacity,
      rotate: degrees(clampNumber(settings.rotation, -90, 90, -35)),
    });
  }
}

async function watermarkPdfBuffer({ sourceBuffer, settings, record, module }) {
  const pdfDoc = await PDFDocument.load(sourceBuffer);
  await drawPdfImageWatermark({ pdfDoc, settings });
  await drawPdfTextWatermark({ pdfDoc, settings, record, module });
  return Buffer.from(await pdfDoc.save());
}

function buildTextOverlaySvg({ width, height, settings, record, module }) {
  const text = resolveWatermarkText({ settings, record, module });
  if (!text) return null;

  const color = hexToRgbParts(settings.text_color);
  const opacity = clampNumber(settings.text_opacity, 0.02, 1, 0.16);
  const fontSize = clampNumber(settings.font_size, 8, 96, 42);
  const rotation = clampNumber(settings.rotation, -90, 90, -35);
  const spacingX = clampNumber(settings.spacing_x, 120, 720, 280);
  const spacingY = clampNumber(settings.spacing_y, 90, 720, 180);
  const repeatPattern = Boolean(settings.repeat_pattern);

  const textNodes = [];
  if (repeatPattern) {
    for (let y = -height; y <= height * 2; y += spacingY) {
      for (let x = -width; x <= width * 2; x += spacingX) {
        textNodes.push(
          `<text x="${x}" y="${y}" transform="rotate(${rotation} ${x} ${y})">${escapeXml(
            text,
          )}</text>`,
        );
      }
    }
  } else {
    const point = getPositionPoint({
      width,
      height,
      itemWidth: text.length * fontSize * 0.58,
      itemHeight: fontSize,
      position: settings.position,
    });
    textNodes.push(
      `<text x="${point.x}" y="${point.y + fontSize}" transform="rotate(${rotation} ${point.x} ${
        point.y + fontSize
      })">${escapeXml(text)}</text>`,
    );
  }

  return Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <g fill="rgb(${color.r}, ${color.g}, ${color.b})" fill-opacity="${opacity}" font-family="${escapeXml(
        settings.font_family || "Arial",
      )}, Arial, sans-serif" font-size="${fontSize}" font-weight="700">
        ${textNodes.join("")}
      </g>
    </svg>`,
  );
}

function buildImageOverlaySvg({ width, height, settings }) {
  if (!["IMAGE", "TEXT_IMAGE"].includes(settings?.watermark_type)) return null;
  if (!settings?.image_path) return null;

  const imagePath = resolveWatermarkAssetPath(settings.image_path);
  if (!imagePath || !fs.existsSync(imagePath)) return null;

  const imageBuffer = fs.readFileSync(imagePath);
  const extension = getFileExtension(imagePath);
  const mimeType =
    extension === "svg"
      ? "image/svg+xml"
      : extension === "png"
        ? "image/png"
        : "image/jpeg";
  const targetWidth = Math.max(
    24,
    Math.round(width * clampNumber(settings.image_scale, 0.05, 1, 0.35)),
  );
  const targetHeight = Math.round(targetWidth * 0.45);
  const point = getPositionPoint({
    width,
    height,
    itemWidth: targetWidth,
    itemHeight: targetHeight,
    position: settings.position,
  });
  const opacity = clampNumber(settings.image_opacity, 0.02, 1, 0.16);
  const rotation = clampNumber(settings.rotation, -90, 90, -35);
  const dataUri = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

  return Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <image href="${dataUri}" x="${point.x}" y="${point.y}" width="${targetWidth}" height="${targetHeight}" opacity="${opacity}" preserveAspectRatio="xMidYMid meet" transform="rotate(${rotation} ${
        point.x + targetWidth / 2
      } ${point.y + targetHeight / 2})" />
    </svg>`,
  );
}

async function watermarkImageBuffer({ sourceBuffer, extension, settings, record, module }) {
  const image = sharp(sourceBuffer).rotate();
  const metadata = await image.metadata();
  const width = metadata.width || 1200;
  const height = metadata.height || 900;
  const overlays = [
    buildImageOverlaySvg({ width, height, settings }),
    buildTextOverlaySvg({ width, height, settings, record, module }),
  ].filter(Boolean);

  let pipeline = image;
  if (overlays.length > 0) {
    pipeline = pipeline.composite(
      overlays.map((input) => ({
        input,
        top: 0,
        left: 0,
      })),
    );
  }

  if (extension === "png") return pipeline.png().toBuffer();
  return pipeline.jpeg({ quality: 90 }).toBuffer();
}

async function createWatermarkedFile({ module, record, settings }) {
  const sourcePath = resolveStoredFilePath(record.file);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    const error = new Error("File sumber watermark tidak ditemukan.");
    error.code = "UNSUPPORTED";
    throw error;
  }

  const sourceExtension = getFileExtension(record.file || sourcePath);
  const sourceSizeBytes = getFileSizeBytes(sourcePath);
  if (
    sourceSizeBytes &&
    sourceSizeBytes > WATERMARK_MAX_PROCESS_SIZE_BYTES
  ) {
    const error = new Error(
      `File terlalu besar untuk watermark otomatis (${formatSizeMb(
        sourceSizeBytes,
      )}). Batas proses watermark saat ini ${formatSizeMb(
        WATERMARK_MAX_PROCESS_SIZE_BYTES,
      )}.`,
    );
    error.code = "UNSUPPORTED";
    throw error;
  }

  const sourceBuffer = fs.readFileSync(sourcePath);

  if (isPdf(sourceExtension)) {
    const watermarkedBuffer = await watermarkPdfBuffer({
      sourceBuffer,
      settings,
      record,
      module,
    });
    return persistWatermarkedBuffer({
      module,
      sourcePath,
      extension: "pdf",
      buffer: watermarkedBuffer,
    });
  }

  if (isImage(sourceExtension)) {
    const outputExtension = sourceExtension === "png" ? "png" : "jpg";
    const watermarkedBuffer = await watermarkImageBuffer({
      sourceBuffer,
      extension: outputExtension,
      settings,
      record,
      module,
    });
    return persistWatermarkedBuffer({
      module,
      sourcePath,
      extension: outputExtension,
      buffer: watermarkedBuffer,
    });
  }

  throw createUnsupportedWatermarkError(sourceExtension);
}

async function markRecordSkipped({ module, entityId }) {
  const model = getPrismaModel(module);
  return model.update({
    where: {
      id: entityId,
    },
    data: {
      watermark_status: "SKIPPED",
      watermark_error_message: null,
      watermark_requested_at: null,
    },
  });
}

async function enqueueRecordWatermark({ module, entityId }) {
  const config = MODULE_CONFIG[module];
  if (!config) {
    throw new AppError("Target modul watermark tidak valid.", 422);
  }

  const record = await findRecord(module, entityId);
  if (!record || record.deleted_at) {
    throw new AppError("File target watermark tidak ditemukan.", 404);
  }

  const settings = await getSettings();
  const required = shouldApplyWatermark({ settings, record, module });
  if (!required) {
    await markRecordSkipped({ module, entityId });
    return findRecord(module, entityId);
  }

  const settingsHash = getWatermarkSettingsHash(settings);
  const alreadyApplied =
    record.watermark_status === "APPLIED" &&
    record.watermark_source_path === record.file &&
    record.watermark_settings_hash === settingsHash &&
    record.watermark_file;

  if (alreadyApplied) return record;

  const model = getPrismaModel(module);
  await model.update({
    where: {
      id: entityId,
    },
    data: {
      watermark_status: "PENDING",
      watermark_source_path: record.file,
      watermark_settings_hash: settingsHash,
      watermark_error_message: null,
      watermark_requested_at: new Date(),
    },
  });

  kickWatermarkWorker();
  return findRecord(module, entityId);
}

async function processPendingRecord({ module, entityId }) {
  const settings = await getSettings();
  const settingsHash = getWatermarkSettingsHash(settings);
  const record = await findRecord(module, entityId);
  if (!record || record.deleted_at) return null;

  if (!shouldApplyWatermark({ settings, record, module })) {
    return markRecordSkipped({ module, entityId });
  }

  const model = getPrismaModel(module);
  await model.update({
    where: {
      id: entityId,
    },
    data: {
      watermark_status: "PROCESSING",
      watermark_error_message: null,
    },
  });

  try {
    const watermarkedPath = await createWatermarkedFile({
      module,
      record,
      settings,
    });

    return model.update({
      where: {
        id: entityId,
      },
      data: {
        watermark_status: "APPLIED",
        watermark_file: watermarkedPath.storedPath,
        watermark_file_size_bytes: toSizeBytesBigInt(watermarkedPath.sizeBytes),
        watermark_source_path: record.file,
        watermark_settings_hash: settingsHash,
        watermark_error_message: null,
        watermark_applied_at: new Date(),
      },
    });
  } catch (error) {
    return model.update({
      where: {
        id: entityId,
      },
      data: {
        watermark_status:
          error?.code === "UNSUPPORTED" ? "UNSUPPORTED" : "FAILED",
        watermark_error_message:
          error instanceof Error
            ? error.message
            : "Watermark dokumen gagal diproses.",
      },
    });
  }
}

async function findNextPendingRecord() {
  for (const [module, config] of Object.entries(MODULE_CONFIG)) {
    const model = getPrismaModel(module);
    const record = await model.findFirst({
      where: {
        [config.fileField]: {
          not: null,
        },
        [config.deletedField]: null,
        watermark_status: "PENDING",
      },
      orderBy: {
        watermark_requested_at: "asc",
      },
      select: {
        id: true,
      },
    });

    if (record) return { module, entityId: record.id };
  }

  return null;
}

async function runWatermarkWorker() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;
  let hitBatchLimit = true;

  try {
    for (let index = 0; index < 100; index += 1) {
      const pendingRecord = await findNextPendingRecord();
      if (!pendingRecord) {
        hitBatchLimit = false;
        break;
      }
      await processPendingRecord(pendingRecord);
    }
  } finally {
    isWorkerRunning = false;
  }

  if (hitBatchLimit) {
    kickWatermarkWorker();
  }
}

function kickWatermarkWorker() {
  setImmediate(() => {
    runWatermarkWorker().catch((error) => {
      console.error("Watermark worker failed:", error);
    });
  });
}

function isWatermarkTargetEnabled({ module, settings }) {
  const targetModules = normalizeTargetModules(settings);
  return Boolean(settings?.is_enabled) && targetModules.includes(module);
}

async function scheduleExistingWatermarkJobs() {
  const settings = await getSettings();
  const settingsHash = getWatermarkSettingsHash(settings);
  const now = new Date();
  let scheduledCount = 0;

  for (const [module, config] of Object.entries(MODULE_CONFIG)) {
    const model = getPrismaModel(module);
    const isApplicable = isWatermarkTargetEnabled({ module, settings });

    if (isApplicable) {
      const scheduled = await model.updateMany({
        where: {
          [config.fileField]: {
            not: null,
          },
          [config.deletedField]: null,
        },
        data: {
          watermark_status: "PENDING",
          watermark_settings_hash: settingsHash,
          watermark_error_message: null,
          watermark_requested_at: now,
        },
      });
      scheduledCount += scheduled.count;
      continue;
    }

    await model.updateMany({
      where: {
        [config.fileField]: {
          not: null,
        },
        [config.deletedField]: null,
      },
      data: {
        watermark_status: "SKIPPED",
        watermark_error_message: null,
      },
    });
  }

  if (scheduledCount > 0) kickWatermarkWorker();
  return { scheduled_count: scheduledCount };
}

async function recoverPendingWatermarkJobs() {
  for (const module of Object.keys(MODULE_CONFIG)) {
    const model = getPrismaModel(module);
    await model.updateMany({
      where: {
        watermark_status: "PROCESSING",
      },
      data: {
        watermark_status: "PENDING",
      },
    });
  }

  kickWatermarkWorker();
}

async function getWatermarkQueueSummary() {
  const summary = {};

  for (const [module, config] of Object.entries(MODULE_CONFIG)) {
    const model = getPrismaModel(module);
    const grouped = await model.groupBy({
      by: ["watermark_status"],
      where: {
        [config.fileField]: {
          not: null,
        },
        [config.deletedField]: null,
      },
      _count: {
        _all: true,
      },
    });

    summary[module] = grouped.reduce((acc, item) => {
      acc[item.watermark_status] = item._count._all;
      return acc;
    }, {});
  }

  return summary;
}

function buildWatermarkMeta(req, record, module) {
  const statusKey = record?.watermark_status || "SKIPPED";
  const watermarkedUrl =
    statusKey === "APPLIED" && record?.watermark_file
      ? buildWatermarkedFileUrl(req, record.watermark_file, {
          module,
          entityId: record.id,
        })
      : null;

  return {
    status_key: statusKey,
    status_label: WATERMARK_LABELS[statusKey] || statusKey,
    applied: statusKey === "APPLIED" && Boolean(watermarkedUrl),
    source_path: record?.watermark_source_path || null,
    file_path: record?.watermark_file || null,
    file_url: watermarkedUrl,
    settings_hash: record?.watermark_settings_hash || null,
    error_message: record?.watermark_error_message || null,
    requested_at: record?.watermark_requested_at || null,
    applied_at: record?.watermark_applied_at || null,
  };
}

function resolveEffectiveFileUrl(req, record, originalUrl, module) {
  const watermark = buildWatermarkMeta(req, record, module);
  return watermark.applied && watermark.file_url ? watermark.file_url : originalUrl;
}

module.exports = {
  MODULE_CONFIG,
  WATERMARKED_PUBLIC_PREFIX,
  WATERMARKED_STORAGE_ROOT,
  WATERMARK_LABELS,
  buildWatermarkMeta,
  buildWatermarkedFileUrl,
  enqueueRecordWatermark,
  getWatermarkQueueSummary,
  recoverPendingWatermarkJobs,
  resolveEffectiveFileUrl,
  scheduleExistingWatermarkJobs,
};
