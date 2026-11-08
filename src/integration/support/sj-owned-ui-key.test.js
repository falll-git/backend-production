'use strict';
// Disposable key regressions; no normal configuration or application service.
// Finite filesystem/refusal tests; EventEmitter cases are not actual child proof.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {createOwnedUiKey}=require('./sj-owned-ui-key');
const {observeOwnedUiChild}=require('./sj-owned-ui-child');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sj-owned-ui-key-test-'));
  let retained=false;
  // Exact mkdtemp return checked once; no user-selected or broad recursive target.
  assert.equal(fs.realpathSync(root),path.resolve(root));
  const stat=fs.lstatSync(root);assert.equal(stat.isSymbolicLink(),false);
  fs.mkdirSync(path.join(root,'tmp'));
  const proof={kind:'RA-SJ-02-disposable-v1',runId:crypto.randomBytes(16).toString('hex'),tokenHash:sha(crypto.randomBytes(32)),root};
  const owner=path.join(root,'owner.json');fs.writeFileSync(owner,JSON.stringify({runId:proof.runId,tokenHash:proof.tokenHash}),{flag:'wx'});
  t.after(()=>{
    if(retained)return; // Unknown actual child CLOSE retains this exact test root.
    if(fs.existsSync(root)){
      const current=fs.lstatSync(root);
      assert.equal(current.isSymbolicLink(),false);assert.equal(fs.realpathSync(root),path.resolve(root));
      assert.equal(String(current.dev),String(stat.dev));assert.equal(String(current.ino),String(stat.ino));
      // Node rm does not traverse symlink/junction children. Only exact owned root.
      fs.rmSync(root,{recursive:true});
    }
  });
  return {root,proof,owner,retain:()=>{retained=true;}};
}
function fakeChild(){
  const child=new EventEmitter();child.pid=761234;child.exitCode=null;child.signalCode=null;
  child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>true;return child;
}
function bind(key,child=fakeChild()){
  key.markSpawnInvoked();const observer=observeOwnedUiChild(child);key.bindChild(child,observer);return {child,observer};
}
test('fresh key is canonical 32-byte base64 at exact supported owned path, not enumerable',t=>{
  const {proof}=fixture(t),key=createOwnedUiKey(proof,'main');
  assert.equal(key.envPatch.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY_FILE,path.join(proof.root,'tmp','ui-key-main','shared','demoruwangarsip','server-actions.key'));
  const bytes=fs.readFileSync(key.receipt.path),value=bytes.toString('utf8'),decoded=Buffer.from(value,'base64');
  assert.equal(bytes.length,44);assert.equal(decoded.length,32);assert.equal(decoded.toString('base64')===value,true);
  assert.equal(sha(bytes),key.receipt.sha256);assert.equal(JSON.stringify(key).includes(value),false);
  assert.deepEqual(Object.keys(key.envPatch),['NEXT_SERVER_ACTIONS_ENCRYPTION_KEY_FILE']);
  assert.equal(key.cleanup().proof,'SPAWN_NEVER_INVOKED');assert.equal(fs.existsSync(key.receipt.path),false);
});
test('all three modes have separate fresh files and independent random values',t=>{
  const {proof}=fixture(t),keys=['initial','main','final'].map(mode=>createOwnedUiKey(proof,mode));
  assert.equal(new Set(keys.map(key=>key.receipt.path)).size,3);
  assert.equal(new Set(keys.map(key=>key.receipt.sha256)).size,3);
  for(const key of keys)key.cleanup();
});
test('mode traversal and simultaneous-mode surrogate cannot select arbitrary path',t=>{
  const {proof}=fixture(t);for(const mode of ['../normal','INITIAL','','initial-final',null])assert.throws(()=>createOwnedUiKey(proof,mode),{code:'UI_KEY_MODE_INVALID'});
  assert.deepEqual(fs.readdirSync(path.join(proof.root,'tmp')),[]);
});
test('malformed kind, runId, tokenHash and relative root refuse before directory writes',t=>{
  const {proof}=fixture(t);
  for(const override of [{kind:'normal'},{runId:'wrong'},{tokenHash:'bad'},{root:'relative'}])assert.throws(()=>createOwnedUiKey({...proof,...override},'main'),{code:'UI_KEY_PROOF_INVALID'});
  assert.deepEqual(fs.readdirSync(path.join(proof.root,'tmp')),[]);
});
test('mismatched owner refuses without touching other files',t=>{
  const {proof,owner}=fixture(t);fs.writeFileSync(owner,JSON.stringify({runId:'0'.repeat(32),tokenHash:proof.tokenHash}));
  assert.throws(()=>createOwnedUiKey(proof,'main'),{code:'UI_KEY_OWNER_MISMATCH'});assert.deepEqual(fs.readdirSync(path.join(proof.root,'tmp')),[]);
});
test('preexisting mode directory is not adopted, overwritten or removed',t=>{
  const {proof}=fixture(t),base=path.join(proof.root,'tmp','ui-key-main');fs.mkdirSync(base);const sentinel=path.join(base,'foreign.txt');fs.writeFileSync(sentinel,'preserve');
  assert.throws(()=>createOwnedUiKey(proof,'main'),{code:'EEXIST'});assert.equal(fs.readFileSync(sentinel,'utf8'),'preserve');
});
test('junction or symlink tmp is refused before any key creation',t=>{
  const {proof,root}=fixture(t),outside=path.join(root,'separate');fs.mkdirSync(outside);fs.rmdirSync(path.join(root,'tmp'));
  fs.symlinkSync(outside,path.join(root,'tmp'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>createOwnedUiKey(proof,'main'),{code:'UI_KEY_DIRECTORY_UNSAFE'});assert.deepEqual(fs.readdirSync(outside),[]);
});
test('spawn invoked without known child cannot release the key',t=>{
  const {proof}=fixture(t),key=createOwnedUiKey(proof,'main');key.markSpawnInvoked();
  assert.throws(()=>key.cleanup(),{code:'UI_KEY_CLOSE_UNCONFIRMED_RETAIN_RESOURCES'});assert.equal(fs.existsSync(key.receipt.path),true);
});
test('bound child EXIT alone retains key; observed CLOSE permits exact removal',t=>{
  const {proof}=fixture(t),key=createOwnedUiKey(proof,'main'),{child,observer}=bind(key);
  child.exitCode=0;child.emit('exit',0,null);assert.equal(observer.closed,false);
  assert.throws(()=>key.cleanup(),{code:'UI_KEY_CLOSE_UNCONFIRMED_RETAIN_RESOURCES'});assert.equal(fs.existsSync(key.receipt.path),true);
  child.emit('close',0,null);const ended=key.cleanup();assert.equal(ended.proof,'ACTUAL_BOUND_CHILD_CLOSE');assert.equal(ended.closedPid,child.pid);assert.equal(fs.existsSync(key.receipt.path),false);
});
test('real observer failed-spawn CLOSE permits removal but keeps failure flags',t=>{
  const {proof}=fixture(t),key=createOwnedUiKey(proof,'main'),{child,observer}=bind(key);
  child.emit('error',Error('synthetic failure'));child.emit('close',-2,null);
  assert.equal(observer.receipt.spawnError,true);assert.equal(key.cleanup().removed,true);
});
test('only one invocation and one binding are accepted',t=>{
  const {proof}=fixture(t),key=createOwnedUiKey(proof,'main'),{child,observer}=bind(key);
  assert.throws(()=>key.markSpawnInvoked(),{code:'UI_KEY_SPAWN_STATE_INVALID'});assert.throws(()=>key.bindChild(child,observer),{code:'UI_KEY_CHILD_BINDING_INVALID'});
  child.emit('close',0,null);key.cleanup();assert.throws(()=>key.cleanup(),{code:'UI_KEY_ALREADY_RELEASED'});
});
test('wrong close PID cannot release even when another observer reports CLOSE',t=>{
  const {proof}=fixture(t),key=createOwnedUiKey(proof,'main'),{child}=bind(key);child.pid++;child.emit('close',0,null);child.pid--;
  assert.throws(()=>key.cleanup(),{code:'UI_KEY_CLOSE_UNCONFIRMED_RETAIN_RESOURCES'});assert.equal(fs.existsSync(key.receipt.path),true);
});
test('modified key bytes are retained rather than deleted',t=>{
  const {proof}=fixture(t),key=createOwnedUiKey(proof,'main');fs.writeFileSync(key.receipt.path,Buffer.alloc(44,65));
  assert.throws(()=>key.cleanup(),{code:'UI_KEY_CHANGED_RETAIN_RESOURCES'});assert.equal(fs.existsSync(key.receipt.path),true);
});
test('hardlinked key is retained without deleting either name',t=>{
  const {proof}=fixture(t),key=createOwnedUiKey(proof,'main'),alias=path.join(proof.root,'alias.key');fs.linkSync(key.receipt.path,alias);
  assert.throws(()=>key.cleanup(),{code:'UI_KEY_FILE_UNSAFE'});assert.equal(fs.existsSync(alias),true);assert.equal(fs.existsSync(key.receipt.path),true);
});
test('replaced key inode is retained even with original bytes',t=>{
  const {proof}=fixture(t),key=createOwnedUiKey(proof,'main'),original=fs.readFileSync(key.receipt.path),saved=path.join(proof.root,'original.key');
  fs.renameSync(key.receipt.path,saved);fs.writeFileSync(key.receipt.path,original,{flag:'wx'});
  assert.throws(()=>key.cleanup(),{code:'UI_KEY_CHANGED_RETAIN_RESOURCES'});assert.equal(fs.existsSync(saved),true);assert.equal(fs.existsSync(key.receipt.path),true);
});
test('owner change after creation prevents deletion',t=>{
  const {proof,owner}=fixture(t),key=createOwnedUiKey(proof,'main');fs.writeFileSync(owner,JSON.stringify({runId:'0'.repeat(32),tokenHash:proof.tokenHash}));
  assert.throws(()=>key.cleanup(),{code:'UI_KEY_OWNER_MISMATCH'});assert.equal(fs.existsSync(key.receipt.path),true);
});
test('replaced parent directory is retained without deleting new occupant',t=>{
  const {proof}=fixture(t),key=createOwnedUiKey(proof,'main'),shared=path.join(proof.root,'tmp','ui-key-main','shared'),saved=path.join(proof.root,'saved-shared');
  fs.renameSync(shared,saved);fs.mkdirSync(shared);fs.mkdirSync(path.join(shared,'demoruwangarsip'));fs.writeFileSync(key.receipt.path,'foreign-replacement',{flag:'wx'});
  assert.throws(()=>key.cleanup(),{code:'UI_KEY_PARENT_REPLACED'});assert.equal(fs.readFileSync(key.receipt.path,'utf8'),'foreign-replacement');
});
test('child closes before later cleanup registration and key is still safely releasable',t=>{
  const {proof}=fixture(t),key=createOwnedUiKey(proof,'main'),{child}=bind(key);child.emit('close',0,null);
  assert.equal(key.cleanup().proof,'ACTUAL_BOUND_CHILD_CLOSE');assert.equal(key.logSecret==='',true);
});
test('existing log redactor masks key across chunks; receipts contain hash/path only',t=>{
  const {createOwnedUiLogs}=require('./sj-owned-ui-logs');
  const {proof}=fixture(t),key=createOwnedUiKey(proof,'main'),logs=createOwnedUiLogs({directory:proof.root,label:'key-redaction',secrets:[key.logSecret]});
  const secret=key.logSecret;logs.stdout(Buffer.from('before '+secret.slice(0,17)));logs.stdout(Buffer.from(secret.slice(17)+' after'));
  const receipt=logs.close(),output=fs.readFileSync(receipt.stdout.path,'utf8');assert.equal(output.includes(secret),false);assert.equal(output.includes('redacted-owned-test-secret'),true);
  assert.equal(JSON.stringify(key.receipt).includes(secret),false);key.cleanup();
});
test('finite actual Node child CLOSE permits key cleanup through existing observer',async t=>{
  const {spawn}=require('node:child_process'),{proof,retain}=fixture(t),key=createOwnedUiKey(proof,'main');
  key.markSpawnInvoked();let child;
  try{child=spawn(process.execPath,['-e','process.stdout.write("owned-key-finite-child");'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{}});}catch(error){retain();throw error;}
  const observer=observeOwnedUiChild(child);key.bindChild(child,observer);
  try{const receipt=await observer.waitClose(5000);assert.equal(receipt.code,0);assert.equal(receipt.proof,'ACTUAL_CHILD_CLOSE_NOT_EXIT');assert.equal(key.cleanup().removed,true);}
  finally{try{await observer.stop({graceMs:1000,forceMs:1000});}finally{if(!observer.closed)retain();}}
});
test('finite actual failed spawn requires its actual CLOSE before key cleanup',async t=>{
  const {spawn}=require('node:child_process'),{proof,retain}=fixture(t),key=createOwnedUiKey(proof,'main');
  key.markSpawnInvoked();let child;
  try{child=spawn(path.join(proof.root,'nonexistent-owned-node.exe'),[],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{}});}catch(error){retain();throw error;}
  const observer=observeOwnedUiChild(child);key.bindChild(child,observer);
  try{await assert.rejects(observer.waitClose(5000),error=>error.code==='UI_CHILD_SPAWN_FAILED'&&error.receipt.proof==='ACTUAL_CHILD_CLOSE_NOT_EXIT');assert.equal(key.cleanup().removed,true);}
  finally{try{await observer.stop({graceMs:1000,forceMs:1000});}catch(error){assert.equal(error.code,'UI_CHILD_SPAWN_FAILED');}finally{if(!observer.closed)retain();}}
});
