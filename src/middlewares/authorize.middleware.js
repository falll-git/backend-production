const { asArray, capabilityField, resolveRequestUser } = require("../utils/rbac");
const prisma = require("../config/prisma");
const { logErrorOnce } = require("../system/error-observability");

function authorize(menuUrls, capability = "read", options = {}) {
  const urls = asArray(menuUrls).filter(Boolean);
  const field = capabilityField(capability);
  const requiredFeature =
    typeof options === "string"
      ? options.trim()
      : String(options.feature || "").trim();

  return async (req, res, next) => {
    try {
      const user = await resolveRequestUser(req.user);
      if (!user) {
        return res.status(401).json({
          status: false,
          message: "User tidak dikenali",
        });
      }

      const permission = await prisma.role_menus.findFirst({
        where: {
          role_id: user.role_id,
          [field]: true,
          ...(requiredFeature
            ? {
                can_read: true,
                features: {
                  has: requiredFeature,
                },
              }
            : {}),
          menu: {
            url: {
              in: urls,
            },
          },
        },
      });

      if (!permission) {
        return res.status(403).json({
          status: false,
          message: requiredFeature
            ? "Anda tidak memiliki izin untuk fitur ini"
            : "Anda tidak memiliki izin untuk aksi ini",
        });
      }

      return next();
    } catch (error) {
      logErrorOnce(error, {
        event: "authorization_check_failed",
        message: "Authorization check failed",
        fields: {
          capability,
          required_feature: requiredFeature || null,
        },
      });
      return res.status(500).json({
        status: false,
        message: "Gagal memverifikasi izin akses.",
      });
    }
  };
}

module.exports = authorize;
