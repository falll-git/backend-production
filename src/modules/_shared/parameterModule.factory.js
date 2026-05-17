const express = require("express");
const Joi = require("joi");
const prisma = require("../../config/prisma");
const auth = require("../../middlewares/auth.middleware");
const authorize = require("../../middlewares/authorize.middleware");
const validate = require("../../middlewares/validate.middleware");
const { AppError } = require("../../utils/errors");
const {
  PAGINATION_PROFILES,
  buildPaginationMeta,
  resolvePagination,
} = require("../../utils/pagination");
const { paginatedResponse, successResponse } = require("../../utils/response");

function normalizeText(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;

  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized || null;
}

function normalizeUpper(value) {
  const text = normalizeText(value);
  return typeof text === "string" ? text.toUpperCase() : text;
}

function parseBooleanQuery(value) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return value;
}

function createParameterRepository(modelName, include = null) {
  const model = prisma[modelName];
  if (!model) {
    throw new Error(`Model Prisma tidak ditemukan: ${modelName}`);
  }

  return {
    count(where) {
      return model.count({ where });
    },
    findMany({ where, skip, take, orderBy }) {
      return model.findMany({
        where,
        skip,
        take,
        orderBy,
        ...(include ? { include } : {}),
      });
    },
    findById(id) {
      return model.findFirst({
        where: {
          id,
          deleted_at: null,
        },
        ...(include ? { include } : {}),
      });
    },
    create(data) {
      return model.create({ data });
    },
    update(id, data) {
      return model.update({
        where: { id },
        data,
        ...(include ? { include } : {}),
      });
    },
  };
}

function createSearchWhere(search, fields) {
  const normalized = normalizeText(search);
  if (!normalized || !Array.isArray(fields) || fields.length === 0) return {};

  return {
    OR: fields.map((field) => ({
      [field]: {
        contains: normalized,
        mode: "insensitive",
      },
    })),
  };
}

function buildOrderBy(query, sortableFields, defaultSort) {
  const sortBy = normalizeText(query.sort_by || query.sortBy);
  const sortOrder =
    String(query.sort_order || query.sortOrder || "asc").toLowerCase() ===
    "desc"
      ? "desc"
      : "asc";

  if (sortBy && sortableFields.includes(sortBy)) {
    return { [sortBy]: sortOrder };
  }

  return defaultSort || { created_at: "desc" };
}

function buildFilterWhere(query, fields = []) {
  const clauses = [];

  for (const field of fields) {
    const value = query[field];
    if (value === undefined || value === "" || value === "all") continue;

    clauses.push({
      [field]: parseBooleanQuery(value),
    });
  }

  return clauses;
}

function normalizePayload(payload, config) {
  const uppercaseFields = new Set(config.uppercaseFields || ["code"]);
  const textFields = new Set(config.textFields || []);

  return Object.fromEntries(
    Object.entries(payload).map(([field, value]) => {
      if (uppercaseFields.has(field)) return [field, normalizeUpper(value)];
      if (textFields.has(field)) return [field, normalizeText(value)];
      return [field, value];
    }),
  );
}

function handlePrismaWriteError(error, label) {
  if (error?.code === "P2002") {
    throw new AppError(`${label} dengan nilai unik tersebut sudah ada.`, 409);
  }

  throw error;
}

function createParameterService(config) {
  const repository =
    config.repository ||
    createParameterRepository(config.modelName, config.include || null);
  const label = config.label || "Data parameter";
  const searchFields = config.searchFields || ["code", "name"];
  const sortableFields = config.sortableFields || [
    "code",
    "name",
    "created_at",
    "updated_at",
  ];
  const filterFields = config.filterFields || ["is_active"];

  return {
    async getAll(query = {}) {
      const pagination = resolvePagination(query, PAGINATION_PROFILES.SETUP);
      const clauses = [
        { deleted_at: null },
        createSearchWhere(query.search, searchFields),
        ...buildFilterWhere(query, filterFields),
      ].filter((item) => item && Object.keys(item).length > 0);
      const where = clauses.length ? { AND: clauses } : {};
      const orderBy = buildOrderBy(query, sortableFields, config.defaultSort);
      const [data, total] = await Promise.all([
        repository.findMany({
          where,
          skip: pagination.skip,
          take: pagination.take,
          orderBy,
        }),
        repository.count(where),
      ]);

      return {
        data,
        meta: buildPaginationMeta(total, pagination),
      };
    },

    async getById(id) {
      const data = await repository.findById(id);
      if (!data) throw new AppError(`${label} tidak ditemukan.`, 404);
      return data;
    },

    async create(payload, userId) {
      try {
        return await repository.create({
          ...normalizePayload(payload, config),
          created_by: userId || null,
        });
      } catch (error) {
        handlePrismaWriteError(error, label);
      }
    },

    async update(id, payload, userId) {
      await this.getById(id);

      try {
        return await repository.update(id, {
          ...normalizePayload(payload, config),
          updated_by: userId || null,
        });
      } catch (error) {
        handlePrismaWriteError(error, label);
      }
    },

    async delete(id, userId) {
      await this.getById(id);

      return repository.update(id, {
        is_active: false,
        deleted_at: new Date(),
        deleted_by: userId || null,
      });
    },
  };
}

function createParameterController(service, label = "Data parameter") {
  function status(error, fallback = 400) {
    return error.statusCode || fallback;
  }

  return {
    async getAll(req, res) {
      try {
        const result = await service.getAll(req.query);
        return paginatedResponse(res, result.data, result.meta);
      } catch (error) {
        return res.status(status(error)).json({
          status: false,
          success: false,
          message: error.message,
        });
      }
    },
    async getById(req, res) {
      try {
        return successResponse(res, await service.getById(req.params.id));
      } catch (error) {
        return res.status(status(error, 404)).json({
          status: false,
          success: false,
          message: error.message,
        });
      }
    },
    async create(req, res) {
      try {
        const data = await service.create(req.body, req.user?.id);
        return res.status(201).json({
          status: true,
          success: true,
          message: `${label} berhasil dibuat.`,
          data,
        });
      } catch (error) {
        return res.status(status(error)).json({
          status: false,
          success: false,
          message: error.message,
        });
      }
    },
    async update(req, res) {
      try {
        const data = await service.update(req.params.id, req.body, req.user?.id);
        return successResponse(res, data, `${label} berhasil diperbarui.`);
      } catch (error) {
        return res.status(status(error)).json({
          status: false,
          success: false,
          message: error.message,
        });
      }
    },
    async delete(req, res) {
      try {
        await service.delete(req.params.id, req.user?.id);
        return successResponse(res, null, `${label} berhasil dihapus.`);
      } catch (error) {
        return res.status(status(error)).json({
          status: false,
          success: false,
          message: error.message,
        });
      }
    },
  };
}

function createParameterSchemas(fieldSchemas, options = {}) {
  const createSchema = Joi.object(fieldSchemas).required();
  const updateSchema = Joi.object(
    Object.fromEntries(
      Object.entries(fieldSchemas).map(([field, schema]) => [
        field,
        schema.optional(),
      ]),
    ),
  )
    .prefs({ noDefaults: true })
    .min(1)
    .messages({
      "object.min": "Tidak ada data yang diperbarui.",
    });

  return {
    createSchema: options.createSchema || createSchema,
    updateSchema: options.updateSchema || updateSchema,
  };
}

function createParameterRouter({ controller, schemas, menuUrl, readMenuUrls }) {
  const router = express.Router();
  const readableUrls = readMenuUrls || menuUrl;

  router.get("/", auth, authorize(readableUrls, "read"), controller.getAll);
  router.post(
    "/",
    auth,
    authorize(menuUrl, "create"),
    validate(schemas.createSchema),
    controller.create,
  );
  router.get("/:id", auth, authorize(readableUrls, "read"), controller.getById);
  router.put(
    "/:id",
    auth,
    authorize(menuUrl, "update"),
    validate(schemas.updateSchema),
    controller.update,
  );
  router.delete(
    "/:id",
    auth,
    authorize(menuUrl, "delete"),
    controller.delete,
  );

  return router;
}

const baseParameterFields = {
  code: Joi.string().trim().min(1).max(50).required(),
  name: Joi.string().trim().min(1).max(255).required(),
  description: Joi.string().trim().allow("", null).optional(),
  is_active: Joi.boolean().default(true),
};

module.exports = {
  baseParameterFields,
  createParameterController,
  createParameterRepository,
  createParameterRouter,
  createParameterSchemas,
  createParameterService,
};
