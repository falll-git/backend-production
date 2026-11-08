const express = require("express");

const controller = require("./controlReview.controller");

const router = express.Router();

router.post("/commands", controller.createCommand);
router.post("/command-results", controller.getCommandResult);
router.post("/command-delivery", controller.getCommandDelivery);
router.post("/recovery", controller.handleRecovery);
router.get("/media/:mediaId", controller.getMedia);
router.get("/snapshots/:snapshotId/media/:mediaId", controller.getMedia);

module.exports = router;
