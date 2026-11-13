'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createOwnedUiLogs}=require('./sj-owned-ui-logs');
function fixture(callback){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sj-owned-ui-log-unit-'));
  const canonical=fs.realpathSync(root);
  try{return callback(root);}finally{
    assert.equal(fs.realpathSync(root),canonical);assert.equal(fs.lstatSync(root).isSymbolicLink(),false);
    for(const name of fs.readdirSync(root)){const file=path.join(root,name);assert.equal(fs.lstatSync(file).isSymbolicLink(),false);assert.equal(fs.lstatSync(file).isFile(),true);fs.unlinkSync(file);}
    fs.rmdirSync(root);
  }
}
test('literal random capability is redacted across every byte boundary with UTF8 intact',()=>fixture(root=>{
  const secret=crypto.randomBytes(24).toString('base64url'),source=Buffer.from('préfix:'+secret+':尾部\n');
  const logs=createOwnedUiLogs({directory:root,label:'redacted',secrets:[secret]});
  for(const byte of source)logs.stdout(Buffer.from([byte]));logs.stderr(Buffer.from('separate stream\n'));
  const receipt=logs.close(),text=fs.readFileSync(receipt.stdout.path,'utf8');
  assert.equal(text,'préfix:[redacted-owned-test-secret]:尾部\n');assert.ok(!text.includes(secret));
  assert.equal(receipt.stdout.sha256,crypto.createHash('sha256').update(text).digest('hex'));
  assert.equal(fs.readFileSync(receipt.stderr.path,'utf8'),'separate stream\n');
}));
test('overlapping secrets cannot be bisected by a streaming flush boundary',()=>fixture(root=>{
  const logs=createOwnedUiLogs({directory:root,label:'overlap',secrets:['1234567890abcdef','7890abcdefGHIJKLMNOP']});
  logs.stdout(Buffer.from('prefix:1234567890abcdefGHIJKLMNOP suffix:'+'x'.repeat(80)));
  logs.stdout(Buffer.from(' tail'));const receipt=logs.close(),text=fs.readFileSync(receipt.stdout.path,'utf8');
  assert.ok(!text.includes('1234567890abcdef'));assert.ok(!text.includes('7890abcdefGHIJKLMNOP'));
  assert.match(text,/prefix:/);assert.match(text,/ tail$/);
}));
test('log paths are exclusive and existing bytes are never overwritten',()=>fixture(root=>{
  fs.writeFileSync(path.join(root,'same-stdout.log'),'owned sentinel',{flag:'wx'});
  assert.throws(()=>createOwnedUiLogs({directory:root,label:'same'}));
  assert.equal(fs.readFileSync(path.join(root,'same-stdout.log'),'utf8'),'owned sentinel');
}));
test('unsafe labels and relative directories fail before log creation',()=>fixture(root=>{
  for(const label of ['../outside','with/path','', 'INVALID'])assert.throws(()=>createOwnedUiLogs({directory:root,label}));
  assert.throws(()=>createOwnedUiLogs({directory:'relative',label:'safe'}));assert.deepEqual(fs.readdirSync(root),[]);
}));
test('close is idempotent and rejects subsequent writes',()=>fixture(root=>{
  const logs=createOwnedUiLogs({directory:root,label:'once'});logs.stdout(Buffer.from('trailing'));
  const receipt=logs.close();assert.equal(logs.close(),receipt);assert.throws(()=>logs.stdout(Buffer.from('after')));
  assert.equal(fs.readFileSync(receipt.stdout.path,'utf8'),'trailing');
}));
test('URL credentials are masked when a driver prints just a password field',()=>fixture(root=>{
  const logs=createOwnedUiLogs({directory:root,label:'url',secrets:['postgresql://owned:synthetic%21Password99@127.0.0.1:49999/owned']});
  logs.stderr(Buffer.from('password=synthetic!Password99 encoded=synthetic%21Pass'));
  logs.stderr(Buffer.from('word99'));const receipt=logs.close(),text=fs.readFileSync(receipt.stderr.path,'utf8');
  assert.equal(text,'password=[redacted-owned-test-secret] encoded=[redacted-owned-test-secret]');
}));
