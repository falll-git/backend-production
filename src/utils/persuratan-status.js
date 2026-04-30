const MAIL_WORKFLOW_STATUS_BY_CODE = {
  0: "NEW",
  1: "IN_PROGRESS",
  2: "COMPLETED",
  3: "OVERDUE",
};

const MAIL_WORKFLOW_CODE_BY_STATUS = {
  NEW: 0,
  IN_PROGRESS: 1,
  COMPLETED: 2,
  OVERDUE: 3,
};

const OUTGOING_STATUS_BY_CODE = {
  0: "INACTIVE",
  1: "ACTIVE",
};

const OUTGOING_CODE_BY_STATUS = {
  INACTIVE: 0,
  ACTIVE: 1,
};

const DELIVERY_MEDIA_BY_LABEL = {
  email: "EMAIL",
  pos: "POS",
  kurir: "KURIR",
  langsung: "LANGSUNG",
};

const DELIVERY_MEDIA_LABEL_BY_STATUS = {
  EMAIL: "email",
  POS: "pos",
  KURIR: "kurir",
  LANGSUNG: "langsung",
};

function normalizeToken(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function normalizeMailWorkflowStatus(value, fallback = "NEW") {
  if (value === undefined || value === null || value === "") return fallback;

  if (typeof value === "number" || /^\d+$/.test(String(value).trim())) {
    return MAIL_WORKFLOW_STATUS_BY_CODE[Number(value)] || fallback;
  }

  const normalized = normalizeToken(value);
  return MAIL_WORKFLOW_CODE_BY_STATUS[normalized] !== undefined
    ? normalized
    : fallback;
}

function getMailWorkflowStatusCode(value) {
  const normalized = normalizeMailWorkflowStatus(value, "NEW");
  return MAIL_WORKFLOW_CODE_BY_STATUS[normalized] ?? 0;
}

function normalizeOutgoingStatus(value, fallback = "ACTIVE") {
  if (value === undefined || value === null || value === "") return fallback;

  if (typeof value === "number" || /^\d+$/.test(String(value).trim())) {
    return OUTGOING_STATUS_BY_CODE[Number(value)] || fallback;
  }

  const normalized = normalizeToken(value);
  return OUTGOING_CODE_BY_STATUS[normalized] !== undefined
    ? normalized
    : fallback;
}

function getOutgoingStatusCode(value) {
  const normalized = normalizeOutgoingStatus(value, "ACTIVE");
  return OUTGOING_CODE_BY_STATUS[normalized] ?? 1;
}

function normalizeDeliveryMedia(value) {
  if (value === undefined || value === null || value === "") return null;

  const raw = String(value).trim();
  const lower = raw.toLowerCase();
  if (DELIVERY_MEDIA_BY_LABEL[lower]) {
    return DELIVERY_MEDIA_BY_LABEL[lower];
  }

  const normalized = normalizeToken(raw);
  return DELIVERY_MEDIA_LABEL_BY_STATUS[normalized] ? normalized : null;
}

function getDeliveryMediaLabel(value) {
  const normalized = normalizeDeliveryMedia(value);
  if (!normalized) return value ?? null;
  return DELIVERY_MEDIA_LABEL_BY_STATUS[normalized];
}

module.exports = {
  getDeliveryMediaLabel,
  getMailWorkflowStatusCode,
  getOutgoingStatusCode,
  normalizeDeliveryMedia,
  normalizeMailWorkflowStatus,
  normalizeOutgoingStatus,
};
