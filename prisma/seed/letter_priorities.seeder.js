const crypto = require("crypto");
const prisma = require("../../src/config/prisma");

async function seedLetterPriorities() {
  console.log("Seeding letter priorities...");

  const letterPriorities = [
    "Biasa",
    "Rahasia",
    "Terbatas",
    "Sangat Terbatas",
  ];

  for (const name of letterPriorities) {
    await prisma.letter_priorities.upsert({
      where: { name },
      update: { name },
      create: {
        id: crypto.randomUUID(),
        name,
      },
    });
  }

  console.log("Letter priorities seeded!");
}

module.exports = { seedLetterPriorities };
