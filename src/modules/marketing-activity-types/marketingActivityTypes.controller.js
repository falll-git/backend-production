const service = require("./marketingActivityTypes.service");
const {
  createParameterController,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterController(service, "Aktivitas marketing");
