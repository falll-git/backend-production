const test=require('node:test');
const assert=require('node:assert/strict');
const {requestError}=require('./requestError');
function response(){return {status(n){this.code=n;return this;},json(v){this.body=v;return this;}};}
test('SJ server failures are observable without leaking driver payloads',()=>{
  const error=Object.assign(new Error('SQL PRIVATE CUSTOMER PAYLOAD'),{statusCode:500,code:'P2010'});
  let logged;
  const res=requestError(response(),error,(safe,options)=>{logged={message:safe.message,options};});
  assert.equal(res.code,500);
  assert.equal(res.body.message,'Permintaan belum dapat diproses.');
  assert.equal(logged.options.fields.code,'P2010');
  assert.doesNotMatch(JSON.stringify({res,logged}),/PRIVATE CUSTOMER/);
});
test('SJ expected validation and conflict responses keep helpful messages',()=>{
  for(const statusCode of [403,404,409,422]){
    const res=requestError(response(),{statusCode,message:'Muat ulang sebelum melanjutkan.'},()=>assert.fail('expected errors are not server faults'));
    assert.equal(res.code,statusCode);assert.equal(res.body.message,'Muat ulang sebelum melanjutkan.');
  }
});
