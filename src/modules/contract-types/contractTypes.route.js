const controller = require("./contractTypes.controller");
const schemas = require("./contractTypes.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/jenis-akad",
});
