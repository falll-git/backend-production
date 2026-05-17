const repository = require("./documentChecklists.repository");
const {
  createParameterService,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterService({
  modelName: "document_checklists",
  repository,
  label: "Checklist dokumen",
  searchFields: ["code", "name", "category", "document_type", "description"],
  sortableFields: ["category", "code", "name", "created_at", "updated_at"],
  filterFields: ["is_active", "category", "is_required"],
  uppercaseFields: ["code", "category", "document_type"],
  textFields: ["name", "description"],
});
