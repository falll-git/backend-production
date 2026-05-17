const repository = require("./watermarkSettings.repository");
const { AppError } = require("../../utils/errors");
const {
  buildWatermarkAssetUrl,
  deleteWatermarkAsset,
  persistWatermarkImage,
} = require("../../utils/watermark-files");
const {
  getWatermarkQueueSummary,
  scheduleExistingWatermarkJobs,
} = require("./watermarkProcessor.service");

const WATERMARK_TYPES = ["TEXT", "IMAGE", "TEXT_IMAGE"];
const WATERMARK_POSITIONS = [
  "CENTER",
  "TOP_LEFT",
  "TOP_RIGHT",
  "BOTTOM_LEFT",
  "BOTTOM_RIGHT",
];
const TARGET_MODULES = [
  { key: "digital_archive", label: "Arsip Digital" },
  { key: "incoming_mail", label: "Surat Masuk" },
  { key: "outgoing_mail", label: "Surat Keluar" },
  { key: "memorandum", label: "Memorandum" },
];
const TEMPLATE_TOKENS = [
  { key: "{document_name}", label: "Nama Dokumen" },
  { key: "{document_number}", label: "Nomor Dokumen" },
  { key: "{username}", label: "Nama User" },
  { key: "{division}", label: "Divisi User" },
  { key: "{date}", label: "Tanggal Akses" },
  { key: "{time}", label: "Waktu Akses" },
];

const DEFAULT_SETTINGS = {
  is_enabled: false,
  target_modules: TARGET_MODULES.map((module) => module.key),
  watermark_type: "TEXT",
  text_template: "{document_name} - {username} - {date}",
  text_color: "#1F2937",
  text_opacity: 0.16,
  font_family: "Arial",
  font_size: 42,
  image_opacity: 0.16,
  image_scale: 0.35,
  position: "CENTER",
  repeat_pattern: true,
  rotation: -35,
  spacing_x: 280,
  spacing_y: 180,
};

function getOptions() {
  return {
    watermark_types: WATERMARK_TYPES.map((key) => ({
      key,
      label:
        key === "TEXT"
          ? "Teks"
          : key === "IMAGE"
            ? "Gambar"
            : "Teks dan Gambar",
    })),
    positions: WATERMARK_POSITIONS.map((key) => ({
      key,
      label: key
        .toLowerCase()
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
    })),
    target_modules: TARGET_MODULES,
    template_tokens: TEMPLATE_TOKENS,
  };
}

function normalizeTargetModules(value) {
  if (!Array.isArray(value)) return DEFAULT_SETTINGS.target_modules;

  const allowedModules = new Set(TARGET_MODULES.map((module) => module.key));
  return [
    ...new Set(
      value
        .map((item) => String(item || "").trim())
        .filter((item) => allowedModules.has(item)),
    ),
  ];
}

function serializeSettings(settings, req) {
  return {
    id: settings.id,
    is_enabled: settings.is_enabled,
    target_modules: settings.target_modules,
    watermark_type: settings.watermark_type,
    text_template: settings.text_template,
    text_color: settings.text_color,
    text_opacity: settings.text_opacity,
    font_family: settings.font_family,
    font_size: settings.font_size,
    image_path: settings.image_path,
    image_url: buildWatermarkAssetUrl(req, settings.image_path),
    image_original_name: settings.image_original_name,
    image_mime_type: settings.image_mime_type,
    image_size_bytes: settings.image_size_bytes,
    image_opacity: settings.image_opacity,
    image_scale: settings.image_scale,
    position: settings.position,
    repeat_pattern: settings.repeat_pattern,
    rotation: settings.rotation,
    spacing_x: settings.spacing_x,
    spacing_y: settings.spacing_y,
    updated_by: settings.updated_by,
    created_at: settings.created_at,
    updated_at: settings.updated_at,
    options: getOptions(),
  };
}

async function getOrCreateSettings() {
  const existing = await repository.findFirst();
  if (existing) return existing;

  return repository.create(DEFAULT_SETTINGS);
}

function normalizeText(value) {
  if (value === null) return null;
  if (value === undefined) return undefined;

  const normalized = String(value).trim();
  return normalized || null;
}

exports.getOptions = getOptions;

exports.getSettings = async (req) => {
  const settings = await getOrCreateSettings();
  return serializeSettings(settings, req);
};

exports.updateSettings = async (payload, requestUser, req) => {
  const settings = await getOrCreateSettings();
  const data = {
    updated_by: requestUser?.id || null,
  };

  const directFields = [
    "is_enabled",
    "watermark_type",
    "text_color",
    "text_opacity",
    "font_family",
    "font_size",
    "image_opacity",
    "image_scale",
    "position",
    "repeat_pattern",
    "rotation",
    "spacing_x",
    "spacing_y",
  ];

  for (const field of directFields) {
    if (payload[field] !== undefined) {
      data[field] = payload[field];
    }
  }

  if (payload.text_template !== undefined) {
    data.text_template = normalizeText(payload.text_template);
  }

  if (payload.target_modules !== undefined) {
    data.target_modules = normalizeTargetModules(payload.target_modules);
  }

  if (payload.clear_image) {
    data.image_path = null;
    data.image_original_name = null;
    data.image_mime_type = null;
    data.image_size_bytes = null;
  }

  const updated = await repository.update(settings.id, data);

  if (payload.clear_image && settings.image_path) {
    deleteWatermarkAsset(settings.image_path);
  }

  scheduleExistingWatermarkJobs().catch((error) => {
    console.error("Failed to schedule watermark jobs:", error);
  });

  return serializeSettings(updated, req);
};

exports.updateImage = async (file, requestUser, req) => {
  if (!file) {
    throw new AppError("Gambar watermark wajib diunggah.", 422);
  }

  const settings = await getOrCreateSettings();
  const stored = persistWatermarkImage(file);
  if (!stored) {
    throw new AppError("Gambar watermark tidak valid.", 422);
  }

  const updated = await repository.update(settings.id, {
    image_path: stored.storedPath,
    image_original_name: stored.fileName,
    image_mime_type: stored.mimeType,
    image_size_bytes: stored.sizeBytes,
    watermark_type:
      settings.watermark_type === "TEXT" ? "TEXT_IMAGE" : settings.watermark_type,
    updated_by: requestUser?.id || null,
  });

  if (settings.image_path && settings.image_path !== stored.storedPath) {
    deleteWatermarkAsset(settings.image_path);
  }

  scheduleExistingWatermarkJobs().catch((error) => {
    console.error("Failed to schedule watermark jobs:", error);
  });

  return serializeSettings(updated, req);
};

exports.deleteImage = async (requestUser, req) => {
  const settings = await getOrCreateSettings();
  const updated = await repository.update(settings.id, {
    image_path: null,
    image_original_name: null,
    image_mime_type: null,
    image_size_bytes: null,
    updated_by: requestUser?.id || null,
  });

  if (settings.image_path) {
    deleteWatermarkAsset(settings.image_path);
  }

  scheduleExistingWatermarkJobs().catch((error) => {
    console.error("Failed to schedule watermark jobs:", error);
  });

  return serializeSettings(updated, req);
};

exports.applyExistingFiles = async () => scheduleExistingWatermarkJobs();

exports.getQueueSummary = async () => getWatermarkQueueSummary();
