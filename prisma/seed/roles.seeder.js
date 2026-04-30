const crypto = require("crypto");
const prisma = require("../../src/config/prisma");

async function seedRoles() {
  console.log("Seeding roles...");

  const roles = ["Manajer", "Admin", "Legal", "IT"];

  for (const name of roles) {
    await prisma.roles.upsert({
      where: { name },
      update: { name },
      create: {
        id: crypto.randomUUID(),
        name,
      },
    });
  }

  console.log("Roles seeded!");
}

module.exports = { seedRoles };
