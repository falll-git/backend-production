const repository = require("./marketingActivityTypes.repository");
const {
  createParameterService,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterService({
  modelName: "marketing_activity_types",
  repository,
  label: "Aktivitas marketing",
  searchFields: ["code", "name", "category", "description"],
  sortableFields: ["category", "code", "name", "created_at", "updated_at"],
  filterFields: ["is_active", "category"],
  uppercaseFields: ["code", "category"],
  textFields: ["name", "description"],
});
