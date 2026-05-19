const controller = require("./branches.controller");
const schemas = require("./branches.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");
const { DEBTOR_MENU_URLS } = require("../../utils/menu-access");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/cabang",
  readMenuUrls: ["/dashboard/parameter/cabang", ...DEBTOR_MENU_URLS],
});
