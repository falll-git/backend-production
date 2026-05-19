const controller = require("./documentChecklists.controller");
const schemas = require("./documentChecklists.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");
const { DEBTOR_MENU_URLS } = require("../../utils/menu-access");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/checklist-dokumen",
  readMenuUrls: ["/dashboard/parameter/checklist-dokumen", ...DEBTOR_MENU_URLS],
});
