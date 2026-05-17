const controller = require("./marketingActivityTypes.controller");
const schemas = require("./marketingActivityTypes.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/aktivitas-marketing",
});
