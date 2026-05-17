const controller = require("./slaReminders.controller");
const schemas = require("./slaReminders.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/sla-pengingat",
});
