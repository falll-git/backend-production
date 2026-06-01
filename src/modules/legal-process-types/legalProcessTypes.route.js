const controller = require("./legalProcessTypes.controller");
const schemas = require("./legalProcessTypes.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");
const { LEGAL_MENU_URLS } = require("../../utils/menu-access");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/jenis-proses-legal",
  readMenuUrls: [
    "/dashboard/parameter/jenis-proses-legal",
    ...LEGAL_MENU_URLS,
  ],
});
