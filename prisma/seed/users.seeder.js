const crypto = require("crypto");
const prisma = require("../../src/config/prisma");
const { hashPassword } = require("../../src/utils/bcrypt");

function readEnv(key) {
  const value = process.env[key];
  return typeof value === "string" ? value.trim() : "";
}

function readBooleanEnv(key) {
  return readEnv(key).toLowerCase() === "true";
}

function normalizeSeedUser(seedUser) {
  return {
    name: seedUser.name || seedUser.username,
    username: String(seedUser.username || "").trim().toLowerCase(),
    email: String(seedUser.email || "").trim().toLowerCase(),
    password: String(seedUser.password || ""),
    role: String(seedUser.role || "").trim(),
    division: String(seedUser.division || "").trim(),
    phone: seedUser.phone || null,
    can_access_restricted_documents: Boolean(
      seedUser.can_access_restricted_documents,
    ),
  };
}

function parseSeedUsersJson() {
  const raw = readEnv("SEED_USERS_JSON");
  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("SEED_USERS_JSON harus berupa JSON array yang valid.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("SEED_USERS_JSON harus berupa JSON array.");
  }

  return parsed.map(normalizeSeedUser);
}

function buildSeedUsers() {
  const adminUsername = readEnv("SEED_ADMIN_USERNAME");
  const adminEmail = readEnv("SEED_ADMIN_EMAIL");
  const adminPassword = readEnv("SEED_ADMIN_PASSWORD");
  const adminRole = readEnv("SEED_ADMIN_ROLE");
  const adminDivision = readEnv("SEED_ADMIN_DIVISION");

  if (
    !adminUsername ||
    !adminEmail ||
    !adminPassword ||
    !adminRole ||
    !adminDivision
  ) {
    throw new Error(
      "Seed user admin wajib dikonfigurasi lewat SEED_ADMIN_USERNAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_ROLE, dan SEED_ADMIN_DIVISION.",
    );
  }

  return [
    normalizeSeedUser({
      name: readEnv("SEED_ADMIN_NAME") || adminUsername,
      username: adminUsername,
      email: adminEmail,
      password: adminPassword,
      role: adminRole,
      division: adminDivision,
      phone: readEnv("SEED_ADMIN_PHONE") || null,
      can_access_restricted_documents: readBooleanEnv(
        "SEED_ADMIN_CAN_ACCESS_RESTRICTED_DOCUMENTS",
      ),
    }),
    ...parseSeedUsersJson(),
  ];
}

function assertValidSeedPassword(seedUser) {
  if (!seedUser.password) {
    throw new Error(`Password seed wajib diisi untuk user ${seedUser.username}.`);
  }

  if (seedUser.password.length < 8) {
    throw new Error(
      `Password seed user ${seedUser.username} minimal 8 karakter.`,
    );
  }

  if (!/^(?=.*[A-Za-z])(?=.*\d).+$/.test(seedUser.password)) {
    throw new Error(
      `Password seed user ${seedUser.username} wajib mengandung huruf dan angka.`,
    );
  }

  if (process.env.NODE_ENV === "production" && seedUser.password.length < 12) {
    throw new Error(
      `Password seed user ${seedUser.username} minimal 12 karakter di production.`,
    );
  }
}

async function upsertSeedUser(seedUser) {
  assertValidSeedPassword(seedUser);

  const role = await prisma.roles.findFirst({
    where: {
      name: {
        equals: seedUser.role,
        mode: "insensitive",
      },
    },
  });
  const division = await prisma.divisions.findFirst({
    where: {
      name: {
        equals: seedUser.division,
        mode: "insensitive",
      },
    },
  });

  if (!role || !division) {
    throw new Error(
      `Role atau divisi seed user ${seedUser.username} tidak ditemukan. Pastikan roles dan divisions sudah di-seed.`,
    );
  }

  const now = new Date();
  const existingByUsername = await prisma.users.findUnique({
    where: { username: seedUser.username },
  });
  const existingByEmail = await prisma.users.findUnique({
    where: { email: seedUser.email },
  });
  const existingUser = existingByUsername || existingByEmail;

  if (
    existingByUsername &&
    existingByEmail &&
    existingByUsername.id !== existingByEmail.id
  ) {
    throw new Error(
      `Username dan email seed user ${seedUser.username} sudah dipakai user berbeda.`,
    );
  }

  const baseData = {
    name: seedUser.name,
    username: seedUser.username,
    email: seedUser.email,
    phone: seedUser.phone,
    role_id: role.id,
    division_id: division.id,
    is_active: true,
    can_access_restricted_documents:
      seedUser.can_access_restricted_documents ?? false,
    onboarding_status: "ACTIVE",
    email_verified_at: existingUser?.email_verified_at || now,
    password_set_at: existingUser?.password_set_at || now,
    activated_at: existingUser?.activated_at || now,
  };

  if (existingUser) {
    const data = { ...baseData };
    if (readBooleanEnv("SEED_RESET_EXISTING_PASSWORDS")) {
      data.password = await hashPassword(seedUser.password);
    }

    await prisma.users.update({
      where: { id: existingUser.id },
      data,
    });
  } else {
    await prisma.users.create({
      data: {
        ...baseData,
        id: crypto.randomUUID(),
        password: await hashPassword(seedUser.password),
      },
    });
  }
}

async function seedUsers() {
  console.log("Seeding users...");

  const seededUsernames = [];

  for (const seedUser of buildSeedUsers()) {
    await upsertSeedUser(seedUser);
    seededUsernames.push(seedUser.username);
  }

  console.log(`Users seeded! (Login usernames: ${seededUsernames.join(", ")})`);
}

module.exports = { seedUsers };
