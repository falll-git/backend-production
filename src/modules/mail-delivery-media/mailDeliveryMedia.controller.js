const service = require("./mailDeliveryMedia.service");
const {
  createParameterController,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterController(service, "Media pengiriman surat");
