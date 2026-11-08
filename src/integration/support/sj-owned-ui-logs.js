'use strict';
// Private, exact-run Next output only. No environment dump. Known random test
// capabilities are redacted across chunk boundaries, including UTF-8 splits.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),{StringDecoder}=require('node:string_decoder');
function createOwnedUiLogs({directory,label,secrets=[]}){
  assert.ok(path.isAbsolute(directory));assert.match(label,/^[a-z][a-z0-9-]{0,40}$/);
  const stat=fs.lstatSync(directory);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());
  assert.equal(fs.realpathSync(directory),path.resolve(directory));
  const values=[];
  for(const value of secrets){if(typeof value!=='string')continue;values.push(value);
    // A driver may print the password field without its complete URL.
    try{const url=new URL(value);if(url.password){values.push(url.password,decodeURIComponent(url.password));}}catch{}
  }
  const masks=[...new Set(values.filter(value=>value.length>=8))].sort((a,b)=>b.length-a.length);
  const tail=Math.max(1,...masks.map(value=>value.length));
  assert.ok(tail<=65_536,'UI_LOG_SECRET_BOUND_INVALID');
  const entries={};let closed=false;
  const created=[];
  try{
    for(const name of ['stdout','stderr']){
      const filename=path.join(directory,label+'-'+name+'.log');
      const fd=fs.openSync(filename,'wx',0o600);created.push(fd);
      entries[name]={filename,fd,decoder:new StringDecoder('utf8'),pending:'',bytes:0,hash:crypto.createHash('sha256')};
    }
  }catch(error){for(const fd of created)fs.closeSync(fd);throw error;}
  function output(entry,text){
    for(const value of masks)text=text.split(value).join('[redacted-owned-test-secret]');
    const bytes=Buffer.from(text);let offset=0;
    while(offset<bytes.length){const n=fs.writeSync(entry.fd,bytes,offset,bytes.length-offset);assert.ok(n>0,'UI_LOG_PARTIAL_WRITE_FAILED');offset+=n;}
    entry.bytes+=bytes.length;entry.hash.update(bytes);
  }
  function flush(entry,final){
    let boundary=final?entry.pending.length:Math.max(0,entry.pending.length-tail);
    if(!boundary)return;
    // Keep an entire literal secret if the chosen boundary bisects it.
    let previous;
    do{previous=boundary;for(const value of masks){let index=entry.pending.indexOf(value);
      while(index>=0&&index<boundary){if(index+value.length>boundary)boundary=index;index=entry.pending.indexOf(value,index+1);}
    }}while(boundary!==previous);
    if(!boundary)return;
    const text=entry.pending.slice(0,boundary);entry.pending=entry.pending.slice(boundary);output(entry,text);
  }
  function write(name,chunk){assert.equal(closed,false,'UI_LOG_ALREADY_CLOSED');const entry=entries[name];entry.pending+=entry.decoder.write(chunk);flush(entry,false);}
  function close(){
    if(closed)return entries.receipt;
    let failure;
    const receipt={kind:'owned-next-output-redacted-v1',label,stdout:null,stderr:null};
    for(const name of ['stdout','stderr']){
      const entry=entries[name];
      try{entry.pending+=entry.decoder.end();flush(entry,true);fs.fsyncSync(entry.fd);
        receipt[name]={path:entry.filename,bytes:entry.bytes,sha256:entry.hash.digest('hex')};}
      catch(error){failure??=error;}
      finally{try{fs.closeSync(entry.fd);}catch(error){failure??=error;}}
    }
    closed=true;entries.receipt=receipt;
    if(failure)throw Error('OWNED_UI_LOG_FINALIZATION_FAILED');
    return receipt;
  }
  return {stdout:chunk=>write('stdout',chunk),stderr:chunk=>write('stderr',chunk),close};
}
module.exports={createOwnedUiLogs};
