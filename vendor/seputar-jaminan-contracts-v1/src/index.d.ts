export type ContractError = {
  path: string;
  keyword: string;
  message: string;
};

export const CONTRACT_VERSION: 1;
export const INTEGRATION_HEADERS: Readonly<{
  institutionId: "X-SJ-Institution-Id";
  keyId: "X-SJ-Key-Id";
  timestamp: "X-SJ-Timestamp";
  nonce: "X-SJ-Nonce";
  contentSha256: "X-SJ-Content-SHA256";
  signature: "X-SJ-Signature";
}>;
export const EVENT_TYPES: readonly string[];
export const PUBLICATION_CATEGORIES: Readonly<Record<string, readonly string[]>>;
export const PUBLIC_ATTRIBUTE_VOCABULARIES: Readonly<{
  public_condition: readonly ["SANGAT_BAIK", "BAIK", "CUKUP", "PERLU_PERBAIKAN"];
  contour: readonly ["DATAR", "MIRING", "BERKONTUR"];
  road_access: readonly ["RODA_DUA", "MOBIL", "TRUK"];
  public_usage: readonly ["HUNIAN", "KOMERSIAL", "PERKANTORAN", "PERGUDANGAN", "INDUSTRI", "SERBAGUNA"];
  transmission: readonly ["MANUAL", "OTOMATIS"];
  fuel_type: readonly ["BENSIN", "DIESEL", "LISTRIK", "HIBRIDA", "GAS"];
}>;
export const DENIED_FIELD_NAMES: readonly string[];

export function canonicalJson(value: unknown): string;
export function sha256Hex(value: unknown): string;
export function payloadChecksum(payload: unknown): string;
export function createContentSha256(body: Buffer | string): string;
export function createSigningMessage(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  contentSha256: string;
}): string;
export function signIntegrationMessage(message: string, privateKey: unknown): string;
export function verifyIntegrationMessage(message: string, signature: string, publicKey: unknown): boolean;
export function validateSchema(schemaId: string, value: unknown): {
  valid: boolean;
  errors: ContractError[];
};
export function validateIntegrationEvent(event: unknown): {
  valid: boolean;
  errors: ContractError[];
};
export function assertValidIntegrationEvent<T>(event: T): T;
