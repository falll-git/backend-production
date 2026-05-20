const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");

module.exports = async (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({
      status: false,
      message: "Token akses wajib disertakan.",
    });
  }

  const token = header.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.session_id) {
      return res.status(401).json({
        status: false,
        message: "Sesi login tidak valid.",
      });
    }

    const activeSession = await prisma.refresh_tokens.findFirst({
      where: {
        id: decoded.session_id,
        user_id: decoded.id,
        revoked_at: null,
        expires_at: {
          gt: new Date(),
        },
      },
      select: {
        user: {
          select: {
            id: true,
            is_active: true,
            password_set_at: true,
          },
        },
      },
    });
    const user = activeSession?.user || null;

    if (!user || user.id !== decoded.id) {
      return res.status(401).json({
        status: false,
        message: "Token akses tidak valid.",
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        status: false,
        message: "Akun pengguna tidak aktif.",
      });
    }

    if (!user.password_set_at) {
      return res.status(403).json({
        status: false,
        message: "Aktivasi akun belum selesai.",
      });
    }

    req.user = decoded;

    next();
  } catch (err) {
    return res.status(401).json({
      status: false,
      message: "Token akses tidak valid.",
    });
  }
};
