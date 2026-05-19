const controller = require("./collectibilityLevels.controller");
const schemas = require("./collectibilityLevels.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");
const { DEBTOR_MENU_URLS } = require("../../utils/menu-access");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/kolektibilitas",
  readMenuUrls: ["/dashboard/parameter/kolektibilitas", ...DEBTOR_MENU_URLS],
});
