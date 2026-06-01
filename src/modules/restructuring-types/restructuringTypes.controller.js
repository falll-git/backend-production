const service = require("./restructuringTypes.service");
const {
  createParameterController,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterController(service, "Jenis restrukturisasi");
