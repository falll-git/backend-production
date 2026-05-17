const service = require("./thirdParties.service");
const {
  createParameterController,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterController(service, "Pihak ketiga");
