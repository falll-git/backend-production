const crypto = require("crypto");
const prisma = require("../../src/config/prisma");

const storageOffices = [
  {
    code: "KPAM",
    name: "Kantor Pusat Artha Madani",
  },
];

const storageCabinets = [
  {
    office_code: "KPAM",
    code: "Lemari-1",
  },
];

const storages = [
  {
    office_code: "KPAM",
    cabinet_code: "Lemari-1",
    name: "Rak 1",
    capacity: 100,
    is_active: true,
  },
];

async function seedStorageOffices() {
  for (const office of storageOffices) {
    await prisma.storage_offices.upsert({
      where: { code: office.code },
      update: {
        name: office.name,
      },
      create: {
        id: crypto.randomUUID(),
        code: office.code,
        name: office.name,
      },
    });
  }
}

async function seedStorageCabinets() {
  for (const cabinet of storageCabinets) {
    const office = await prisma.storage_offices.findUnique({
      where: { code: cabinet.office_code },
    });

    if (!office) {
      throw new Error(
        `Storage office seed tidak ditemukan: ${cabinet.office_code}`,
      );
    }

    await prisma.storage_cabinets.upsert({
      where: {
        office_id_code: {
          office_id: office.id,
          code: cabinet.code,
        },
      },
      update: {
        code: cabinet.code,
      },
      create: {
        id: crypto.randomUUID(),
        office_id: office.id,
        code: cabinet.code,
      },
    });
  }
}

async function seedStorages() {
  for (const storage of storages) {
    const office = await prisma.storage_offices.findUnique({
      where: { code: storage.office_code },
    });

    if (!office) {
      throw new Error(
        `Storage office seed tidak ditemukan: ${storage.office_code}`,
      );
    }

    const cabinet = await prisma.storage_cabinets.findUnique({
      where: {
        office_id_code: {
          office_id: office.id,
          code: storage.cabinet_code,
        },
      },
    });

    if (!cabinet) {
      throw new Error(
        `Storage cabinet seed tidak ditemukan: ${storage.cabinet_code}`,
      );
    }

    await prisma.storages.upsert({
      where: {
        cabinet_id_name: {
          cabinet_id: cabinet.id,
          name: storage.name,
        },
      },
      update: {
        capacity: storage.capacity,
        is_active: storage.is_active,
      },
      create: {
        id: crypto.randomUUID(),
        cabinet_id: cabinet.id,
        name: storage.name,
        capacity: storage.capacity,
        is_active: storage.is_active,
      },
    });
  }
}

async function seedStorage() {
  console.log("Seeding storage...");

  await seedStorageOffices();
  await seedStorageCabinets();
  await seedStorages();

  console.log("Storage seeded!");
}

module.exports = { seedStorage };
