const service = require("./financingProducts.service");
const {
  createParameterController,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterController(service, "Produk pembiayaan");
