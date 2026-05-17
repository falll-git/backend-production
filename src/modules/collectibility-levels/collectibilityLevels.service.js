const repository = require("./collectibilityLevels.repository");
const {
  createParameterService,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterService({
  modelName: "collectibility_levels",
  repository,
  label: "Kolektibilitas",
  searchFields: ["code", "name", "description"],
  sortableFields: ["level", "code", "name", "created_at", "updated_at"],
  filterFields: ["is_active", "is_npf"],
  textFields: ["name", "description"],
});
