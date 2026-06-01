const repository = require("./mailDeliveryMedia.repository");
const {
  createParameterService,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterService({
  modelName: "mail_delivery_media",
  repository,
  label: "Media pengiriman surat",
  searchFields: ["code", "name", "description"],
  sortableFields: ["code", "name", "created_at", "updated_at"],
  filterFields: ["is_active"],
  uppercaseFields: ["code"],
  textFields: ["name", "description"],
});
