export const CONTRACT_VERSION = 1;

export const INTEGRATION_HEADERS = Object.freeze({
  institutionId: "X-SJ-Institution-Id",
  keyId: "X-SJ-Key-Id",
  timestamp: "X-SJ-Timestamp",
  nonce: "X-SJ-Nonce",
  contentSha256: "X-SJ-Content-SHA256",
  signature: "X-SJ-Signature",
});

export const EVENT_TYPES = Object.freeze([
  "UPSERT_BPRS_PROFILE",
  "UPSERT_WHATSAPP_CONTACT",
  "REVOKE_WHATSAPP_CONTACT",
  "UPSERT_PUBLICATION_SNAPSHOT",
  "UNPUBLISH_PUBLICATION",
  "ARCHIVE_PUBLICATION",
  "REVOKE_MEDIA",
]);

export const PUBLICATION_CATEGORIES = Object.freeze({
  TANAH: Object.freeze(["TANAH"]),
  BANGUNAN: Object.freeze([
    "RUMAH",
    "RUKO",
    "KIOS",
    "KANTOR",
    "GUDANG",
    "PABRIK",
  ]),
  MESIN_PERALATAN: Object.freeze([
    "EXCAVATOR",
    "BULDOSER",
    "CRANE",
    "MESIN_MANUFAKTUR",
    "PERALATAN_KONSTRUKSI",
    "PERALATAN_PERTANIAN",
    "PERALATAN_MEDIS",
  ]),
  KENDARAAN: Object.freeze(["MOBIL", "MOTOR", "TRUK", "BUS"]),
});

export const PUBLIC_ATTRIBUTE_VOCABULARIES = Object.freeze({
  public_condition: Object.freeze([
    "SANGAT_BAIK",
    "BAIK",
    "CUKUP",
    "PERLU_PERBAIKAN",
  ]),
  contour: Object.freeze(["DATAR", "MIRING", "BERKONTUR"]),
  road_access: Object.freeze(["RODA_DUA", "MOBIL", "TRUK"]),
  public_usage: Object.freeze([
    "HUNIAN",
    "KOMERSIAL",
    "PERKANTORAN",
    "PERGUDANGAN",
    "INDUSTRI",
    "SERBAGUNA",
  ]),
  transmission: Object.freeze(["MANUAL", "OTOMATIS"]),
  fuel_type: Object.freeze(["BENSIN", "DIESEL", "LISTRIK", "HIBRIDA", "GAS"]),
});

export const DENIED_FIELD_NAMES = Object.freeze([
  "debtor_id",
  "cif",
  "nik",
  "npwp",
  "contract_id",
  "source_collateral_id",
  "certificate_number",
  "bpkb_number",
  "latitude",
  "longitude",
  "raw_data",
  "user_id",
  "division_id",
  "password",
  "jwt",
  "refresh_token",
  "api_key",
  "private_key",
  "database_url",
  "storage_path",
  "original_filename",
  "exif",
]);
