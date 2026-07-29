const repository = require("./contractTypes.repository");
const {
  createParameterService,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterService({
  modelName: "contract_types",
  cacheNamespace: "parameter:contract-types",
  repository,
  label: "Jenis akad",
  searchFields: ["code", "name", "description"],
  sortableFields: ["code", "name", "created_at", "updated_at"],
  textFields: ["name", "description"],
});
