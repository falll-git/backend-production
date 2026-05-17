const repository = require("./branches.repository");
const {
  createParameterService,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterService({
  modelName: "branches",
  repository,
  label: "Cabang",
  searchFields: ["code", "name", "address", "phone"],
  sortableFields: ["code", "name", "created_at", "updated_at"],
  textFields: ["name", "address", "phone"],
});
