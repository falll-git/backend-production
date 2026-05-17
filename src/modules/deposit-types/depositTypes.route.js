const controller = require("./depositTypes.controller");
const schemas = require("./depositTypes.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/jenis-titipan",
});
