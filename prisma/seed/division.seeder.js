const crypto = require("crypto");
const prisma = require("../../src/config/prisma");

async function seedDivisions() {
  console.log("Seeding division...");

  const divisions = ["IT"];

  for (const name of divisions) {
    await prisma.divisions.upsert({
      where: { name },
      update: { name },
      create: {
        id: crypto.randomUUID(),
        name,
      },
    });
  }

  console.log("Division seeded!");
}

module.exports = { seedDivisions };
