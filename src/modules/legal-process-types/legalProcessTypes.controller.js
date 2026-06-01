const service = require("./legalProcessTypes.service");
const {
  createParameterController,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterController(service, "Jenis proses legal");
