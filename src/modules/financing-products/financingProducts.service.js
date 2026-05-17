const repository = require("./financingProducts.repository");
const {
  createParameterService,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterService({
  modelName: "financing_products",
  repository,
  label: "Produk pembiayaan",
  searchFields: ["code", "name", "description"],
  sortableFields: ["code", "name", "created_at", "updated_at"],
  textFields: ["name", "description"],
});
