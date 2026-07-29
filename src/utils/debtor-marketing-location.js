const { AppError } = require("./errors");

const VISIT_LOCATION_AUDIT_FIELDS = [
  "visit_latitude",
  "visit_longitude",
  "visit_location_accuracy_m",
  "visit_location_recorded_at",
];
const VISIT_LOCATION_MAX_ACCURACY_M = 100;

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value || {}, field);
}

function toFiniteNumber(value, label) {
  if (value === null || value === "") {
    throw new AppError(`${label} harus berupa angka yang valid.`, 422);
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    throw new AppError(`${label} harus berupa angka yang valid.`, 422);
  }
  return numeric;
}

function validateCoordinate(value, { label, min, max }) {
  const numeric = toFiniteNumber(value, label);
  if (numeric < min || numeric > max) {
    throw new AppError(`${label} harus berada pada rentang ${min} sampai ${max}.`, 422);
  }
  return numeric;
}

function currentLocation(current = {}) {
  return Object.fromEntries(
    VISIT_LOCATION_AUDIT_FIELDS.map((field) => [field, current[field]]),
  );
}

function resolveVisitLocation({
  kind,
  payload = {},
  current = {},
  requireLocation = false,
  now = () => new Date(),
}) {
  const hasLatitude = hasOwn(payload, "visit_latitude");
  const hasLongitude = hasOwn(payload, "visit_longitude");
  const hasAccuracy = hasOwn(payload, "visit_location_accuracy_m");
  const hasClientTimestamp = hasOwn(payload, "visit_location_recorded_at");

  if (kind !== "VISIT_RESULT") {
    if (hasLatitude || hasLongitude || hasAccuracy || hasClientTimestamp) {
      throw new AppError(
        "Data lokasi hanya dapat disimpan untuk Hasil Kunjungan.",
        422,
      );
    }
    return {};
  }

  if (hasLatitude !== hasLongitude) {
    throw new AppError(
      "Latitude dan longitude kunjungan wajib dikirim berpasangan.",
      422,
    );
  }

  if (hasAccuracy && !(hasLatitude && hasLongitude)) {
    throw new AppError(
      "Akurasi lokasi hanya dapat dikirim bersama koordinat kunjungan.",
      422,
    );
  }

  if (!hasLatitude && !hasLongitude) {
    if (requireLocation) {
      throw new AppError(
        "Lokasi kunjungan wajib diambil sebelum Hasil Kunjungan disimpan.",
        422,
      );
    }
    return currentLocation(current);
  }
  if (!hasAccuracy) {
    throw new AppError(
      "Akurasi lokasi wajib dikirim bersama koordinat kunjungan.",
      422,
    );
  }

  const latitude = validateCoordinate(payload.visit_latitude, {
    label: "Latitude kunjungan",
    min: -90,
    max: 90,
  });
  const longitude = validateCoordinate(payload.visit_longitude, {
    label: "Longitude kunjungan",
    min: -180,
    max: 180,
  });
  const accuracy = toFiniteNumber(
    payload.visit_location_accuracy_m,
    "Akurasi lokasi",
  );

  if (accuracy < 0) {
    throw new AppError("Akurasi lokasi tidak boleh bernilai negatif.", 422);
  }
  if (accuracy > VISIT_LOCATION_MAX_ACCURACY_M) {
    throw new AppError(
      `Akurasi lokasi harus ${VISIT_LOCATION_MAX_ACCURACY_M} meter atau lebih baik.`,
      422,
    );
  }

  const recordedAt = now();
  if (!(recordedAt instanceof Date) || Number.isNaN(recordedAt.getTime())) {
    throw new TypeError("Backend location timestamp must be a valid Date.");
  }

  return {
    visit_latitude: latitude,
    visit_longitude: longitude,
    visit_location_accuracy_m: accuracy,
    visit_location_recorded_at: recordedAt,
  };
}

function nullableNumber(value) {
  if (value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function serializeVisitLocation(item = {}) {
  return {
    visit_latitude: nullableNumber(item.visit_latitude),
    visit_longitude: nullableNumber(item.visit_longitude),
    visit_location_accuracy_m: nullableNumber(item.visit_location_accuracy_m),
    visit_location_recorded_at: item.visit_location_recorded_at || null,
  };
}

module.exports = {
  VISIT_LOCATION_AUDIT_FIELDS,
  VISIT_LOCATION_MAX_ACCURACY_M,
  resolveVisitLocation,
  serializeVisitLocation,
};
