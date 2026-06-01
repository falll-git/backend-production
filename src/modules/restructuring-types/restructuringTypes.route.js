const controller = require("./restructuringTypes.controller");
const schemas = require("./restructuringTypes.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");
const { DEBTOR_MENU_URLS } = require("../../utils/menu-access");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/jenis-restrukturisasi",
  readMenuUrls: [
    "/dashboard/parameter/jenis-restrukturisasi",
    ...DEBTOR_MENU_URLS,
  ],
});
