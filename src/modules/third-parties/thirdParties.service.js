const repository = require("./thirdParties.repository");
const {
  createParameterService,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterService({
  modelName: "third_parties",
  repository,
  label: "Pihak ketiga",
  searchFields: ["code", "name", "category", "contact_person", "phone"],
  sortableFields: ["category", "code", "name", "created_at", "updated_at"],
  filterFields: ["is_active", "category"],
  uppercaseFields: ["code", "category"],
  textFields: ["name", "address", "phone", "email", "contact_person", "description"],
});
