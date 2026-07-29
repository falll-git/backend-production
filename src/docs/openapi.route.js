const swaggerUi = require("swagger-ui-express");
const { buildOpenApiSpec } = require("./openapi");
const { API_VERSION_PATH } = require("../utils/api-version");

function readBooleanEnv(key, fallback) {
  const value = process.env[key];
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(
    String(value).trim().toLowerCase(),
  );
}

function mountOpenApi(app) {
  if (!readBooleanEnv("API_DOCS_ENABLED", true)) return;

  const spec = buildOpenApiSpec();
  app.get(`${API_VERSION_PATH}/openapi.json`, (req, res) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.json(spec);
  });
  app.use(
    `${API_VERSION_PATH}/docs`,
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: "Ruang Arsip API Documentation",
      swaggerOptions: {
        displayRequestDuration: true,
        filter: true,
        persistAuthorization: false,
        tryItOutEnabled: false,
      },
    }),
  );
}

module.exports = { mountOpenApi };
