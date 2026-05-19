const controller = require("./depositTypes.controller");
const schemas = require("./depositTypes.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");
const { LEGAL_MENU_URLS } = require("../../utils/menu-access");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/jenis-titipan",
  readMenuUrls: ["/dashboard/parameter/jenis-titipan", ...LEGAL_MENU_URLS],
});
