const controller = require("./collateralTypes.controller");
const schemas = require("./collateralTypes.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");
const { DEBTOR_MENU_URLS } = require("../../utils/menu-access");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/jenis-agunan",
  readMenuUrls: ["/dashboard/parameter/jenis-agunan", ...DEBTOR_MENU_URLS],
});
