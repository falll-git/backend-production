const { logger: defaultLogger } = require("../../system/logger");
const {
  recordClientErrorReport: defaultRecordClientErrorReport,
} = require("../../system/observability");

const CLIENT_ERROR_FIELD_MAP = Object.freeze({
  event_id: "client_event_id",
  event_type: "client_event_type",
  boundary: "client_boundary",
  error_name: "client_error_name",
  error_digest: "client_error_digest",
  route_group: "client_route_group",
  release: "client_release",
  related_request_id: "client_related_request_id",
  api_resource: "client_api_resource",
  response_status: "client_response_status",
  online: "client_online",
  occurred_at: "client_occurred_at",
});

function buildClientErrorLogFields(report, requestId) {
  const fields = {
    event: "frontend_error_reported",
    component: "frontend",
    request_id: requestId || null,
  };

  for (const [source, target] of Object.entries(CLIENT_ERROR_FIELD_MAP)) {
    if (report[source] !== undefined) fields[target] = report[source];
  }

  return fields;
}

function recordClientError(
  report,
  requestId,
  {
    logger = defaultLogger,
    recordClientErrorReport = defaultRecordClientErrorReport,
  } = {},
) {
  const fields = buildClientErrorLogFields(report, requestId);
  logger.error(fields, "Frontend error reported");
  recordClientErrorReport(fields);
  return fields;
}

module.exports = {
  CLIENT_ERROR_FIELD_MAP,
  buildClientErrorLogFields,
  recordClientError,
};
