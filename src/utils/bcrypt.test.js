const assert = require("node:assert/strict");
const test = require("node:test");

const { getBcryptRounds } = require("./bcrypt");

test("cost bcrypt production aman dan tetap dibatasi", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRounds = process.env.BCRYPT_ROUNDS;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.BCRYPT_ROUNDS;
    assert.equal(getBcryptRounds(), 12);
    process.env.BCRYPT_ROUNDS = "15";
    assert.equal(getBcryptRounds(), 15);
    process.env.BCRYPT_ROUNDS = "16";
    assert.equal(getBcryptRounds(), 12);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalRounds === undefined) delete process.env.BCRYPT_ROUNDS;
    else process.env.BCRYPT_ROUNDS = originalRounds;
  }
});
