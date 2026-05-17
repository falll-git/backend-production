const service = require("./documentChecklists.service");
const {
  createParameterController,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterController(service, "Checklist dokumen");
