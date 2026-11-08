'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assertPrerequisites,browserSource,assertUiEligibleSource,assertDraftMediaBinding}=require('./sj-step6-ui-journey');
const crypto=require('node:crypto');
function prerequisite(){
  const runId='9'.repeat(32),categories=['LAND','BUILDING','MACHINE_EQUIPMENT','VEHICLE'];
  return {proof:{runId},cross:{performance:false,step6CollateralIds:Object.fromEntries(categories.map(c=>[c,crypto.randomUUID()])),step6CollateralNumbers:Object.fromEntries(categories.map(c=>[c,'SJ-'+runId+'-UI-'+c]))},bankUi:'http://127.0.0.1:3111',publicUi:'http://127.0.0.1:4411',controlOrigin:'http://127.0.0.1:4320'};
}
test('Step6 accepts four distinct bound prerequisite IDs, not business transitions',()=>assert.doesNotThrow(()=>assertPrerequisites(prerequisite())));
test('Step6 rejects performance workloads',()=>{const value=prerequisite();value.cross.performance=true;assert.throws(()=>assertPrerequisites(value),/performance workloads/);});
test('Step6 refuses missing source evidence',()=>{const value=prerequisite();delete value.cross.step6CollateralIds.VEHICLE;assert.throws(()=>assertPrerequisites(value));});
test('Step6 refuses duplicate source IDs',()=>{const value=prerequisite();value.cross.step6CollateralIds.VEHICLE=value.cross.step6CollateralIds.LAND;assert.throws(()=>assertPrerequisites(value));});
test('Step6 refuses prerequisite from another run',()=>{const value=prerequisite();value.cross.step6CollateralNumbers.LAND='other-run';assert.throws(()=>assertPrerequisites(value));});
test('Step6 refuses alternate Control preview',()=>{const value=prerequisite();value.controlOrigin='http://127.0.0.1:4321';assert.throws(()=>assertPrerequisites(value));});
test('browser serialization quotes data and retains the real input function',()=>{
  const source=browserSource(async(page,{value})=>{await page.getByRole('textbox').fill(value);return {done:true};},{value:'";throw Error("no");\\'});
  assert.match(source,/getByRole/);assert.match(source,/\.fill\(value\)/);assert.doesNotThrow(()=>new Function('return ('+source+')'));
});

test('real UI source read requires status and exact owned identity, not a stale API actor session',()=>{
 const expectedId=crypto.randomUUID(),expectedNumber='SJ-'+ '9'.repeat(32)+'-UI-LAND';
 const proof={status:200,choice:{id:expectedId,collateral_number:expectedNumber},expectedId,expectedNumber};
 assert.doesNotThrow(()=>assertUiEligibleSource(proof));
 for(const changed of [{...proof,status:401},{...proof,choice:{...proof.choice,id:crypto.randomUUID()}},{...proof,choice:{...proof.choice,collateral_number:'foreign'}},{...proof,choice:null}])assert.throws(()=>assertUiEligibleSource(changed));
});

test('media readiness gate requires a real committed draft and exact media binding first',()=>{
 const expected={sourceId:crypto.randomUUID(),category:'LAND',title:'Owned UI asset',mediaId:crypto.randomUUID()};
 const asset={state:'DRAFT',source_collateral_id:expected.sourceId,asset_category:expected.category,current_version:{title:expected.title,media:[{id:expected.mediaId}]}};
 assert.doesNotThrow(()=>assertDraftMediaBinding(asset,expected));
 for(const changed of [{...asset,state:undefined},{...asset,current_version:null},{...asset,current_version:{...asset.current_version,media:[]}},{...asset,current_version:{...asset.current_version,media:[{id:crypto.randomUUID()}]}}])assert.throws(()=>assertDraftMediaBinding(changed,expected));
});

test('real new-publication journey saves and proves binding before READY and submit gates',()=>{
 const fs=require('node:fs');const source=fs.readFileSync(require.resolve('./sj-step6-ui-journey'),'utf8');
 const start=source.indexOf('for(const category of CATEGORIES)'),save=source.indexOf("const receipt=await act('save-new-draft-'",start);
 const binding=source.indexOf('assertDraftMediaBinding(asset,',save),ready=source.indexOf('const readyMedia=await settle(',binding),submit=source.indexOf("await act('submit-new-draft-'",ready);
 assert(start>0&&save>start&&binding>save&&ready>binding&&submit>ready);
 assert.doesNotMatch(source.slice(start,save),/await settle\('\/media\//,'an unsaved photo cannot acquire publication binding through a worker');
});

test('Control resize capture waits for actual workspace transition and non-overlap',()=>{
 const fs=require('node:fs'),source=fs.readFileSync(require.resolve('./sj-step6-ui-journey'),'utf8');
 const start=source.indexOf("const screen=async"),end=source.indexOf('const checkScreen=',start),screen=source.slice(start,end);
 assert.match(screen,/document\.getAnimations\(\)/);assert.match(screen,/getComputedStyle\(workspace\)\.marginLeft/);
 assert.match(screen,/workspace\.getBoundingClientRect\(\)\.left>=sidebar\.getBoundingClientRect\(\)\.right/);
 assert(screen.indexOf('await page.waitForFunction')<screen.indexOf('await page.screenshot'));
});
