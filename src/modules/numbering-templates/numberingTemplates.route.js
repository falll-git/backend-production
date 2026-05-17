const controller = require("./numberingTemplates.controller");
const schemas = require("./numberingTemplates.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/template-penomoran",
});
