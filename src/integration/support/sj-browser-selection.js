'use strict';
// Test-only explicit portable browser selection. No download, installation,
// app configuration or silent default replacement happens here.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {readOwnedFileSync}=require('./sj-owned-file');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const keys=x=>Object.keys(x).sort();
const regularOwnedFile=file=>{
  try { return readOwnedFileSync(file).bytes; }
  catch(error) { throw new Error('browser proof file must be regular, not linked; linked ancestor rejected', {cause:error}); }
};
function resolveTestBrowserSelection(proofPath){
  if(proofPath===undefined)return null;
  assert.ok(typeof proofPath==='string'&&path.isAbsolute(proofPath));
  const bytes=regularOwnedFile(proofPath),p=JSON.parse(bytes);
  assert.equal(p.kind,'owned-portable-test-browser-v1');assert.match(p.owner,/^[a-f0-9-]{36}$/);
  assert.match(p.version,/^\d+\.\d+\.\d+\.\d+$/);
  assert.equal(p.url,`https://storage.googleapis.com/chrome-for-testing-public/${p.version}/win64/chrome-win64.zip`);
  const root=path.dirname(p.configPath);assert.ok(path.isAbsolute(root));
  assert.equal(fs.realpathSync(root),path.resolve(root));assert.equal(fs.lstatSync(root).isSymbolicLink(),false);
  const markerPath=path.join(root,'owner.json');
  const marker=JSON.parse(regularOwnedFile(markerPath));
  for(const k of ['kind','owner','version','revision','url'])assert.equal(marker[k],p[k]);
  assert.equal(path.resolve(p.archive),path.join(root,'chrome-win64.zip'));
  assert.equal(path.resolve(p.executable),path.join(root,'chrome-win64','chrome.exe'));
  assert.equal(path.resolve(p.configPath),path.join(root,'playwright-cli.json'));
  const browserRoot=path.join(root,'chrome-win64'),browserStat=fs.lstatSync(browserRoot);
  assert.ok(browserStat.isDirectory()&&!browserStat.isSymbolicLink(),'browser tree root must be an owned real directory');
  assert.equal(fs.realpathSync(browserRoot),path.resolve(browserRoot),'linked browser tree root');
  const archive=regularOwnedFile(p.archive);assert.equal(hash(archive),p.archiveSha256);
  assert.equal(crypto.createHash('md5').update(archive).digest('base64'),p.providerMd5);
  assert.equal(hash(regularOwnedFile(p.executable)),p.executableSha256);
  const cbytes=regularOwnedFile(p.configPath),config=JSON.parse(cbytes);
  assert.equal(hash(cbytes),p.configSha256);assert.deepEqual(keys(config),['browser']);
  assert.deepEqual(keys(config.browser),['browserName','launchOptions']);assert.equal(config.browser.browserName,'chromium');
  const opts=config.browser.launchOptions;assert.deepEqual(keys(opts),['channel','executablePath','headless']);
  assert.equal(opts.channel,'chromium');assert.equal(opts.headless,true);assert.equal(opts.executablePath,p.executable);
  const tree=[];function walk(dir,rel=''){for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,e.name),key=rel?rel+'/'+e.name:e.name;assert.equal(e.isSymbolicLink(),false);if(e.isDirectory())walk(file,key);else if(e.isFile()){const {bytes,identity}=readOwnedFileSync(file);tree.push({path:key,bytes:Number(identity.size),sha256:hash(bytes)});}}}
  walk(browserRoot);assert.deepEqual(tree,p.tree);assert.equal(hash(Buffer.from(JSON.stringify(tree))),p.treeDigest);
  assert.equal(p.signatureStatus,'NotSigned');assert.equal(p.verifiedBy,'official authenticated HTTPS CFT metadata + object checksum + frozen SHA256 tree');
  return Object.freeze({version:p.version,configPath:p.configPath,proofPath,proofSha256:hash(bytes),executableSha256:p.executableSha256,treeDigest:p.treeDigest,signatureStatus:p.signatureStatus,selection:'explicit portable CFT test browser; no installed browser update'});
}
function browserCommandArgs(args,selection){return [...args,...(selection&&args[0]==='open'?['--config',selection.configPath]:[])];}
module.exports={resolveTestBrowserSelection,browserCommandArgs};
