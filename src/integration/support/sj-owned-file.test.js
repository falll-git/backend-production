'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { readOwnedFileSync } = require('./sj-owned-file');

function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sj-owned-read-')));
  const files = new Set();
  const put = (name, bytes) => {const file=path.join(directory,name);files.add(file);fs.writeFileSync(file,bytes,{flag:'wx'});return file;};
  t.after(() => {
    assert.equal(fs.realpathSync(directory),directory);
    for (const file of files) {try {fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
    fs.rmdirSync(directory);
  });
  return {directory,files,put};
}

test('reads only the opened descriptor and returns exact BigInt identity', t => {
  const f=fixture(t),file=f.put('proof.json','{"run":"owned"}');let closed=0;
  const io={...fs,readFileSync(){throw Error('path-based read must not happen');},closeSync(fd){closed++;fs.closeSync(fd);}};
  const result=readOwnedFileSync(file,{maxBytes:100,io});
  assert.equal(result.bytes.toString(),' {"run":"owned"}'.trim());
  assert.equal(typeof result.identity.ino,'bigint');assert.equal(closed,1);
});

test('oversized and nonregular inputs fail closed and close the read descriptor',t=>{
  const f=fixture(t),file=f.put('large.txt','12345');let closed=0;
  const io={...fs,closeSync(fd){closed++;fs.closeSync(fd);}};
  assert.throws(()=>readOwnedFileSync(file,{maxBytes:4,io}),/NOT_REGULAR_OR_REPLACED/);
  assert.equal(closed,1);assert.equal(fs.readFileSync(file,'utf8'),'12345');
  assert.throws(()=>readOwnedFileSync('relative'),/PATH_INVALID/);
  for(const maxBytes of [-1,1.5,Infinity,'4'])assert.throws(()=>readOwnedFileSync(file,{maxBytes}),/BOUND_INVALID/);
});

test('replacement between open and validation is rejected without reading or deleting either file',t=>{
  const f=fixture(t),file=f.put('proof.json','original'),saved=path.join(f.directory,'original-retained.json');f.files.add(saved);let swapped=false,read=false;
  const io={...fs,fstatSync(fd,options){const result=fs.fstatSync(fd,options);if(!swapped){swapped=true;fs.renameSync(file,saved);fs.writeFileSync(file,'foreign',{flag:'wx'});}return result;},readSync(){read=true;throw Error('must not read replacement');}};
  assert.throws(()=>readOwnedFileSync(file,{io}),/NOT_REGULAR_OR_REPLACED/);assert.equal(read,false);
  assert.equal(fs.readFileSync(file,'utf8'),'foreign');assert.equal(fs.readFileSync(saved,'utf8'),'original');
});

test('in-place changes during descriptor reads are rejected with both evidence and descriptor preserved safely',t=>{
  const f=fixture(t),file=f.put('proof.json','original');let changed=false,closed=0;
  const io={...fs,readSync(...args){const count=fs.readSync(...args);if(!changed){changed=true;fs.writeFileSync(file,'changed-data');}return count;},closeSync(fd){closed++;fs.closeSync(fd);}};
  assert.throws(()=>readOwnedFileSync(file,{io}),/CHANGED_DURING_READ/);assert.equal(closed,1);assert.equal(fs.readFileSync(file,'utf8'),'changed-data');
});

test('growing files remain bounded even after initial fstat validation',t=>{
  const f=fixture(t),file=f.put('proof.json','small');let changed=false,total=0;
  const io={...fs,readSync(...args){if(!changed){changed=true;fs.appendFileSync(file,'x'.repeat(100));}const count=fs.readSync(...args);total+=count;return count;}};
  assert.throws(()=>readOwnedFileSync(file,{io,maxBytes:8}),/BOUND_EXCEEDED/);assert.equal(total,9);
});

test('linked ancestors cannot authorize reading a proof even when bytes match',t=>{
  const f=fixture(t),file=f.put('proof.json','owned'),link=path.join(f.directory,'alias');
  fs.symlinkSync(f.directory,link,process.platform==='win32'?'junction':'dir');
  try {assert.throws(()=>readOwnedFileSync(path.join(link,'proof.json')),/NOT_REGULAR_OR_REPLACED/);}
  finally {fs.unlinkSync(link);}
  assert.equal(fs.readFileSync(file,'utf8'),'owned');
});
