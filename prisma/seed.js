require("../src/config/env").loadEnv();
const { seedRoles } = require("./seed/roles.seeder");
const { seedDivisions } = require("./seed/division.seeder");
const {
  seedLetterPriorities,
} = require("./seed/letter_priorities.seeder");
const { seedDocumentTypes } = require("./seed/document_types.seeder");
const { seedStorage } = require("./seed/storage.seeder");
const { seedUsers } = require("./seed/users.seeder");
const { seedMenus } = require("./seed/menus.seeder");
const { seedRoleMenus } = require("./seed/role_menus.seeder");
const {
  seedWatermarkSettings,
} = require("./seed/watermark_settings.seeder");
const {
  seedStorageUsageConfig,
} = require("./seed/storage_usage_config.seeder");
const {
  seedDebtorLegalParameters,
} = require("./seed/debtor_legal_parameters.seeder");
const prisma = require("../src/config/prisma");

async function main() {
    if (
        process.env.NODE_ENV === "production" &&
        process.env.ALLOW_PRODUCTION_SEED !== "true"
    ) {
        throw new Error(
            "Refusing to run seed in production. Set ALLOW_PRODUCTION_SEED=true only for an intentional controlled seed.",
        );
    }

    await seedRoles();
    await seedDivisions();
    await seedLetterPriorities();
    await seedDocumentTypes();
    await seedStorage();
    await seedWatermarkSettings();
    await seedStorageUsageConfig();
    await seedDebtorLegalParameters();
    await seedUsers();
    await seedMenus();
    await seedRoleMenus();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
}).finally(async () => {
    await prisma.$disconnect();
});
