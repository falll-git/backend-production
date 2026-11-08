const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { saveOperationSchema } = require('./seputarJaminan.validation');

test('save operation requires explicit intent and preserves existing create/update validation', () => {
  const schema = saveOperationSchema('CONTACT');
  const draft = {label:'Kontak uji',phone_e164:'+628123456789'};
  assert.equal(schema.validate({intent:'SAVE_DRAFT',draft}).error,undefined);
  assert.equal(schema.validate({intent:'SAVE_AND_SUBMIT',draft}).error,undefined);
  for(const body of [{draft},{intent:'SUBMIT',draft},{intent:'SAVE_DRAFT',resource_id:randomUUID(),draft},
    {intent:'SAVE_DRAFT',draft:{...draft,is_default:true}}, {intent:'SAVE_DRAFT',draft:{...draft,phone_e164:'invalid'}}]) {
    assert.ok(schema.validate(body,{stripUnknown:false}).error);
  }
  assert.equal(schema.validate({intent:'SAVE_AND_SUBMIT',resource_id:randomUUID(),draft:{expected_version:0,label:'Revisi'}}).error,undefined);
});

test('profile operation cannot target arbitrary profile ID; publication still requires real dependencies', () => {
  assert.ok(saveOperationSchema('PROFILE').validate({intent:'SAVE_DRAFT',resource_id:randomUUID(),draft:{}}).error);
  assert.ok(saveOperationSchema('PUBLICATION').validate({intent:'SAVE_AND_SUBMIT',draft:{title:'Aset belum lengkap'}}).error);
});
