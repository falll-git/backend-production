const repository = require("./numberingTemplates.repository");
const {
  createParameterService,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterService({
  modelName: "numbering_templates",
  repository,
  label: "Template penomoran",
  searchFields: ["code", "name", "module", "document_type", "prefix_template"],
  sortableFields: ["module", "document_type", "code", "name", "created_at", "updated_at"],
  filterFields: ["is_active", "module", "document_type", "reset_period"],
  uppercaseFields: ["code", "module", "document_type", "reset_period"],
  textFields: ["name", "prefix_template", "description"],
});
