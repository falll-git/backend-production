'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// A fresh persistent context enables native Chrome settings for zoom QA.
// Never attach to, copy, or alter the user's normal Chrome profile.
function ownedBrowserProfile(proof,cross){
 if(!cross.uiStep6||cross.uiInitialProfileMode||cross.uiFinalLifecycleMode)return null;
 assert.equal(proof.kind,'RA-SJ-02-disposable-v1');assert.match(proof.runId,/^[a-f0-9]{32}$/);assert.match(proof.tokenHash,/^[a-f0-9]{64}$/);
 assert.ok(path.isAbsolute(proof.root));
 for(const dir of [proof.root,path.join(proof.root,'tmp')]){assert.equal(fs.lstatSync(dir).isSymbolicLink(),false);assert.equal(fs.realpathSync(dir),path.resolve(dir));assert.ok(fs.statSync(dir).isDirectory());}
 const ownerPath=path.join(proof.root,'owner.json');assert.equal(fs.lstatSync(ownerPath).isSymbolicLink(),false);
 const owner=JSON.parse(fs.readFileSync(ownerPath));assert.equal(owner.runId,proof.runId);assert.equal(owner.tokenHash,proof.tokenHash);
 const directory=path.join(proof.root,'tmp','step6-cli-profile');assert.equal(fs.existsSync(directory),false,'FRESH_OWNED_PROFILE_REQUIRED');
 return {directory,openArgument:'--profile='+directory,scope:'Fresh owned disposable profile for native browser zoom; never installed/user profile. Removed with exact run tmp after browser CLOSE.'};
}
module.exports={ownedBrowserProfile};
