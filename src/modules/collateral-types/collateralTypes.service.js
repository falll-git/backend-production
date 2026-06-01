const repository = require("./collateralTypes.repository");
const {
  createParameterService,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterService({
  modelName: "collateral_types",
  repository,
  label: "Jenis agunan",
  searchFields: ["code", "name", "description"],
  sortableFields: ["code", "name", "created_at", "updated_at"],
  filterFields: ["is_active"],
  uppercaseFields: ["code"],
  textFields: ["name", "description"],
});
