const { AppError } = require("./errors");

const DISPOSITION_STATUS = Object.freeze({
  NEW: "NEW",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  FORWARDED: "FORWARDED",
});

function normalizeDispositionStatus(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function getDispositionCapabilities(value) {
  const status = normalizeDispositionStatus(value);

  return {
    can_start: status === DISPOSITION_STATUS.NEW,
    can_complete: status === DISPOSITION_STATUS.IN_PROGRESS,
    can_redispose: status === DISPOSITION_STATUS.IN_PROGRESS,
  };
}

function assertDispositionTransition(currentValue, targetValue) {
  const currentStatus = normalizeDispositionStatus(currentValue);
  const targetStatus = normalizeDispositionStatus(targetValue);

  if (
    ![DISPOSITION_STATUS.IN_PROGRESS, DISPOSITION_STATUS.COMPLETED].includes(
      targetStatus,
    )
  ) {
    throw new AppError("Status disposisi tidak valid.", 400);
  }

  if (currentStatus === DISPOSITION_STATUS.FORWARDED) {
    throw new AppError(
      "Disposisi yang sudah diteruskan tidak dapat diperbarui.",
      400,
    );
  }

  if (currentStatus === DISPOSITION_STATUS.COMPLETED) {
    throw new AppError(
      "Disposisi yang sudah selesai tidak dapat diperbarui.",
      400,
    );
  }

  if (
    targetStatus === DISPOSITION_STATUS.IN_PROGRESS &&
    currentStatus !== DISPOSITION_STATUS.NEW
  ) {
    throw new AppError("Hanya disposisi baru yang dapat mulai diproses.", 400);
  }

  if (
    targetStatus === DISPOSITION_STATUS.COMPLETED &&
    currentStatus !== DISPOSITION_STATUS.IN_PROGRESS
  ) {
    throw new AppError(
      "Mulai proses terlebih dahulu sebelum menandai selesai.",
      400,
    );
  }

  return targetStatus;
}

function assertDispositionCanRedispose(value) {
  const status = normalizeDispositionStatus(value);

  if (status === DISPOSITION_STATUS.NEW) {
    throw new AppError(
      "Mulai proses terlebih dahulu sebelum meneruskan disposisi.",
      400,
    );
  }

  if (status === DISPOSITION_STATUS.FORWARDED) {
    throw new AppError(
      "Disposisi yang sudah diteruskan tidak dapat diteruskan kembali.",
      400,
    );
  }

  if (status === DISPOSITION_STATUS.COMPLETED) {
    throw new AppError(
      "Disposisi yang sudah selesai tidak dapat diteruskan.",
      400,
    );
  }

  if (status !== DISPOSITION_STATUS.IN_PROGRESS) {
    throw new AppError("Status disposisi tidak dapat diteruskan.", 400);
  }

  return status;
}

module.exports = {
  DISPOSITION_STATUS,
  assertDispositionCanRedispose,
  assertDispositionTransition,
  getDispositionCapabilities,
  normalizeDispositionStatus,
};
