const controller = require("./numberingTemplates.controller");
const schemas = require("./numberingTemplates.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");
const { LEGAL_MENU_URLS } = require("../../utils/menu-access");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/template-penomoran",
  readMenuUrls: ["/dashboard/parameter/template-penomoran", ...LEGAL_MENU_URLS],
});
