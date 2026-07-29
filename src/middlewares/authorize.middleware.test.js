const assert = require("node:assert/strict");
const test = require("node:test");

const prisma = require("../config/prisma");
const authorize = require("./authorize.middleware");

test("kegagalan pemeriksaan izin tidak membocorkan error internal", async () => {
  const originalFindFirst = prisma.users.findFirst;
  const originalConsoleError = console.error;
  prisma.users.findFirst = async () => {
    throw new Error("rahasia koneksi database");
  };
  console.error = () => {};

  const req = {
    user: { id: "user-test" },
    requestId: "request-test",
    method: "GET",
    originalUrl: "/api/v1/protected",
  };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  let continued = false;

  try {
    await authorize("/dashboard/protected", "read")(req, res, () => {
      continued = true;
    });
  } finally {
    prisma.users.findFirst = originalFindFirst;
    console.error = originalConsoleError;
  }

  assert.equal(continued, false);
  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.message, "Gagal memverifikasi izin akses.");
  assert.doesNotMatch(res.payload.message, /rahasia|database/i);
});
