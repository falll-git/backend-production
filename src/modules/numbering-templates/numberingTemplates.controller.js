const service = require("./numberingTemplates.service");
const {
  createParameterController,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterController(service, "Template penomoran");
