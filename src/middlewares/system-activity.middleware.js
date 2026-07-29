const {
  withSystemDatabaseClient,
} = require("../config/database-rls");
const { verifyAccessToken } = require("../utils/jwt");
const {
  buildActivityPayload,
  extractSafeResponseContext,
  shouldTrackRequest,
} = require("../utils/system-activity");
const { logger } = require("../system/logger");

function readActorIdFromBearer(req) {
  const header = req.headers?.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;

  try {
    return verifyAccessToken(header.slice(7))?.id || null;
  } catch {
    return null;
  }
}

function resolveActorId(req, responseContext) {
  return (
    req.user?.id ||
    (req.path?.endsWith("/login") ? responseContext.actor_id : null) ||
    readActorIdFromBearer(req)
  );
}

module.exports = function systemActivity(req, res, next) {
  let responseContext = {};
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    responseContext = extractSafeResponseContext(body);
    return originalJson(body);
  };

  res.once("finish", () => {
    if (
      !shouldTrackRequest({
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
      })
    ) {
      return;
    }

    const actorId = resolveActorId(req, responseContext);
    if (!actorId) return;

    const payload = buildActivityPayload({
      actor_id: actorId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      requestId: req.requestId,
      userAgent: req.headers?.["user-agent"] || null,
      responseContext,
    });

    setImmediate(async () => {
      try {
        await withSystemDatabaseClient(async (client) => {
          if (req.requestId) {
            const existing = await client.system_activity_logs.findFirst({
              where: { request_id: req.requestId },
              select: { id: true },
            });
            if (existing) return;
          }

          await client.system_activity_logs.create({ data: payload });
        });
      } catch (error) {
        logger.error(
          {
            event: "system_activity_record_failed",
            component: "system_activity",
            request_id: req.requestId || null,
            request_method: req.method || null,
            request_path: String(req.originalUrl || "").split("?")[0],
            err: error,
          },
          "System activity record failed",
        );
      }
    });
  });

  return next();
};
