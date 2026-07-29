const express = require("express");
const apiModules = require("./api-modules");
const healthController = require("../system/health.controller");
const { API_VERSION } = require("../utils/api-version");
const {
  apiGeneralRateLimit,
} = require("../middlewares/rate-limit.middleware");

function createApiV1Router() {
  const router = express.Router();

  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    return next();
  });

  router.get("/", (req, res) => {
    res.json({
      status: true,
      success: true,
      message: "Ruang Arsip API aktif.",
      data: {
        service: "Ruang Arsip API",
        version: API_VERSION,
        documentation: "/api/v1/docs/",
      },
    });
  });
  router.get("/health", healthController.liveness);
  router.get("/ready", healthController.readiness);
  router.use(apiGeneralRateLimit);

  for (const apiModule of apiModules) {
    router.use(apiModule.path, apiModule.router);
  }

  return router;
}

module.exports = { createApiV1Router };
