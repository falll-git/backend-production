const MANUAL_COLLATERAL_FIELDS = [
  "has_expiry_date",
  "expiry_date",
  "expiry_note",
  "expiry_updated_by",
  "expiry_updated_at",
];

function normalizeIdentity(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized || null;
}

function collateralImportKey(collateralNumber, facilityNumber) {
  return `${normalizeIdentity(collateralNumber) || ""}::${normalizeIdentity(facilityNumber) || ""}`;
}

function hasManualCollateralData(collateral = {}) {
  return (
    collateral.has_expiry_date === true ||
    (collateral.expiry_date !== undefined && collateral.expiry_date !== null) ||
    (collateral.expiry_note !== undefined && collateral.expiry_note !== null) ||
    (collateral.expiry_updated_by !== undefined &&
      collateral.expiry_updated_by !== null) ||
    (collateral.expiry_updated_at !== undefined &&
      collateral.expiry_updated_at !== null)
  );
}

function resolveCollateralImportCandidate(
  candidates = [],
  { collateralNumber, facilityNumber, debtorId, excludedFallbackIds = new Set() } = {},
) {
  const normalizedCollateralNumber = normalizeIdentity(collateralNumber);
  const normalizedFacilityNumber = normalizeIdentity(facilityNumber);
  const normalizedDebtorId = normalizeIdentity(debtorId);
  const excludedIds =
    excludedFallbackIds instanceof Set
      ? excludedFallbackIds
      : new Set(excludedFallbackIds || []);

  if (!normalizedCollateralNumber) {
    return { collateral: null, match_type: "NONE" };
  }

  const sameNumber = candidates.filter(
    (candidate) =>
      candidate &&
      !candidate.deleted_at &&
      normalizeIdentity(candidate.collateral_number) === normalizedCollateralNumber,
  );

  const exact = sameNumber.find(
    (candidate) =>
      normalizeIdentity(candidate.facility_number) === normalizedFacilityNumber &&
      (!normalizedDebtorId ||
        !candidate.debtor_id ||
        normalizeIdentity(candidate.debtor_id) === normalizedDebtorId),
  );
  if (exact) return { collateral: exact, match_type: "EXACT" };

  if (!normalizedDebtorId) {
    return { collateral: null, match_type: "NONE" };
  }

  const sameDebtor = sameNumber.filter(
    (candidate) =>
      normalizeIdentity(candidate.debtor_id) === normalizedDebtorId &&
      !excludedIds.has(candidate.id),
  );

  if (sameDebtor.length === 1) {
    return { collateral: sameDebtor[0], match_type: "FACILITY_CHANGED" };
  }

  // When several facility links exist, only reuse the single row that owns
  // manual metadata. Otherwise the import must not guess which link changed.
  const manualCandidates = sameDebtor.filter(hasManualCollateralData);
  if (manualCandidates.length === 1) {
    return {
      collateral: manualCandidates[0],
      match_type: "FACILITY_CHANGED_MANUAL_OWNER",
    };
  }

  return {
    collateral: null,
    match_type: sameDebtor.length > 1 ? "AMBIGUOUS" : "NONE",
  };
}

function buildCollateralImportUpdateData(existing = {}, importedData = {}, userId = null) {
  const data = {
    ...importedData,
    updated_by: userId || null,
  };

  for (const field of MANUAL_COLLATERAL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(existing, field)) {
      data[field] = existing[field] ?? null;
    }
  }

  return data;
}

module.exports = {
  MANUAL_COLLATERAL_FIELDS,
  buildCollateralImportUpdateData,
  collateralImportKey,
  resolveCollateralImportCandidate,
};
