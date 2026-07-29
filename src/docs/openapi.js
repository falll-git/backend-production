const packageJson = require("../../package.json");
const joiToSwagger = require("joi-to-swagger");
const apiModules = require("../routes/api-modules");
const { API_VERSION, API_VERSION_PATH } = require("../utils/api-version");

const PUBLIC_AUTH_OPERATIONS = new Set([
  "post /auth/login",
  "post /auth/forgot-password",
  "post /auth/set-password/verify",
  "post /auth/set-password",
  "post /auth/reset-password/verify",
  "post /auth/reset-password",
  "post /client-errors",
]);

function toOpenApiPath(expressPath) {
  if (expressPath === "/") return "/";

  return String(expressPath)
    .replace(/:([A-Za-z0-9_]+)(?:\([^)]*\))?\??/g, "{$1}")
    .replace(/\/$/, "") || "/";
}

function joinPaths(basePath, routePath) {
  const suffix = routePath === "/" ? "" : routePath;
  return `${basePath}${suffix}` || "/";
}

function routeEntries(apiModule) {
  const entries = [];

  for (const layer of apiModule.router.stack || []) {
    if (!layer.route) continue;

    const routePaths = Array.isArray(layer.route.path)
      ? layer.route.path
      : [layer.route.path];
    const methods = Object.keys(layer.route.methods || {}).filter(
      (method) => layer.route.methods[method],
    );
    const validation = (layer.route.stack || [])
      .map((routeLayer) => routeLayer.handle?.validation)
      .find(Boolean);

    for (const routePath of routePaths) {
      for (const method of methods) {
        entries.push({
          expressPath: String(routePath),
          method: method.toLowerCase(),
          path: joinPaths(apiModule.path, toOpenApiPath(routePath)),
          tag: apiModule.tag,
          validation,
        });
      }
    }
  }

  return entries;
}

function operationId(method, tag, routePath) {
  return `${method}_${tag}_${routePath}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function pathParameters(routePath) {
  return Array.from(routePath.matchAll(/\{([A-Za-z0-9_]+)\}/g)).map(
    ([, name]) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
    }),
  );
}

function securityFor(method, routePath) {
  const key = `${method} ${routePath}`;
  if (PUBLIC_AUTH_OPERATIONS.has(key)) return [];
  if (key === "post /auth/refresh") return [{ refreshCookie: [] }];
  if (key === "post /auth/logout") {
    return [{ bearerAuth: [] }, { refreshCookie: [] }, {}];
  }
  return [{ bearerAuth: [] }];
}

function validationSchema(validation) {
  if (!validation?.schema) return null;

  try {
    return joiToSwagger(validation.schema).swagger;
  } catch {
    return null;
  }
}

function requestBodyFor(method, validation, routePath) {
  if (!["post", "put", "patch"].includes(method)) return undefined;

  const schema =
    validation?.source === "body" ? validationSchema(validation) : null;
  const requestSchema = schema || {
    type: "object",
    additionalProperties: true,
    description:
      "Endpoint ini tidak mengekspos metadata schema terstruktur. Lihat respons 422 untuk kesalahan validasi.",
  };

  const content = {
    "application/json": { schema: requestSchema },
  };
  if (routePath !== "/client-errors") {
    content["multipart/form-data"] = { schema: requestSchema };
  }

  return {
    required: routePath === "/client-errors",
    content,
  };
}

function validationParameters(validation) {
  if (!validation || !["query", "params"].includes(validation.source)) {
    return [];
  }

  const schema = validationSchema(validation);
  const properties = schema?.properties || {};
  const required = new Set(schema?.required || []);

  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: validation.source === "params" ? "path" : "query",
    required: validation.source === "params" || required.has(name),
    schema: propertySchema,
  }));
}

function standardResponses(method) {
  const responses = {
    200: {
      description: "Permintaan berhasil.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/SuccessResponse" },
        },
      },
    },
    400: { $ref: "#/components/responses/BadRequest" },
    401: { $ref: "#/components/responses/Unauthorized" },
    403: { $ref: "#/components/responses/Forbidden" },
    404: { $ref: "#/components/responses/NotFound" },
    409: { $ref: "#/components/responses/Conflict" },
    422: { $ref: "#/components/responses/ValidationError" },
    429: { $ref: "#/components/responses/RateLimited" },
    500: { $ref: "#/components/responses/InternalError" },
    503: { $ref: "#/components/responses/ServiceUnavailable" },
  };

  if (method === "post") {
    responses[201] = {
      description: "Resource berhasil dibuat.",
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/SuccessResponse" },
        },
      },
    };
  }

  return responses;
}

function errorResponse(description) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorResponse" },
      },
    },
  };
}

function buildOpenApiSpec() {
  const paths = {
    "/": {
      get: {
        tags: ["System"],
        summary: "Informasi versi API",
        operationId: "get_api_information",
        security: [],
        responses: standardResponses("get"),
      },
    },
    "/health": {
      get: {
        tags: ["System"],
        summary: "Liveness probe",
        description:
          "Memastikan proses HTTP hidup. Endpoint ini tidak memeriksa dependency.",
        operationId: "get_liveness",
        security: [],
        responses: standardResponses("get"),
      },
    },
    "/ready": {
      get: {
        tags: ["System"],
        summary: "Readiness probe",
        description:
          "Memeriksa database, storage, rate-limit store, cache, queue SLIK, heartbeat watermark worker, dan observability. Mengembalikan 503 hanya jika dependency wajib tidak siap atau instance sedang drain; dependency background opsional dilaporkan sebagai degraded.",
        operationId: "get_readiness",
        security: [],
        responses: {
          ...standardResponses("get"),
          503: { $ref: "#/components/responses/ServiceUnavailable" },
        },
      },
    },
  };

  for (const apiModule of apiModules) {
    for (const entry of routeEntries(apiModule)) {
      paths[entry.path] ||= {};
      const requestBody = requestBodyFor(
        entry.method,
        entry.validation,
        entry.path,
      );
      const parameters = [
        ...pathParameters(entry.path),
        ...validationParameters(entry.validation),
        ...(entry.path === "/client-errors"
          ? [
              {
                name: "X-Client-Error-Report",
                in: "header",
                required: true,
                schema: { type: "string", const: "1" },
              },
            ]
          : []),
      ].filter(
        (parameter, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.name === parameter.name && candidate.in === parameter.in,
          ) === index,
      );
      paths[entry.path][entry.method] = {
        tags: [entry.tag],
        summary: `${entry.method.toUpperCase()} ${entry.path}`,
        operationId: operationId(entry.method, entry.tag, entry.path),
        security: securityFor(entry.method, entry.path),
        parameters,
        ...(requestBody ? { requestBody } : {}),
        responses: {
          ...standardResponses(entry.method),
          ...(entry.path === "/client-errors"
            ? {
                202: {
                  description: "Laporan kendala diterima untuk observability.",
                  content: {
                    "application/json": {
                      schema: { $ref: "#/components/schemas/SuccessResponse" },
                    },
                  },
                },
              }
            : {}),
        },
        "x-express-route": entry.expressPath,
      };
    }
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Ruang Arsip API",
      version: `${API_VERSION}.0.0`,
      description:
        "Kontrak HTTP Ruang Arsip. Seluruh path pada dokumen ini relatif terhadap /api/v1. Payload divalidasi oleh schema Joi pada masing-masing endpoint.",
      license: { name: packageJson.license || "UNLICENSED" },
    },
    servers: [{ url: API_VERSION_PATH, description: "API versi 1" }],
    tags: [
      { name: "System", description: "Informasi service dan probe kesehatan." },
      ...apiModules.map((item) => ({ name: item.tag })),
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
        refreshCookie: {
          type: "apiKey",
          in: "cookie",
          name: process.env.AUTH_REFRESH_COOKIE_NAME || "ruang_arsip_refresh_token",
        },
      },
      schemas: {
        SuccessResponse: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "boolean", const: true },
            success: { type: "boolean", const: true },
            message: { type: "string" },
            data: {},
            meta: { type: ["object", "null"] },
          },
          additionalProperties: true,
        },
        ErrorResponse: {
          type: "object",
          required: ["status", "success", "message", "request_id"],
          properties: {
            status: { type: "boolean", const: false },
            success: { type: "boolean", const: false },
            message: { type: "string" },
            request_id: { type: ["string", "null"] },
            errors: {
              type: "array",
              items: { type: "string" },
            },
          },
          additionalProperties: true,
        },
      },
      responses: {
        BadRequest: errorResponse("Permintaan tidak valid."),
        Unauthorized: errorResponse("Autentikasi diperlukan atau tidak valid."),
        Forbidden: errorResponse("Izin tidak mencukupi."),
        NotFound: errorResponse("Resource tidak ditemukan."),
        Conflict: errorResponse("Permintaan berkonflik dengan data saat ini."),
        ValidationError: errorResponse("Payload gagal divalidasi."),
        RateLimited: {
          ...errorResponse("Batas request terlampaui."),
          headers: {
            "RateLimit-Limit": {
              description: "Kuota maksimum untuk window aktif.",
              schema: { type: "integer", minimum: 1 },
            },
            "RateLimit-Remaining": {
              description: "Sisa kuota pada window aktif.",
              schema: { type: "integer", minimum: 0 },
            },
            "RateLimit-Reset": {
              description: "Detik sampai window di-reset.",
              schema: { type: "integer", minimum: 1 },
            },
            "Retry-After": {
              description: "Detik minimum sebelum request dicoba kembali.",
              schema: { type: "integer", minimum: 1 },
            },
          },
        },
        InternalError: errorResponse("Kesalahan internal yang telah disanitasi."),
        ServiceUnavailable: errorResponse("Dependency wajib belum siap."),
      },
    },
  };
}

module.exports = {
  buildOpenApiSpec,
  routeEntries,
  toOpenApiPath,
};
