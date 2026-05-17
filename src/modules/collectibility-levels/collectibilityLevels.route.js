const controller = require("./collectibilityLevels.controller");
const schemas = require("./collectibilityLevels.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/kolektibilitas",
});
