const crypto = require("node:crypto");
const path = require("node:path");
const sharp = require("sharp");

const prisma = require("../../config/prisma");
const { withDatabaseTransaction } = require("../../config/database-rls");
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
    central_ready: require('./mediaReadiness').isMediaReady(row),
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

async function createThumbnail(buffer) {
  if (buffer.length > MAX_BYTES) throw new AppError("Gambar terlalu besar.", 422);
  return sharp(buffer, { failOn: "warning", limitInputPixels: 100000000 })
    .rotate().resize(320, 320, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80, effort: 3 }).toBuffer();
}

exports.getContent = async (id, variant) => {
  if (variant !== undefined && variant !== "thumbnail") {
    throw new AppError("Pilihan pratinjau tidak valid.", 422);
  }
  const row = await prisma.sj_media_assets.findFirst({
    where: { id, revoked_at: null, state: { notIn: ["DELETED", "REVOKED"] } },
  });
  if (!row) throw new AppError("Gambar tidak ditemukan.", 404);
  const storage = createMediaStorage({
    ...process.env,
    SJ_MEDIA_STORAGE_PROVIDER: row.storage_backend,
  });
  const original = await storage.read(row.logical_object_key);
  // Authorization/RLS and revocation checks above apply to both representations.
  // Never overwrite the original or expose private media via a public optimizer.
  return { row, buffer: variant === "thumbnail" ? await createThumbnail(original) : original,
    mime: variant === "thumbnail" ? "image/webp" : row.detected_mime };
};

exports.list = async ({ purpose, paged, cursor:position, limit=20 } = {}) => {
  const cursor=require('./readCursor'),filter=['media',purpose||''];
  const rows=await prisma.sj_media_assets.findMany({
    where: {
      revoked_at: null,
      ...(purpose && PURPOSES.has(purpose) ? { purpose } : {}),
      state: { notIn: ["DELETED", "REVOKED"] },
      ...(paged?cursor.decode(position,filter):{}),
    },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    take: paged?limit+1:100,
  });
  return paged?cursor.page(rows,limit,filter,serialize):rows.map(serialize);
};

exports.getStatus = async (id) => {
  const row = await prisma.sj_media_assets.findUnique({ where: { id } });
  if (!row) throw new AppError("Gambar tidak ditemukan.", 404);
  const actions=require('./actionRead'),context=await actions.context(prisma,[row],'media');
  return {...serialize(row),action_availability:actions.media(row,context)};
};

async function getActiveMediaUsage(client, id) {
  const [publicationUses, profileUses, reference] = await Promise.all([
    client.sj_publication_version_media.count({
      where: {
        media_asset_id: id,
        publication_version: {
          OR: [
            { current_for_publication: { is: { state: { not: "ARCHIVED" } } } },
            { published_for_publication: { is: { state: { not: "ARCHIVED" } } } },
          ],
        },
      },
    }),
    client.sj_public_profiles.count({
      where: { logo_media_id: id, state: { not: "HIDDEN" } },
    }),
    client.$queryRaw`SELECT public.ruwang_arsip_sj_media_referenced(${id}::text) AS used`,
  ]);
  if(reference.length!==1||typeof reference[0].used!=='boolean')throw new AppError('Penggunaan gambar belum bisa diperiksa. Coba lagi.',503);
  return { publicationUses, profileUses, referenced:reference[0].used };
}

async function revokeInTransaction(client, id, payload, central) {
    await require('./workflowLock').lockContactReferences(client);
    const settings = await requireSettings(client);
    const authority = settings.review_authority || "local";
    if ((central && authority !== "central") || (!central && authority !== "local")) {
      throw new AppError(central
        ? "Pemeriksaan pusat belum diaktifkan."
        : "Pencabutan media hanya dapat diputuskan melalui Ruwang Control.", 409);
    }
    const row=await client.sj_media_assets.findUnique({where:{id}});
    if (!row) throw new AppError("Gambar tidak ditemukan.", 404);
    if (row.revoked_at) return serialize(row);
    const usage=await getActiveMediaUsage(client,id);
    if (usage.referenced) {
      throw new AppError("Gambar masih dipakai draf atau versi yang disetujui, atau pengirimannya belum selesai.", 409);
    }
    const now = new Date();
    const updated = await client.sj_media_assets.update({
      where: { id },
      data: { state: "REVOKED", revoked_at: now, rejection_code: payload.reason_code },
    });
    if (row.central_media_id) {
      if (!settings.sync_enabled) throw new AppError("Fitur sinkronisasi belum diaktifkan oleh administrator BPRS.", 409);
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
}

exports.revoke = async (id, payload) =>
  withDatabaseTransaction(async (client) => revokeInTransaction(client, id, payload, false));

exports.applyControlMediaLifecycle = async (client, id) =>
  revokeInTransaction(client, id, { reason_code: "OWNER_REQUEST" }, true);

exports.getActiveMediaUsage = getActiveMediaUsage;
exports.sanitizeImage = sanitizeImage;
exports.createThumbnail = createThumbnail;
