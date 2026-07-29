const { withRlsUserContext } = require("../config/database-rls");
const {
  runWithDatabaseUserContext,
} = require("../config/database-context");
const { verifyAccessToken } = require("../utils/jwt");

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
    const decoded = verifyAccessToken(token);
    if (!decoded.session_id) {
      return res.status(401).json({
        status: false,
        message: "Sesi login tidak valid.",
      });
    }

    const activeSession = await withRlsUserContext(decoded.id, async (client) => {
      const session = await client.refresh_tokens.findFirst({
        where: {
          id: decoded.session_id,
          user_id: decoded.id,
          revoked_at: null,
          expires_at: {
            gt: new Date(),
          },
        },
        select: {
          last_used_at: true,
          user: {
            select: {
              id: true,
              is_active: true,
              password_set_at: true,
              role_id: true,
              division_id: true,
            },
          },
        },
      });

      const now = new Date();
      const touchBefore = new Date(now.getTime() - 5 * 60 * 1000);
      if (session && (!session.last_used_at || session.last_used_at < touchBefore)) {
        await client.refresh_tokens
          .updateMany({
            where: {
              id: decoded.session_id,
              user_id: decoded.id,
              revoked_at: null,
              last_used_at: { lt: touchBefore },
            },
            data: { last_used_at: now },
          })
          .catch(() => null);
      }

      return session;
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

    req.user = {
      ...decoded,
      id: user.id,
      role_id: user.role_id,
      division_id: user.division_id,
    };

    return runWithDatabaseUserContext(user.id, next);
  } catch (err) {
    return res.status(401).json({
      status: false,
      message: "Token akses tidak valid.",
    });
  }
};
