const assert = require("node:assert/strict");
const test = require("node:test");

const { authSchema } = require("./auth.validation");

test("input login dibatasi sebelum kredensial diproses", () => {
  const result = authSchema.validate({
    username: "u".repeat(129),
    password: "p".repeat(129),
  });

  assert.ok(result.error);
  assert.deepEqual(
    new Set(result.error.details.map((detail) => detail.type)),
    new Set(["string.max"]),
  );
});
