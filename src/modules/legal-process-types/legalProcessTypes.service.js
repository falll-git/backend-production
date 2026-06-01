const repository = require("./legalProcessTypes.repository");
const {
  createParameterService,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterService({
  modelName: "legal_process_types",
  repository,
  label: "Jenis proses legal",
  searchFields: ["code", "name", "category", "description"],
  sortableFields: ["category", "code", "name", "created_at", "updated_at"],
  filterFields: ["is_active", "category"],
  uppercaseFields: ["code", "category"],
  textFields: ["name", "description"],
});
