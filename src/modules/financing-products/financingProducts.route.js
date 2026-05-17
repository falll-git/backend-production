const controller = require("./financingProducts.controller");
const schemas = require("./financingProducts.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/produk-pembiayaan",
});
