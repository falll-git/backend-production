const express = require("express");
const controller = require("./controlMonitoring.controller");
const router = express.Router();
router.get("/snapshot", controller.snapshot);
module.exports = router;
