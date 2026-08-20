const assert = require("node:assert/strict");
const test = require("node:test");

const { setRlsContext } = require("./database-rls");

const USER_ID = "11111111-1111-4111-8111-111111111111";

test("konteks RLS menyiapkan scope baca setelah identitas dipasang", async () => {
  const statements = [];
  const client = {
    async $executeRaw(strings, ...values) {
      statements.push({ sql: strings.join("?"), values });
      return 1;
    },
  };

  await setRlsContext(client, USER_ID, "integration-test");

  assert.equal(statements.length, 2);
  assert.match(statements[0].sql, /app\.current_user_id/);
  assert.equal(statements[0].values[0], USER_ID);
  assert.match(statements[1].sql, /ruwang_arsip_prepare_read_context/);
});
