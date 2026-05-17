const repository = require("./institutionProfile.repository");
const {
  createParameterService,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterService({
  modelName: "institution_profiles",
  repository,
  label: "Profil lembaga",
  searchFields: ["code", "name", "legal_name", "address", "phone", "email"],
  sortableFields: ["code", "name", "created_at", "updated_at"],
  textFields: ["name", "legal_name", "address", "phone", "email", "tax_number", "license_number"],
});
