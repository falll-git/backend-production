const crypto = require("crypto");
const prisma = require("../../src/config/prisma");

const documentTypes = [
  {
    code: "AM-001",
    name: "Legalitas",
    description: "Dokumen Kelegalitasan",
    is_active: true,
  },
];

async function seedDocumentTypes() {
  console.log("Seeding document types...");

  for (const documentType of documentTypes) {
    const existingByCode = await prisma.document_types.findUnique({
      where: { code: documentType.code },
    });
    const existingByName = await prisma.document_types.findUnique({
      where: { name: documentType.name },
    });

    if (
      existingByCode &&
      existingByName &&
      existingByCode.id !== existingByName.id
    ) {
      throw new Error(
        `Document type seed conflict: ${documentType.code} and ${documentType.name} are used by different records.`,
      );
    }

    const existing = existingByCode || existingByName;
    const data = {
      code: documentType.code,
      name: documentType.name,
      description: documentType.description,
      is_active: documentType.is_active,
    };

    if (existing) {
      await prisma.document_types.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.document_types.create({
        data: {
          id: crypto.randomUUID(),
          ...data,
        },
      });
    }
  }

  console.log("Document types seeded!");
}

module.exports = { seedDocumentTypes };
