const repository = require("./depositTypes.repository");
const {
  createParameterService,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterService({
  modelName: "deposit_types",
  repository,
  label: "Jenis titipan",
  searchFields: ["code", "name", "category", "description"],
  sortableFields: ["category", "code", "name", "created_at", "updated_at"],
  filterFields: ["is_active", "category"],
  uppercaseFields: ["code", "category"],
  textFields: ["name", "description"],
});
