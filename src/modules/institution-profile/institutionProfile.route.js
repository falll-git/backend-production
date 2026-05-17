const controller = require("./institutionProfile.controller");
const schemas = require("./institutionProfile.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: "/dashboard/parameter/profil-lembaga",
});
