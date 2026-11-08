const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {resolveTestBrowserSelection,browserCommandArgs}=require('./sj-browser-selection');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sj-browser-selection-unit-'));fs.mkdirSync(root+'/chrome-win64');
  const marker={kind:'owned-portable-test-browser-v1',owner:crypto.randomUUID(),version:'157.0.8099.0',revision:'1716465',url:'https://storage.googleapis.com/chrome-for-testing-public/157.0.8099.0/win64/chrome-win64.zip'};
  fs.writeFileSync(root+'/owner.json',JSON.stringify(marker));fs.writeFileSync(root+'/chrome-win64.zip','unit archive, not executable');fs.writeFileSync(root+'/chrome-win64/chrome.exe','unit binary bytes, never launched');
  const executable=root+'/chrome-win64/chrome.exe',configPath=root+'/playwright-cli.json',config={browser:{browserName:'chromium',launchOptions:{channel:'chromium',executablePath:executable,headless:true}}};
  fs.writeFileSync(configPath,JSON.stringify(config));const archive=fs.readFileSync(root+'/chrome-win64.zip');
  const tree=[{path:'chrome.exe',bytes:fs.statSync(executable).size,sha256:hash(fs.readFileSync(executable))}];
  const proof={...marker,archive:root+'/chrome-win64.zip',archiveSha256:hash(archive),providerMd5:crypto.createHash('md5').update(archive).digest('base64'),executable,executableSha256:tree[0].sha256,configPath,configSha256:hash(fs.readFileSync(configPath)),tree,treeDigest:hash(Buffer.from(JSON.stringify(tree))),signatureStatus:'NotSigned',verifiedBy:'official authenticated HTTPS CFT metadata + object checksum + frozen SHA256 tree'};
  const proofPath=root+'/proof.json',save=()=>fs.writeFileSync(proofPath,JSON.stringify(proof));save();
  t.after(()=>{assert.equal(fs.realpathSync(root),path.resolve(root));assert.equal(JSON.parse(fs.readFileSync(root+'/owner.json')).owner,marker.owner);fs.rmSync(root,{recursive:true});});
  return {root,proof,proofPath,save,config,configPath};
}
test('no explicit proof retains default; config is open-only on the installed CLI contract',()=>{
  assert.equal(resolveTestBrowserSelection(),null);const selected={configPath:'/unit-only'};
  assert.deepEqual(browserCommandArgs(['open','http://unit.invalid'],selected),['open','http://unit.invalid','--config','/unit-only']);
  for(const command of ['snapshot','run-code','close'])assert.deepEqual(browserCommandArgs([command],selected),[command]);
});
test('complete byte-pinned proof validates without executing binary (unit fixture, not publisher proof)',t=>{
  const f=fixture(t),r=resolveTestBrowserSelection(f.proofPath);assert.equal(r.version,'157.0.8099.0');assert.equal(r.signatureStatus,'NotSigned');
});
for(const [name,mutate]of [
  ['wrong owner',f=>{f.proof.owner=crypto.randomUUID();f.save();}],
  ['changed binary',f=>fs.appendFileSync(f.proof.executable,'changed')],
  ['added tree file',f=>fs.writeFileSync(f.root+'/chrome-win64/extra.dll','changed')],
  ['wrong provider checksum',f=>{f.proof.providerMd5='invalid';f.save();}],
  ['outside executable',f=>{f.proof.executable='/outside/chrome.exe';f.save();}],
  ['unapproved config hooks',f=>{f.config.browser.initPage=['/outside'];fs.writeFileSync(f.configPath,JSON.stringify(f.config));f.proof.configSha256=hash(fs.readFileSync(f.configPath));f.save();}],
])test(name+' fails closed before any browser launch',t=>{const f=fixture(t);mutate(f);assert.throws(()=>resolveTestBrowserSelection(f.proofPath));});

test('actual browser-root junction is rejected before following the tree',t=>{
  const f=fixture(t),tree=path.join(f.root,'chrome-win64'),saved=path.join(f.root,'owned-tree-original');
  assert.equal(fs.realpathSync(f.root),path.resolve(f.root));
  fs.renameSync(tree,saved);
  try{fs.symlinkSync(saved,tree,process.platform==='win32'?'junction':'dir');assert.throws(()=>resolveTestBrowserSelection(f.proofPath),/owned real directory/);}
  finally{if(fs.lstatSync(tree,{throwIfNoEntry:false})?.isSymbolicLink())fs.unlinkSync(tree);fs.renameSync(saved,tree);}
});
test('actual proof ancestor junction is rejected even when bytes and owner match',t=>{
  const f=fixture(t),linked=path.join(f.root,'owned-proof-alias');
  fs.symlinkSync(f.root,linked,process.platform==='win32'?'junction':'dir');
  try{assert.throws(()=>resolveTestBrowserSelection(path.join(linked,'proof.json')),/linked ancestor/);}
  finally{fs.unlinkSync(linked);}
});
for(const property of ['proofPath','archive','executable','configPath','marker']){
  test(property+' linked-file metadata fails closed (explicit filesystem test double)',t=>{
    const f=fixture(t),target=property==='marker'?path.join(f.root,'owner.json'):property==='proofPath'?f.proofPath:f.proof[property];
    const original=fs.lstatSync;
    try{
      fs.lstatSync=(file,...args)=>path.resolve(file)===path.resolve(target)?{isFile:()=>true,isSymbolicLink:()=>true}:original(file,...args);
      assert.throws(()=>resolveTestBrowserSelection(f.proofPath),/regular, not linked/);
    }finally{fs.lstatSync=original;}
  });
}
