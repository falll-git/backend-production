const prisma = require("../../config/prisma");

exports.findFirst = () => {
  return prisma.watermark_settings.findFirst({
    orderBy: {
      created_at: "asc",
    },
  });
};

exports.create = (data) => {
  return prisma.watermark_settings.create({ data });
};

exports.update = (id, data) => {
  return prisma.watermark_settings.update({
    where: { id },
    data,
  });
};
