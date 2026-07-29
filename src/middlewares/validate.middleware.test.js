const assert = require("node:assert/strict");
const test = require("node:test");
const Joi = require("joi");

const validate = require("./validate.middleware");

function createResponse() {
  return {
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
}

test("body undefined divalidasi sebagai objek kosong", () => {
  const middleware = validate(
    Joi.object({
      file: Joi.object().required().label("File dokumen"),
    }),
  );
  const req = { body: undefined };
  const res = createResponse();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 422);
  assert.equal(res.payload.success, false);
  assert.match(res.payload.errors.join(" "), /File dokumen/);
});

test("body valid tetap dinormalisasi dan diteruskan", () => {
  const middleware = validate(
    Joi.object({
      name: Joi.string().trim().required(),
    }),
  );
  const req = { body: { name: "  Dokumen  ", ignored: true } };
  const res = createResponse();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.body, { name: "Dokumen" });
  assert.equal(res.payload, null);
});
