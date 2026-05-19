const controller = require("./contractTypes.controller");
const schemas = require("./contractTypes.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");
const { DEBTOR_MENU_URLS } = require("../../utils/menu-access");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/jenis-akad",
  readMenuUrls: ["/dashboard/parameter/jenis-akad", ...DEBTOR_MENU_URLS],
});
