import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  DENIED_FIELD_NAMES,
  PUBLICATION_CATEGORIES,
} from "./constants.mjs";
import { payloadChecksum } from "./canonical-json.mjs";

const schemaDirectory = fileURLToPath(
  new URL("../schemas/v1/", import.meta.url),
);

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: true,
});
addFormats(ajv);

for (const name of fs.readdirSync(schemaDirectory)) {
  if (!name.endsWith(".schema.json")) {
    continue;
  }
  const schema = JSON.parse(
    fs.readFileSync(path.join(schemaDirectory, name), "utf8"),
  );
  ajv.addSchema(schema);
}

const validateEnvelope = ajv.getSchema(
  "https://seputarjaminan.com/contracts/v1/event-envelope.schema.json",
);

if (!validateEnvelope) {
  throw new Error("Schema event envelope V1 tidak ditemukan.");
}

export function formatAjvErrors(errors = []) {
  return errors.map((error) => ({
    path: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message || "Kontrak tidak valid.",
  }));
}

export function validateSchema(schemaId, value) {
  const validator = ajv.getSchema(schemaId);
  if (!validator) {
    throw new Error("Schema tidak terdaftar: " + schemaId);
  }
  const valid = validator(value);
  return {
    valid: Boolean(valid),
    errors: valid ? [] : formatAjvErrors(validator.errors),
  };
}

function findDeniedFields(value, currentPath = "") {
  const denied = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      denied.push(...findDeniedFields(item, currentPath + "/" + index));
    });
    return denied;
  }
  if (value === null || typeof value !== "object") {
    return denied;
  }
  for (const [key, item] of Object.entries(value)) {
    const itemPath = currentPath + "/" + key;
    if (DENIED_FIELD_NAMES.includes(key.toLowerCase())) {
      denied.push(itemPath);
    }
    denied.push(...findDeniedFields(item, itemPath));
  }
  return denied;
}

function validatePublication(payload) {
  const errors = [];
  const allowedSubcategories = PUBLICATION_CATEGORIES[payload.category] || [];
  if (!allowedSubcategories.includes(payload.subcategory)) {
    errors.push({
      path: "/payload/subcategory",
      keyword: "taxonomy",
      message: "Subkategori tidak sesuai kategori V1.",
    });
  }

  const positions = payload.media.map((media) => media.position);
  if (new Set(positions).size !== positions.length) {
    errors.push({
      path: "/payload/media",
      keyword: "uniquePosition",
      message: "Urutan media harus unik.",
    });
  }

  const coverCount = payload.media.filter((media) => media.is_cover).length;
  if (coverCount !== 1) {
    errors.push({
      path: "/payload/media",
      keyword: "singleCover",
      message: "Publikasi wajib memiliki tepat satu cover.",
    });
  }

  const attributeKeysByCategory = {
    TANAH: ["land_area_m2", "contour", "road_access"],
    BANGUNAN: ["land_area_m2", "building_area_m2", "floor_count", "public_usage"],
    MESIN_PERALATAN: [
      "brand_or_manufacturer",
      "model_or_type",
      "manufacture_year",
      "public_capacity",
      "public_condition",
    ],
    KENDARAAN: [
      "brand",
      "model_or_type",
      "manufacture_year",
      "transmission",
      "fuel_type",
      "mileage_km",
      "public_condition",
    ],
  };
  const allowedAttributeKeys = attributeKeysByCategory[payload.category] || [];
  const mismatchedAttributeKeys = Object.keys(payload.attributes).filter(
    (key) => !allowedAttributeKeys.includes(key),
  );
  if (mismatchedAttributeKeys.length > 0) {
    errors.push({
      path: "/payload/attributes",
      keyword: "categoryAttributes",
      message: "Atribut tidak sesuai kategori V1.",
    });
  }

  const confirmedAt = Date.parse(payload.availability_confirmed_at);
  const nextAt = Date.parse(payload.next_confirmation_at);
  const expectedNext = confirmedAt + 30 * 24 * 60 * 60 * 1000;
  if (nextAt !== expectedNext) {
    errors.push({
      path: "/payload/next_confirmation_at",
      keyword: "confirmationWindow",
      message: "Konfirmasi berikutnya harus tepat 30 hari setelah konfirmasi terakhir.",
    });
  }

  return errors;
}

function validateSemantics(event) {
  const errors = [];
  const payload = event.payload;

  if (
    Object.hasOwn(payload, "institution_id") &&
    payload.institution_id !== event.institution_id
  ) {
    errors.push({
      path: "/payload/institution_id",
      keyword: "institutionMatch",
      message: "Institution payload harus sama dengan envelope.",
    });
  }

  const aggregateIdFieldByEvent = {
    UPSERT_BPRS_PROFILE: "institution_id",
    UPSERT_WHATSAPP_CONTACT: "whatsapp_contact_id",
    REVOKE_WHATSAPP_CONTACT: "whatsapp_contact_id",
    UPSERT_PUBLICATION_SNAPSHOT: "publication_id",
    UNPUBLISH_PUBLICATION: "publication_id",
    ARCHIVE_PUBLICATION: "publication_id",
    REVOKE_MEDIA: "media_id",
  };
  const idField = aggregateIdFieldByEvent[event.event_type];
  if (idField && payload[idField] !== event.aggregate_id) {
    errors.push({
      path: "/payload/" + idField,
      keyword: "aggregateMatch",
      message: "ID payload harus sama dengan aggregate_id.",
    });
  }

  if (payloadChecksum(payload) !== event.payload_checksum) {
    errors.push({
      path: "/payload_checksum",
      keyword: "payloadChecksum",
      message: "Checksum payload tidak cocok.",
    });
  }

  for (const deniedPath of findDeniedFields(payload)) {
    errors.push({
      path: deniedPath,
      keyword: "deniedField",
      message: "Field internal dilarang pada kontrak publik.",
    });
  }

  if (event.event_type === "UPSERT_PUBLICATION_SNAPSHOT") {
    errors.push(...validatePublication(payload));
  }

  return errors;
}

export function validateIntegrationEvent(event) {
  if (!validateEnvelope(event)) {
    return {
      valid: false,
      errors: formatAjvErrors(validateEnvelope.errors),
    };
  }

  const errors = validateSemantics(event);
  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertValidIntegrationEvent(event) {
  const result = validateIntegrationEvent(event);
  if (!result.valid) {
    const error = new Error("Integration event tidak memenuhi kontrak V1.");
    error.contractErrors = result.errors;
    throw error;
  }
  return event;
}
