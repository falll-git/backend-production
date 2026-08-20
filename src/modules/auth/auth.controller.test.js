const assert = require("node:assert/strict");
const test = require("node:test");

const controller = require("./auth.controller");
const service = require("./auth.service");
const { AppError } = require("../../utils/errors");

function createRequest() {
  return {
    body: {},
    cookies: { refresh_token: "refresh-cookie" },
    headers: { "user-agent": "auth-controller-test" },
    ip: "127.0.0.1",
  };
}

function createResponse() {
  const result = {
    clearCookieCalls: [],
    cookieCalls: [],
    payload: null,
    statusCode: 200,
  };

  return {
    result,
    clearCookie(...args) {
      result.clearCookieCalls.push(args);
      return this;
    },
    cookie(...args) {
      result.cookieCalls.push(args);
      return this;
    },
    json(payload) {
      result.payload = payload;
      return this;
    },
    status(statusCode) {
      result.statusCode = statusCode;
      return this;
    },
  };
}

test("refresh invalid tidak dapat menghapus cookie yang mungkin sudah diganti request lain", async (t) => {
  t.mock.method(service, "refreshToken", async () => {
    throw new AppError("Sesi login tidak valid.", 401);
  });
  const response = createResponse();

  await controller.refresh(createRequest(), response);

  assert.equal(response.result.statusCode, 401);
  assert.deepEqual(response.result.payload, {
    status: false,
    message: "Sesi login tidak valid.",
  });
  assert.equal(response.result.clearCookieCalls.length, 0);
});

test("gangguan internal refresh menjadi respons aman tanpa menghapus cookie", async (t) => {
  t.mock.method(service, "refreshToken", async () => {
    throw new Error("detail koneksi database internal");
  });
  const response = createResponse();

  await controller.refresh(createRequest(), response);

  assert.equal(response.result.statusCode, 500);
  assert.deepEqual(response.result.payload, {
    status: false,
    message: "Layanan autentikasi sedang mengalami gangguan. Silakan coba lagi.",
  });
  assert.equal(response.result.clearCookieCalls.length, 0);
});

test("antrean database refresh menjadi 503 yang dapat dicoba ulang", async (t) => {
  t.mock.method(service, "refreshToken", async () => {
    const error = new Error("transaction queue detail");
    error.code = "P2028";
    throw error;
  });
  const response = createResponse();

  await controller.refresh(createRequest(), response);

  assert.equal(response.result.statusCode, 503);
  assert.deepEqual(response.result.payload, {
    status: false,
    message: "Layanan autentikasi sedang sibuk. Silakan coba lagi.",
  });
  assert.equal(response.result.clearCookieCalls.length, 0);
});
