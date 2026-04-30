const crypto = require("crypto");
const prisma = require("../../src/config/prisma");
const { hashPassword } = require("../../src/utils/bcrypt");

const DEFAULT_BOOTSTRAP_USER = {
  name: "ruwangarsip dev",
  username: "root",
  email: "ruwangarsip@test.com",
  password: null,
  role: "IT",
  division: "IT",
  phone: null,
};

function readSeedValue(key, fallback) {
  const value = process.env[key];
  if (typeof value !== "string") return fallback;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizePhone(value) {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") return null;
  return trimmed;
}

function getBootstrapUser() {
  return {
    name: readSeedValue("SEED_ADMIN_NAME", DEFAULT_BOOTSTRAP_USER.name),
    username: readSeedValue(
      "SEED_ADMIN_USERNAME",
      DEFAULT_BOOTSTRAP_USER.username,
    ).toLowerCase(),
    email: readSeedValue(
      "SEED_ADMIN_EMAIL",
      DEFAULT_BOOTSTRAP_USER.email,
    ).toLowerCase(),
    password: readSeedValue(
      "SEED_ADMIN_PASSWORD",
      DEFAULT_BOOTSTRAP_USER.password,
    ),
    role: readSeedValue("SEED_ADMIN_ROLE", DEFAULT_BOOTSTRAP_USER.role),
    division: readSeedValue(
      "SEED_ADMIN_DIVISION",
      DEFAULT_BOOTSTRAP_USER.division,
    ),
    phone: normalizePhone(
      readSeedValue("SEED_ADMIN_PHONE", DEFAULT_BOOTSTRAP_USER.phone),
    ),
  };
}

async function seedUsers() {
  console.log("Seeding users...");

  const bootstrapUser = getBootstrapUser();

  if (!bootstrapUser.password) {
    throw new Error("SEED_ADMIN_PASSWORD must be set.");
  }

  if (bootstrapUser.password.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 8 characters.");
  }

  const role = await prisma.roles.findFirst({
    where: {
      name: {
        equals: bootstrapUser.role,
        mode: "insensitive",
      },
    },
  });
  const division = await prisma.divisions.findFirst({
    where: {
      name: {
        equals: bootstrapUser.division,
        mode: "insensitive",
      },
    },
  });

  if (!role || !division) {
    throw new Error(
      "Bootstrap user role or division not found. Make sure roles and divisions are seeded first.",
    );
  }

  const now = new Date();
  const hashedPassword = await hashPassword(bootstrapUser.password);
  const existingByUsername = await prisma.users.findUnique({
    where: { username: bootstrapUser.username },
  });
  const existingByEmail = await prisma.users.findUnique({
    where: { email: bootstrapUser.email },
  });
  const existingUser = existingByUsername || existingByEmail;

  if (
    existingByUsername &&
    existingByEmail &&
    existingByUsername.id !== existingByEmail.id
  ) {
    throw new Error(
      "Bootstrap username and email are already used by different users.",
    );
  }

  const data = {
    name: bootstrapUser.name,
    username: bootstrapUser.username,
    email: bootstrapUser.email,
    phone: bootstrapUser.phone,
    role_id: role.id,
    division_id: division.id,
    is_active: true,
    is_restrict: false,
    onboarding_status: "ACTIVE",
    email_verified_at: existingUser?.email_verified_at || now,
    password_set_at: existingUser?.password_set_at || now,
    activated_at: existingUser?.activated_at || now,
  };

  if (existingUser) {
    await prisma.users.update({
      where: { id: existingUser.id },
      data,
    });
  } else {
    await prisma.users.create({
      data: {
        ...data,
        id: crypto.randomUUID(),
        password: hashedPassword,
      },
    });
  }

  console.log(`Users seeded! (Login username: ${bootstrapUser.username})`);
}

module.exports = { seedUsers };
