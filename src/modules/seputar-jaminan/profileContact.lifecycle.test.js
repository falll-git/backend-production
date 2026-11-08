const assert = require("node:assert/strict");
const test = require("node:test");

const { hasContactReferences } = require("./contactUsage");

test("pencabutan menggunakan bukti referensi lintas divisi dan fail-closed saat hasil rusak", async () => {
  for (const used of [true,false]) assert.equal(await hasContactReferences({$queryRaw:async()=>[{used}]},'contact-id'),used);
  for (const rows of [[],[{}],[{used:0}],[{used:false},{used:true}]]) {
    await assert.rejects(hasContactReferences({$queryRaw:async()=>rows},'contact-id'),{statusCode:503});
  }
});
