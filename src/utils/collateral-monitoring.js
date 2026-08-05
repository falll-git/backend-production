const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcDateOnly(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  );
}

function addMonthsClamped(value, months) {
  const date = toUtcDateOnly(value);
  if (!date) return null;

  const targetMonth = date.getUTCMonth() + months;
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(
    Date.UTC(targetYear, normalizedMonth + 1, 0),
  ).getUTCDate();

  return new Date(
    Date.UTC(
      targetYear,
      normalizedMonth,
      Math.min(date.getUTCDate(), lastDay),
    ),
  );
}

function daysUntil(target, now = new Date()) {
  const targetDate = toUtcDateOnly(target);
  const today = toUtcDateOnly(now);
  if (!targetDate || !today) return null;
  return Math.round((targetDate.getTime() - today.getTime()) / DAY_MS);
}

function latestAppraisal(record = {}) {
  const reporterDate = toUtcDateOnly(record.reporter_appraisal_date);
  const expiryReviewDate = toUtcDateOnly(record.expiry_updated_at);

  if (
    expiryReviewDate &&
    (!reporterDate || expiryReviewDate.getTime() >= reporterDate.getTime())
  ) {
    return {
      source: "EXPIRY_UPDATE",
      date: expiryReviewDate,
    };
  }

  return {
    source: reporterDate ? "REPORTER" : null,
    date: reporterDate,
  };
}

function statusByCalendarWindow({
  dueDate,
  warningStartDate,
  now,
  missing,
  current,
  dueSoon,
  overdue,
}) {
  const due = toUtcDateOnly(dueDate);
  const warningStart = toUtcDateOnly(warningStartDate);
  const today = toUtcDateOnly(now);

  if (!due || !warningStart || !today) return missing;
  if (today.getTime() >= due.getTime()) return overdue;
  if (today.getTime() >= warningStart.getTime()) return dueSoon;
  return current;
}

function buildCollateralMonitoring(record = {}, now = new Date()) {
  const appraisal = latestAppraisal(record);
  const nextAppraisalDueDate = appraisal.date
    ? addMonthsClamped(appraisal.date, 12)
    : null;
  const appraisalWarningStartDate = nextAppraisalDueDate
    ? addMonthsClamped(nextAppraisalDueDate, -2)
    : null;
  const appraisalState = statusByCalendarWindow({
    dueDate: nextAppraisalDueDate,
    warningStartDate: appraisalWarningStartDate,
    now,
    missing: {
      status: "NOT_AVAILABLE",
      label: "Belum Ada Tinjauan",
    },
    current: { status: "CURRENT", label: "Aman" },
    dueSoon: { status: "DUE_SOON", label: "Segera Ditinjau Ulang" },
    overdue: { status: "OVERDUE", label: "Wajib Ditinjau Ulang" },
  });

  const hasExpiryDate = record.has_expiry_date === true;
  const expiryDate = hasExpiryDate ? toUtcDateOnly(record.expiry_date) : null;
  const expiryWarningStartDate = expiryDate
    ? addMonthsClamped(expiryDate, -3)
    : null;
  const expiryState = hasExpiryDate
    ? statusByCalendarWindow({
        dueDate: expiryDate,
        warningStartDate: expiryWarningStartDate,
        now,
        missing: {
          status: "NOT_SET",
          label: "Tanggal Expired Belum Diisi",
        },
        current: { status: "CURRENT", label: "Aman" },
        dueSoon: { status: "DUE_SOON", label: "Segera Berakhir" },
        overdue: { status: "EXPIRED", label: "Sudah Berakhir" },
      })
    : { status: "NOT_APPLICABLE", label: "Tidak Berlaku" };

  return {
    latest_appraisal_date: appraisal.date,
    latest_appraisal_source: appraisal.source,
    next_appraisal_due_date: nextAppraisalDueDate,
    appraisal_warning_start_date: appraisalWarningStartDate,
    appraisal_status: appraisalState.status,
    appraisal_status_label: appraisalState.label,
    appraisal_days_remaining: daysUntil(nextAppraisalDueDate, now),
    has_expiry_date: hasExpiryDate,
    expiry_date: expiryDate,
    expiry_warning_start_date: expiryWarningStartDate,
    expiry_status: expiryState.status,
    expiry_status_label: expiryState.label,
    expiry_days_remaining: hasExpiryDate ? daysUntil(expiryDate, now) : null,
  };
}

module.exports = {
  addMonthsClamped,
  buildCollateralMonitoring,
  daysUntil,
  latestAppraisal,
  toUtcDateOnly,
};
