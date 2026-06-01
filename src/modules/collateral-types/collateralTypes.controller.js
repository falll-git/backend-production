const service = require("./collateralTypes.service");
const {
  createParameterController,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterController(service, "Jenis agunan");
