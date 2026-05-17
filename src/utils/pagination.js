const PAGINATION_PROFILES = Object.freeze({
  SETUP: Object.freeze({ defaultLimit: 10, maxLimit: 100 }),
  TABLE: Object.freeze({ defaultLimit: 20, maxLimit: 100 }),
  HISTORY: Object.freeze({ defaultLimit: 20, maxLimit: 100 }),
  LOOKUP: Object.freeze({ defaultLimit: 50, maxLimit: 100 }),
});

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isAllLimit(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "all";
}

function resolvePagination(input = {}, options = {}) {
  const defaultLimit =
    options.defaultLimit ?? PAGINATION_PROFILES.TABLE.defaultLimit;
  const maxLimit = options.maxLimit ?? PAGINATION_PROFILES.TABLE.maxLimit;

  if (options.allowAll && isAllLimit(input.limit)) {
    return {
      enabled: false,
      all: true,
      page: 1,
      limit: null,
      skip: undefined,
      take: undefined,
    };
  }

  const page = toPositiveInteger(input.page, 1);
  const requestedLimit = toPositiveInteger(input.limit, defaultLimit);
  const limit = Math.min(requestedLimit, maxLimit);

  return {
    enabled: true,
    all: false,
    page,
    limit,
    skip: (page - 1) * limit,
    take: limit,
  };
}

function buildPaginationMeta(total, pagination) {
  const limit = pagination.limit || total || 1;

  return {
    total,
    page: pagination.page || 1,
    limit,
    lastPage: Math.max(1, Math.ceil(total / limit)),
  };
}

function paginateArray(items, pagination) {
  if (!pagination.enabled) {
    return {
      data: items,
      meta: null,
    };
  }

  const startIndex = pagination.skip;
  const endIndex = startIndex + pagination.limit;

  return {
    data: items.slice(startIndex, endIndex),
    meta: buildPaginationMeta(items.length, pagination),
  };
}

module.exports = {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  paginateArray,
  resolvePagination,
};
