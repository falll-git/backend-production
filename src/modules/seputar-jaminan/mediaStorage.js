const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");

const { resolvePathInsideRoot } = require("../../utils/safe-file-path");

function storageRoot(env = process.env) {
  return path.resolve(
    env.SJ_MEDIA_FILESYSTEM_ROOT ||
      path.join(env.UPLOAD_DIR || path.join(process.cwd(), "storage"), "seputar-jaminan-public"),
  );
}

function keySegments(key) {
  const segments = String(key || "").split("/");
  if (segments.length < 2 || segments.some((segment) => !segment)) {
    throw new Error("Kunci object storage tidak valid.");
  }
  return segments;
}

class FilesystemMediaStorage {
  constructor(root = storageRoot()) {
    this.root = root;
  }

  resolve(key) {
    const resolved = resolvePathInsideRoot(this.root, ...keySegments(key));
    if (!resolved) throw new Error("Kunci object storage keluar dari root.");
    return resolved;
  }

  async put(key, body) {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, body, { flag: "wx", mode: 0o600 });
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  }

  async read(key) {
    return fs.readFile(this.resolve(key));
  }

  async remove(key) {
    await fs.rm(this.resolve(key), { force: true });
  }
}

class S3CompatibleMediaStorage {
  constructor(env = process.env) {
    this.bucket = env.SJ_MEDIA_S3_BUCKET;
    this.prefix = String(env.SJ_MEDIA_S3_PREFIX || "ruwang/seputar-jaminan").replace(/^\/+|\/+$/g, "");
    if (!this.bucket || !env.SJ_MEDIA_S3_ENDPOINT || !env.SJ_MEDIA_S3_REGION) {
      throw new Error("Konfigurasi storage bucket Seputar Jaminan belum lengkap.");
    }
    this.client = new S3Client({
      endpoint: env.SJ_MEDIA_S3_ENDPOINT,
      region: env.SJ_MEDIA_S3_REGION,
      forcePathStyle: String(env.SJ_MEDIA_S3_FORCE_PATH_STYLE || "true") === "true",
      credentials:
        env.SJ_MEDIA_S3_ACCESS_KEY_ID && env.SJ_MEDIA_S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.SJ_MEDIA_S3_ACCESS_KEY_ID,
              secretAccessKey: env.SJ_MEDIA_S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  objectKey(key) {
    keySegments(key);
    return `${this.prefix}/${key}`;
  }

  async put(key, body) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key), Body: body }),
    );
  }

  async read(key) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
    );
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async remove(key) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
    );
  }
}

function createMediaStorage(env = process.env) {
  const provider = String(env.SJ_MEDIA_STORAGE_PROVIDER || "FILESYSTEM").toUpperCase();
  if (provider === "FILESYSTEM") return new FilesystemMediaStorage(storageRoot(env));
  if (provider === "S3_COMPATIBLE") return new S3CompatibleMediaStorage(env);
  throw new Error("SJ_MEDIA_STORAGE_PROVIDER harus FILESYSTEM atau S3_COMPATIBLE.");
}

module.exports = {
  FilesystemMediaStorage,
  S3CompatibleMediaStorage,
  createMediaStorage,
  storageRoot,
};
