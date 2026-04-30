const prisma = require("../../config/prisma");

const storageInclude = {
  cabinet: {
    include: {
      office: true,
    },
  },
};

function resolveClient(client) {
  return client || prisma;
}

exports.findMany = ({ where, skip, take }, client) => {
  return resolveClient(client).storages.findMany({
    where,
    skip,
    take,
    include: storageInclude,
    orderBy: [{ created_at: "desc" }, { name: "asc" }],
  });
};

exports.count = (where, client) => {
  return resolveClient(client).storages.count({ where });
};

exports.findById = (id, client) => {
  return resolveClient(client).storages.findUnique({
    where: { id },
    include: storageInclude,
  });
};

exports.findRackByComposite = ({ cabinet_id, name }, client) => {
  return resolveClient(client).storages.findFirst({
    where: {
      cabinet_id,
      name: {
        equals: name,
        mode: "insensitive",
      },
    },
    include: storageInclude,
  });
};

exports.findDependencySummary = (id, client) => {
  return resolveClient(client).storages.findUnique({
    where: { id },
    select: {
      id: true,
      cabinet_id: true,
      cabinet: {
        select: {
          id: true,
          office_id: true,
        },
      },
      _count: {
        select: {
          digital_documents: true,
        },
      },
    },
  });
};

exports.createRack = (data, client) => {
  return resolveClient(client).storages.create({
    data,
    include: storageInclude,
  });
};

exports.updateRack = (id, data, client) => {
  return resolveClient(client).storages.update({
    where: { id },
    data,
    include: storageInclude,
  });
};

exports.deleteRack = (id, client) => {
  return resolveClient(client).storages.delete({
    where: { id },
  });
};

exports.countRacksByCabinet = (cabinetId, client) => {
  return resolveClient(client).storages.count({
    where: { cabinet_id: cabinetId },
  });
};

exports.findOfficeByCode = (code, client) => {
  return resolveClient(client).storage_offices.findFirst({
    where: {
      code: {
        equals: code,
        mode: "insensitive",
      },
    },
  });
};

exports.createOffice = (data, client) => {
  return resolveClient(client).storage_offices.create({ data });
};

exports.updateOffice = (id, data, client) => {
  return resolveClient(client).storage_offices.update({
    where: { id },
    data,
  });
};

exports.deleteOffice = (id, client) => {
  return resolveClient(client).storage_offices.delete({
    where: { id },
  });
};

exports.countCabinetsByOffice = (officeId, client) => {
  return resolveClient(client).storage_cabinets.count({
    where: { office_id: officeId },
  });
};

exports.findCabinetById = (id, client) => {
  return resolveClient(client).storage_cabinets.findUnique({
    where: { id },
  });
};

exports.findCabinetByOfficeAndCode = ({ office_id, code }, client) => {
  return resolveClient(client).storage_cabinets.findFirst({
    where: {
      office_id,
      code: {
        equals: code,
        mode: "insensitive",
      },
    },
  });
};

exports.createCabinet = (data, client) => {
  return resolveClient(client).storage_cabinets.create({ data });
};

exports.deleteCabinet = (id, client) => {
  return resolveClient(client).storage_cabinets.delete({
    where: { id },
  });
};

exports.withTransaction = (callback) => {
  return prisma.$transaction((tx) => callback(tx));
};
