const repository = require("./restructuringTypes.repository");
const {
  createParameterService,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterService({
  modelName: "restructuring_types",
  repository,
  label: "Jenis restrukturisasi",
  searchFields: ["code", "name", "description"],
  sortableFields: ["code", "name", "created_at", "updated_at"],
  filterFields: ["is_active"],
  uppercaseFields: ["code"],
  textFields: ["name", "description"],
});
