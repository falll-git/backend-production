const controller = require("./documentChecklists.controller");
const schemas = require("./documentChecklists.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/checklist-dokumen",
});
