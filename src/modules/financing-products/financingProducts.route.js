const controller = require("./financingProducts.controller");
const schemas = require("./financingProducts.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");
const { DEBTOR_MENU_URLS } = require("../../utils/menu-access");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/produk-pembiayaan",
  readMenuUrls: ["/dashboard/parameter/produk-pembiayaan", ...DEBTOR_MENU_URLS],
});
