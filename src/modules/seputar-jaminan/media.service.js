const crypto = require("node:crypto");
const path = require("node:path");
const sharp = require("sharp");

const prisma = require("../../config/prisma");
const { AppError } = require("../../utils/errors");
const { createMediaStorage } = require("./mediaStorage");
const { createOutbox, requireSettings } = require("./seputarJaminan.service");

const MAX_BYTES = 10 * 1024 * 1024;
const PURPOSES = new Set(["PUBLICATION_IMAGE", "BPRS_PUBLIC_MARK"]);
const MIME_BY_FORMAT = Object.freeze({ jpeg: "image/jpeg", png: "image/png", webp: "image/webp" });

function safeName(value) {
  const extension = path.extname(String(value || "")).toLowerCase();
  const stem = path
    .basename(String(value || "gambar"), extension)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100) || "gambar";
  return `${stem}.webp`;
}

async function sanitizeImage(buffer) {
  let metadata;
  try {
    metadata = await sharp(buffer, { failOn: "warning" }).metadata();
  } catch {
    throw new AppError("Isi file bukan gambar JPEG, PNG, atau WebP yang valid.", 422);
  }
  if (!MIME_BY_FORMAT[metadata.format]) {
    throw new AppError("Format gambar harus JPEG, PNG, atau WebP.", 422);
  }
  if (!metadata.width || !metadata.height || metadata.width > 20000 || metadata.height > 20000) {
    throw new AppError("Dimensi gambar tidak valid atau terlalu besar.", 422);
  }
  const output = await sharp(buffer, { failOn: "warning", limitInputPixels: 100_000_000 })
    .rotate()
    .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 86, effort: 5 })
    .toBuffer({ resolveWithObject: true });
  if (output.data.length > MAX_BYTES) {
    throw new AppError("Hasil gambar melebihi batas 10 MB.", 413);
  }
  return {
    buffer: output.data,
    width: output.info.width,
    height: output.info.height,
    mime: "image/webp",
    sha256: crypto.createHash("sha256").update(output.data).digest("hex"),
  };
}

function serialize(row) {
  return {
    id: row.id,
    purpose: row.purpose,
    state: row.state,
    file_name: row.source_file_name_sanitized,
    mime_type: row.detected_mime,
    size_bytes: Number(row.size_bytes),
    width: row.width,
    height: row.height,
    central_ready: Boolean(row.central_media_id),
    preview_url: `/api/v1/seputar-jaminan/media/${row.id}/content`,
    created_at: row.created_at,
  };
}

exports.upload = async ({ file, purpose, user }) => {
  await requireSettings(prisma, "draft_enabled");
  if (!file?.buffer) throw new AppError("Pilih satu file gambar.", 422);
  if (!PURPOSES.has(purpose)) throw new AppError("Tujuan gambar tidak valid.", 422);
  const processed = await sanitizeImage(file.buffer);
  const id = crypto.randomUUID();
  const logicalKey = `${user.division_id}/${new Date().getUTCFullYear()}/${id}.webp`;
  const storage = createMediaStorage();
  await storage.put(logicalKey, processed.buffer);
  try {
    const row = await prisma.sj_media_assets.create({
      data: {
        id,
        owner_division_id: user.division_id,
        purpose,
        logical_object_key: logicalKey,
        storage_backend:
          String(process.env.SJ_MEDIA_STORAGE_PROVIDER || "FILESYSTEM").toUpperCase() ===
          "S3_COMPATIBLE"
            ? "S3_COMPATIBLE"
            : "FILESYSTEM",
        source_file_name_sanitized: safeName(file.originalname),
        detected_mime: processed.mime,
        size_bytes: BigInt(processed.buffer.length),
        width: processed.width,
        height: processed.height,
        sha256: processed.sha256,
        state: "UPLOADED",
        created_by: user.id,
      },
    });
    return serialize(row);
  } catch (error) {
    await storage.remove(logicalKey).catch(() => {});
    throw error;
  }
};

exports.getContent = async (id) => {
  const row = await prisma.sj_media_assets.findFirst({
    where: { id, revoked_at: null, state: { notIn: ["DELETED", "REVOKED"] } },
  });
  if (!row) throw new AppError("Gambar tidak ditemukan.", 404);
  const storage = createMediaStorage({
    ...process.env,
    SJ_MEDIA_STORAGE_PROVIDER: row.storage_backend,
  });
  return { row, buffer: await storage.read(row.logical_object_key) };
};

exports.list = async ({ purpose } = {}) =>
  (await prisma.sj_media_assets.findMany({
    where: {
      revoked_at: null,
      ...(purpose && PURPOSES.has(purpose) ? { purpose } : {}),
      state: { notIn: ["DELETED", "REVOKED"] },
    },
    orderBy: { created_at: "desc" },
    take: 100,
  })).map(serialize);

exports.getStatus = async (id) => {
  const row = await prisma.sj_media_assets.findUnique({ where: { id } });
  if (!row) throw new AppError("Gambar tidak ditemukan.", 404);
  return serialize(row);
};

exports.revoke = async (id, payload) =>
  prisma.$transaction(async (client) => {
    const [used, profileUsed, row] = await Promise.all([
      client.sj_publication_version_media.count({ where: { media_asset_id: id } }),
      client.sj_public_profiles.count({ where: { logo_media_id: id } }),
      client.sj_media_assets.findUnique({ where: { id } }),
    ]);
    if (used > 0 || profileUsed > 0) {
      throw new AppError("Gambar masih dipakai. Lepaskan dari katalog atau profil terlebih dahulu.", 409);
    }
    if (!row) throw new AppError("Gambar tidak ditemukan.", 404);
    if (row.revoked_at) return serialize(row);
    const now = new Date();
    const updated = await client.sj_media_assets.update({
      where: { id },
      data: { state: "REVOKED", revoked_at: now, rejection_code: payload.reason_code },
    });
    if (row.central_media_id) {
      const settings = await requireSettings(client, "sync_enabled");
      await createOutbox(client, settings, {
        eventType: "REVOKE_MEDIA",
        aggregateType: "MEDIA",
        aggregateId: row.central_media_id,
        aggregateVersion: 1,
        payload: {
          media_id: row.central_media_id,
          institution_id: settings.institution_id,
          reason_code: payload.reason_code,
          revoked_at: now.toISOString(),
        },
        priority: 5,
      });
    }
    return serialize(updated);
  });

exports.sanitizeImage = sanitizeImage;
