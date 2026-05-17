const prisma = require("../../config/prisma");

const documentFileWhere = {
  deleted_at: null,
  OR: [
    { file: { not: null } },
    { watermark_file: { not: null } },
    {
      document_files: {
        some: {
          deleted_at: null,
        },
      },
    },
  ],
};

const mailFileWhere = {
  deleted_at: null,
  OR: [{ file: { not: null } }, { watermark_file: { not: null } }],
};

exports.findActiveConfig = () => {
  return prisma.storage_usage_configs.findFirst({
    where: {
      is_active: true,
    },
    orderBy: {
      created_at: "asc",
    },
  });
};

exports.upsertDefaultConfig = ({ freeQuotaGb, overagePricePerGb, currency }) => {
  return prisma.storage_usage_configs.upsert({
    where: {
      id: "storage-usage-config-default",
    },
    update: {
      is_active: true,
    },
    create: {
      id: "storage-usage-config-default",
      free_quota_gb: freeQuotaGb,
      overage_price_per_gb: overagePricePerGb,
      currency,
      is_active: true,
    },
  });
};

exports.findDigitalDocumentUsageRecords = () => {
  return prisma.digital_documents.findMany({
    where: documentFileWhere,
    select: {
      file: true,
      created_at: true,
      updated_at: true,
      watermark_file: true,
      watermark_file_size_bytes: true,
      watermark_applied_at: true,
      document_files: {
        where: {
          deleted_at: null,
        },
        select: {
          file_path: true,
          size_bytes: true,
          created_at: true,
        },
      },
    },
  });
};

exports.findIncomingMailUsageRecords = () => {
  return prisma.incoming_mails.findMany({
    where: mailFileWhere,
    select: {
      file: true,
      file_size_bytes: true,
      created_at: true,
      updated_at: true,
      watermark_file: true,
      watermark_file_size_bytes: true,
      watermark_applied_at: true,
    },
  });
};

exports.findOutgoingMailUsageRecords = () => {
  return prisma.outgoing_mails.findMany({
    where: mailFileWhere,
    select: {
      file: true,
      file_size_bytes: true,
      created_at: true,
      updated_at: true,
      watermark_file: true,
      watermark_file_size_bytes: true,
      watermark_applied_at: true,
    },
  });
};

exports.findMemorandumUsageRecords = () => {
  return prisma.memorandums.findMany({
    where: mailFileWhere,
    select: {
      file: true,
      file_size_bytes: true,
      created_at: true,
      updated_at: true,
      watermark_file: true,
      watermark_file_size_bytes: true,
      watermark_applied_at: true,
    },
  });
};
