'use strict';
// Exact disposable test key. This helper never spawns or signals a child.
// The caller must already have authenticated the fresh disposable container proof.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fail=code=>{const error=Error(code);error.code=code;throw error;};
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
const same=(left,right)=>left.dev===right.dev&&left.ino===right.ino;
function directory(filename){
  const stat=fs.lstatSync(filename);
  if(stat.isSymbolicLink()||!stat.isDirectory()||fs.realpathSync(filename)!==path.resolve(filename))fail('UI_KEY_DIRECTORY_UNSAFE');
  return identity(stat);
}
function regular(filename,maxBytes){
  const stat=fs.lstatSync(filename);
  if(stat.isSymbolicLink()||!stat.isFile()||stat.nlink!==1||stat.size>maxBytes||fs.realpathSync(filename)!==path.resolve(filename))fail('UI_KEY_FILE_UNSAFE');
  return stat;
}
function validateProof(proof){
  if(proof?.kind!=='RA-SJ-02-disposable-v1'||!/^[a-f0-9]{32}$/.test(proof.runId||'')||!/^[a-f0-9]{64}$/.test(proof.tokenHash||'')||!path.isAbsolute(proof.root||''))fail('UI_KEY_PROOF_INVALID');
  directory(proof.root);directory(path.join(proof.root,'tmp'));
  const ownerFile=path.join(proof.root,'owner.json');regular(ownerFile,8192);
  const owner=JSON.parse(fs.readFileSync(ownerFile,'utf8'));
  if(owner.runId!==proof.runId||owner.tokenHash!==proof.tokenHash)fail('UI_KEY_OWNER_MISMATCH');
}
function createOwnedUiKey(input,mode){
  if(!['initial','main','final'].includes(mode))fail('UI_KEY_MODE_INVALID');
  const proof=Object.freeze({kind:input?.kind,runId:input?.runId,tokenHash:input?.tokenHash,root:input?.root});
  validateProof(proof);
  const parents=[proof.root,path.join(proof.root,'tmp')];
  const base=path.join(proof.root,'tmp','ui-key-'+mode);
  // Exclusive mkdir rejects any old file, directory or dangling link. Never use
  // recursive mkdir here and never modify the reusable UI build's shared key.
  fs.mkdirSync(base,{mode:0o700});parents.push(base);
  for(const part of ['shared','demoruwangarsip']){
    const next=path.join(parents[parents.length-1],part);fs.mkdirSync(next,{mode:0o700});parents.push(next);
  }
  const parentIdentity=parents.map(filename=>({filename,identity:directory(filename)}));
  const filename=path.join(parents[parents.length-1],'server-actions.key');
  let secret=crypto.randomBytes(32).toString('base64'),fd;
  const bytes=Buffer.from(secret,'utf8'),keySha256=sha(bytes);
  try{
    fd=fs.openSync(filename,'wx',0o600);let offset=0;
    while(offset<bytes.length){const written=fs.writeSync(fd,bytes,offset,bytes.length-offset);if(written<=0)fail('UI_KEY_WRITE_INCOMPLETE');offset+=written;}
    fs.fsyncSync(fd);
  }finally{if(fd!==undefined)fs.closeSync(fd);bytes.fill(0);}
  const keyIdentity=identity(regular(filename,44));
  let state='PREPARED',child=null,observer=null;
  const publicReceipt=()=>Object.freeze({kind:'owned-disposable-ui-key-v1',runId:proof.runId,mode,path:filename,sha256:keySha256});
  function markSpawnInvoked(){
    if(state!=='PREPARED')fail('UI_KEY_SPAWN_STATE_INVALID');
    // Once invocation begins, a synchronous exception with no child handle is
    // ambiguous. Retain the key; do not manufacture never-invoked cleanup.
    state='INVOKED';
  }
  function bindChild(actualChild,actualObserver){
    if(state!=='INVOKED'||!actualChild||typeof actualChild.once!=='function'||typeof actualChild.kill!=='function'||!actualObserver||typeof actualObserver.stop!=='function'||typeof actualObserver.waitClose!=='function')fail('UI_KEY_CHILD_BINDING_INVALID');
    child=actualChild;observer=actualObserver;state='BOUND';
  }
  function cleanup(){
    if(state==='RELEASED')fail('UI_KEY_ALREADY_RELEASED');
    const neverInvoked=state==='PREPARED';
    const closed=state==='BOUND'&&observer.closed===true&&observer.receipt?.proof==='ACTUAL_CHILD_CLOSE_NOT_EXIT'&&observer.receipt.pid===(child.pid??null);
    if(!neverInvoked&&!closed)fail('UI_KEY_CLOSE_UNCONFIRMED_RETAIN_RESOURCES');
    validateProof(proof);
    for(const item of parentIdentity)if(!same(directory(item.filename),item.identity))fail('UI_KEY_PARENT_REPLACED');
    const current=regular(filename,44);
    if(!same(identity(current),keyIdentity)||current.size!==44||sha(fs.readFileSync(filename))!==keySha256)fail('UI_KEY_CHANGED_RETAIN_RESOURCES');
    fs.unlinkSync(filename);state='RELEASED';secret='';
    // Leave only empty, exact-owned directories for existing parent tmp cleanup.
    return Object.freeze({...publicReceipt(),removed:true,proof:neverInvoked?'SPAWN_NEVER_INVOKED':'ACTUAL_BOUND_CHILD_CLOSE',closedPid:closed?observer.receipt.pid:null});
  }
  const result={envPatch:Object.freeze({NEXT_SERVER_ACTIONS_ENCRYPTION_KEY_FILE:filename}),receipt:publicReceipt(),markSpawnInvoked,bindChild,cleanup};
  // Existing UI output redaction consumes this value in memory only. It must
  // never appear in JSON receipts, child arguments, public proof or exceptions.
  Object.defineProperty(result,'logSecret',{enumerable:false,get:()=>secret});
  return Object.freeze(result);
}
module.exports={createOwnedUiKey};
