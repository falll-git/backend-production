const Joi = require("joi");

const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]+$/;
const SAFE_RESOURCE = /^[a-z0-9-]+$/;
const CLIENT_ERROR_NAMES = Object.freeze([
  "AbortError",
  "AggregateError",
  "ApiRequestError",
  "ChunkLoadError",
  "Error",
  "EvalError",
  "InvalidStateError",
  "NetworkError",
  "NotAllowedError",
  "NotFoundError",
  "OperationError",
  "QuotaExceededError",
  "RangeError",
  "ReferenceError",
  "SecurityError",
  "SyntaxError",
  "TimeoutError",
  "TypeError",
  "URIError",
]);

const errorDigestSchema = Joi.string()
  .trim()
  .min(1)
  .max(128)
  .pattern(SAFE_IDENTIFIER);

exports.reportSchema = Joi.object({
  event_id: Joi.string().guid({ version: ["uuidv4"] }).required(),
  event_type: Joi.string()
    .valid(
      "render_error",
      "unhandled_error",
      "unhandled_rejection",
      "api_error",
    )
    .required(),
  boundary: Joi.string()
    .valid("route", "dashboard", "global", "browser", "api")
    .required(),
  error_name: Joi.string()
    .valid(...CLIENT_ERROR_NAMES)
    .required(),
  error_digest: Joi.when("boundary", {
    is: Joi.valid("route", "dashboard", "global"),
    then: errorDigestSchema.optional(),
    otherwise: Joi.forbidden(),
  }),
  route_group: Joi.string()
    .valid("authentication", "dashboard", "public", "unknown")
    .required(),
  release: Joi.string()
    .trim()
    .min(1)
    .max(100)
    .pattern(SAFE_IDENTIFIER)
    .optional(),
  related_request_id: Joi.string()
    .trim()
    .min(8)
    .max(128)
    .pattern(SAFE_IDENTIFIER)
    .optional(),
  api_resource: Joi.string()
    .trim()
    .min(1)
    .max(80)
    .pattern(SAFE_RESOURCE)
    .optional(),
  response_status: Joi.number().integer().min(0).max(599).optional(),
  online: Joi.boolean().required(),
  occurred_at: Joi.string().isoDate().required(),
}).unknown(false);

exports.SAFE_IDENTIFIER = SAFE_IDENTIFIER;
exports.SAFE_RESOURCE = SAFE_RESOURCE;
exports.CLIENT_ERROR_NAMES = CLIENT_ERROR_NAMES;
