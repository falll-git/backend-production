const repository = require("./contractTypes.repository");
const {
  createParameterService,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterService({
  modelName: "contract_types",
  repository,
  label: "Jenis akad",
  searchFields: ["code", "name", "description"],
  sortableFields: ["code", "name", "created_at", "updated_at"],
  textFields: ["name", "description"],
});
