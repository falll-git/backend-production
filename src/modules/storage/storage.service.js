const repository = require("./storage.repository");
const { AppError } = require("../../utils/errors");

function serializeStorage(storage) {
  if (!storage) return null;

  const cabinet = storage.cabinet || null;
  const office = cabinet?.office || null;

  return {
    ...storage,
    office_id: office?.id || null,
    office_code: office?.code || null,
    office_label: office?.name || null,
    office_name: office?.name || null,
    cabinet_id: cabinet?.id || storage.cabinet_id || null,
    code: cabinet?.code || null,
    cabinet_code: cabinet?.code || null,
    name: storage.name,
    rack_name: storage.name,
    capacity: storage.capacity ?? 0,
    is_active: storage.is_active,
  };
}

function parseCapacity(value) {
  if (value === undefined || value === null || value === "") return null;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError("Kapasitas rak harus berupa angka nol atau lebih.", 422);
  }

  return parsed;
}

exports.getStorage = async ({ page = 1, limit = 10, search = "" }) => {
  const skip = (page - 1) * limit;
  let where = {};
  
  if (search) {
    where = {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { cabinet: { code: { contains: search, mode: "insensitive" } } },
        { cabinet: { office: { code: { contains: search, mode: "insensitive" } } } },
      ],
    };
  }

  const [data, total] = await Promise.all([
    repository.findMany({ where, skip, take: limit }),
    repository.count(where),
  ]);

  return {
    data: data.map(serializeStorage),
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

exports.getStorageById = async (id) => {
  const storage = await repository.findById(id);
  if (!storage) throw new AppError("Lokasi arsip tidak ditemukan.", 404);
  return serializeStorage(storage);
};

exports.createStorage = async (data) => {
  return repository.withTransaction(async (tx) => {
    let office = await repository.findOfficeByCode(data.office_code, tx);
    if (!office) {
      office = await repository.createOffice({
        code: data.office_code,
        name: data.office_label,
      }, tx);
    } else if (office.name !== data.office_label) {
      office = await repository.updateOffice(office.id, { name: data.office_label }, tx);
    }

    let cabinet = await repository.findCabinetByOfficeAndCode({
      office_id: office.id,
      code: data.code,
    }, tx);

    if (!cabinet) {
      cabinet = await repository.createCabinet({
        office_id: office.id,
        code: data.code,
      }, tx);
    }

    const existingRack = await repository.findRackByComposite({
      cabinet_id: cabinet.id,
      name: data.name,
    }, tx);

    if (existingRack) {
      throw new AppError("Lokasi arsip dengan kantor, lemari, dan rak tersebut sudah ada.", 400);
    }

    const created = await repository.createRack({
      cabinet_id: cabinet.id,
      name: data.name,
      capacity: parseCapacity(data.capacity),
      is_active: data.is_active,
    }, tx);

    return serializeStorage(created);
  });
};

exports.updateStorage = async (id, data) => {
  const existingStorage = await repository.findById(id);
  if (!existingStorage) throw new AppError("Lokasi arsip tidak ditemukan.", 404);

  return repository.withTransaction(async (tx) => {
    let cabinetId = existingStorage.cabinet_id;
    
    if (data.office_code || data.office_label || data.code) {
      const officeCode = data.office_code || existingStorage.cabinet.office.code;
      const officeLabel = data.office_label || existingStorage.cabinet.office.name;
      const cabinetCode = data.code || existingStorage.cabinet.code;

      let office = await repository.findOfficeByCode(officeCode, tx);
      if (!office) {
        office = await repository.createOffice({
          code: officeCode,
          name: officeLabel,
        }, tx);
      } else if (data.office_label && office.name !== data.office_label) {
        office = await repository.updateOffice(office.id, { name: data.office_label }, tx);
      }

      let cabinet = await repository.findCabinetByOfficeAndCode({
        office_id: office.id,
        code: cabinetCode,
      }, tx);

      if (!cabinet) {
        cabinet = await repository.createCabinet({
          office_id: office.id,
          code: cabinetCode,
        }, tx);
      }

      cabinetId = cabinet.id;
    }

    if ((data.name && data.name !== existingStorage.name) || cabinetId !== existingStorage.cabinet_id) {
      const nameToCheck = data.name || existingStorage.name;
      const duplicateRack = await repository.findRackByComposite({
        cabinet_id: cabinetId,
        name: nameToCheck,
      }, tx);

      if (duplicateRack && duplicateRack.id !== id) {
        throw new AppError("Lokasi arsip dengan kantor, lemari, dan rak tersebut sudah digunakan.", 400);
      }
    }

    const updateData = {
      cabinet_id: cabinetId,
    };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.capacity !== undefined) updateData.capacity = parseCapacity(data.capacity);
    if (data.is_active !== undefined) updateData.is_active = data.is_active;

    const updated = await repository.updateRack(id, updateData, tx);
    return serializeStorage(updated);
  });
};

exports.deleteStorage = async (id) => {
  const summary = await repository.findDependencySummary(id);
  if (!summary) throw new AppError("Lokasi arsip tidak ditemukan.", 404);

  if (summary._count.digital_documents > 0) {
    throw new AppError("Lokasi arsip tidak dapat dihapus karena masih digunakan oleh dokumen digital.", 400);
  }

  return repository.withTransaction(async (tx) => {
    await repository.deleteRack(id, tx);

    const remainingRacks = await repository.countRacksByCabinet(summary.cabinet_id, tx);
    if (remainingRacks === 0) {
      await repository.deleteCabinet(summary.cabinet_id, tx);

      const remainingCabinets = await repository.countCabinetsByOffice(summary.cabinet.office_id, tx);
      if (remainingCabinets === 0) {
        await repository.deleteOffice(summary.cabinet.office_id, tx);
      }
    }
  });
};
