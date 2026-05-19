const controller = require("./thirdParties.controller");
const schemas = require("./thirdParties.validation");
const {
  createParameterRouter,
} = require("../_shared/parameterModule.factory");
const { LEGAL_MENU_URLS } = require("../../utils/menu-access");

const menuUrls = [
  "/dashboard/parameter/pihak-ketiga/notaris",
  "/dashboard/parameter/pihak-ketiga/perusahaan-asuransi",
  "/dashboard/parameter/pihak-ketiga/kjpp",
];

module.exports = createParameterRouter({
  controller,
  schemas,
  menuUrl: menuUrls,
  readMenuUrls: [...menuUrls, ...LEGAL_MENU_URLS],
});
