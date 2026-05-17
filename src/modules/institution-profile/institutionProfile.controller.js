const service = require("./institutionProfile.service");
const {
  createParameterController,
} = require("../_shared/parameterModule.factory");

module.exports = createParameterController(service, "Profil lembaga");
