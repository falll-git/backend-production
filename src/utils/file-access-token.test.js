const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FILE_TOKEN_QUERY_PARAM,
  appendFileAccessToken,
  verifyFileAccessToken,
} = require("./file-access-token");

test("token akses file terikat pada user, modul, entity, dan path", () => {
  const previousSecret = process.env.FILE_ACCESS_SECRET;
  const previousExpiry = process.env.FILE_ACCESS_TOKEN_EXPIRES_IN;
  process.env.FILE_ACCESS_SECRET =
    "test-file-access-secret-that-is-longer-than-32-characters";
  process.env.FILE_ACCESS_TOKEN_EXPIRES_IN = "5m";

  try {
    const storedPath = "/api/digital-archive-files/documents/test.pdf";
    const url = appendFileAccessToken(
      { user: { id: "user-1" } },
      storedPath,
      {
        storedPath,
        module: "digital_archive",
        entityId: "document-1",
      },
    );
    const parsed = new URL(url, "http://localhost");
    const payload = verifyFileAccessToken(
      parsed.searchParams.get(FILE_TOKEN_QUERY_PARAM),
    );

    assert.equal(payload.user_id, "user-1");
    assert.equal(payload.module, "digital_archive");
    assert.equal(payload.entity_id, "document-1");
    assert.equal(payload.path, storedPath);
  } finally {
    if (previousSecret === undefined) delete process.env.FILE_ACCESS_SECRET;
    else process.env.FILE_ACCESS_SECRET = previousSecret;

    if (previousExpiry === undefined) {
      delete process.env.FILE_ACCESS_TOKEN_EXPIRES_IN;
    } else {
      process.env.FILE_ACCESS_TOKEN_EXPIRES_IN = previousExpiry;
    }
  }
});

test("token yang diubah ditolak", () => {
  const previousSecret = process.env.FILE_ACCESS_SECRET;
  process.env.FILE_ACCESS_SECRET =
    "test-file-access-secret-that-is-longer-than-32-characters";

  try {
    assert.equal(verifyFileAccessToken("token-tidak-valid"), null);
  } finally {
    if (previousSecret === undefined) delete process.env.FILE_ACCESS_SECRET;
    else process.env.FILE_ACCESS_SECRET = previousSecret;
  }
});
