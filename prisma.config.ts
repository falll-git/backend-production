require('./src/config/env').loadEnv();
const { defineConfig } = require('prisma/config');

module.exports = defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
        path: "prisma/migrations",
        seed: "node prisma/seed.js",
    },
    datasource: {
        // Migration credentials may own DDL privileges; the application runtime
        // must use the least-privileged DATABASE_URL account instead.
        url: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
    },
});
