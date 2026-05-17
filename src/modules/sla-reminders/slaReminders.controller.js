const service = require("./slaReminders.service");
const {
  createParameterController,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterController(service, "SLA pengingat");
