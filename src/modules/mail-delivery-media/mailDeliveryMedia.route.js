const controller = require("./mailDeliveryMedia.controller");
const schemas = require("./mailDeliveryMedia.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");

const OUTGOING_MAIL_MENU_URL =
  "/dashboard/manajemen-surat/kelola-surat/input-surat-keluar";

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/media-pengiriman-surat",
  readMenuUrls: [
    "/dashboard/parameter/media-pengiriman-surat",
    OUTGOING_MAIL_MENU_URL,
  ],
});
