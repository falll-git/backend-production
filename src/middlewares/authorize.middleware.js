const prisma = require("../config/prisma");

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function capabilityField(capability) {
  switch (capability) {
    case "create":
      return "can_create";
    case "update":
      return "can_update";
    case "delete":
      return "can_delete";
    case "read":
    default:
      return "can_read";
  }
}

async function resolveUserRole(req) {
  if (!req.user?.id && !req.user?.role_id) return null;

  const user = await prisma.users.findFirst({
    where: {
      ...(req.user.id ? { id: req.user.id } : {}),
      is_active: true,
    },
    select: {
      id: true,
      role_id: true,
      role: {
        select: {
          name: true,
        },
      },
    },
  });

  return user;
}

function authorize(menuUrls, capability = "read") {
  const urls = asArray(menuUrls).filter(Boolean);
  const field = capabilityField(capability);

  return async (req, res, next) => {
    try {
      const user = await resolveUserRole(req);
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
          message: "Anda tidak memiliki izin untuk aksi ini",
        });
      }

      return next();
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: error.message,
      });
    }
  };
}

module.exports = authorize;
