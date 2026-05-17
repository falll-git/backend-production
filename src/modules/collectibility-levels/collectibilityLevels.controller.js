const service = require("./collectibilityLevels.service");
const {
  createParameterController,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterController(service, "Kolektibilitas");
