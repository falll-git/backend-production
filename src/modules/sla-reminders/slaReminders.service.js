const repository = require("./slaReminders.repository");
const {
  createParameterService,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterService({
  modelName: "sla_reminder_configs",
  repository,
  label: "SLA pengingat",
  searchFields: ["code", "name", "module", "event_key", "description"],
  sortableFields: ["module", "event_key", "code", "name", "due_days", "created_at"],
  filterFields: ["is_active", "module", "event_key"],
  uppercaseFields: ["code", "module", "event_key"],
  textFields: ["name", "description"],
});
