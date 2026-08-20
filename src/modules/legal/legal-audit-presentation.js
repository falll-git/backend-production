const LEGAL_AUDIT_ENTITY_ALIASES = Object.freeze({
  LEGAL_NOTARY_PROGRESS: ["LEGAL_NOTARY_PROGRESS", "legal_notary_progress"],
  LEGAL_INSURANCE_PROGRESS: [
    "LEGAL_INSURANCE_PROGRESS",
    "legal_insurance_progress",
  ],
  LEGAL_KJPP_PROGRESS: ["LEGAL_KJPP_PROGRESS", "legal_kjpp_progress"],
  LEGAL_CLAIM: ["LEGAL_CLAIM", "legal_claims"],
  LEGAL_DEPOSIT: ["LEGAL_DEPOSIT", "legal_deposits"],
  LEGAL_DEPOSIT_TRANSACTION: [
    "LEGAL_DEPOSIT_TRANSACTION",
    "legal_deposit_transactions",
  ],
});

const INTERNAL_AUDIT_SOURCE_MARKERS = ["SEED", "FIXTURE"];

function normalizedIdentifier(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeLegalAuditEntityType(value) {
  const normalized = normalizedIdentifier(value);
  if (!normalized) return normalized;

  for (const [canonical, aliases] of Object.entries(
    LEGAL_AUDIT_ENTITY_ALIASES,
  )) {
    if (aliases.some((alias) => normalizedIdentifier(alias) === normalized)) {
      return canonical;
    }
  }

  return normalized;
}

function legalAuditEntityTypeFilter(value) {
  const canonical = normalizeLegalAuditEntityType(value);
  return {
    in: LEGAL_AUDIT_ENTITY_ALIASES[canonical] || [canonical],
  };
}

function isInternalLegalAuditSource(value) {
  const normalized = normalizedIdentifier(value);
  return INTERNAL_AUDIT_SOURCE_MARKERS.some((marker) =>
    normalized.includes(marker),
  );
}

function normalizeLegalAuditSource(value) {
  const normalized = normalizedIdentifier(value);
  if (!normalized) return normalized;
  return isInternalLegalAuditSource(normalized) ? "SYSTEM" : normalized;
}

function legalAuditSourceFilter(value) {
  const normalized = normalizeLegalAuditSource(value);
  if (normalized !== "SYSTEM") return { equals: normalized };

  return {
    OR: [
      { source: "SYSTEM" },
      ...INTERNAL_AUDIT_SOURCE_MARKERS.map((marker) => ({
        source: { contains: marker, mode: "insensitive" },
      })),
    ],
  };
}

function sanitizeLegalAuditTitle(value, source) {
  if (isInternalLegalAuditSource(source)) return null;
  const title = String(value || "").trim();
  return title || null;
}

module.exports = {
  isInternalLegalAuditSource,
  legalAuditEntityTypeFilter,
  legalAuditSourceFilter,
  normalizeLegalAuditEntityType,
  normalizeLegalAuditSource,
  sanitizeLegalAuditTitle,
};
