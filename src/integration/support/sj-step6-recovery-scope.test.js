'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {withOwnedRecovery}=require('./sj-step6-recovery-scope');
const input={proof:{runId:'owned'},token:'test-token',cross:{uiStep6:true,bankUiRoot:'bank',publicUiRoot:'sj',browserRoot:'control'}};
test('validates current disposable ownership before enabling and restores missing flag',async()=>{
 const env={NODE_ENV:'test'},events=[];
 const result=await withOwnedRecovery(input,async()=>{events.push('action');assert.equal(env.SJ_CONTROL_RECOVERY_ENABLED,'true');return 7;},async(p,e,t)=>{events.push('verify');assert.equal(e.SJ_CONTROL_RECOVERY_ENABLED,undefined);assert.equal(p,input.proof);assert.equal(t,input.token);},env);
 assert.equal(result,7);assert.deepEqual(events,['verify','action']);assert.equal(Object.hasOwn(env,'SJ_CONTROL_RECOVERY_ENABLED'),false);
});
test('preserves explicit disabled state after success',async()=>{const env={NODE_ENV:'test',SJ_CONTROL_RECOVERY_ENABLED:'false'};await withOwnedRecovery(input,async()=>assert.equal(env.SJ_CONTROL_RECOVERY_ENABLED,'true'),async()=>{},env);assert.equal(env.SJ_CONTROL_RECOVERY_ENABLED,'false');});
test('preserves explicit enabled state after thrown action',async()=>{const env={NODE_ENV:'test',SJ_CONTROL_RECOVERY_ENABLED:'true'};await assert.rejects(withOwnedRecovery(input,async()=>{throw Error('retained-original-failure');},async()=>{},env),/retained-original-failure/);assert.equal(env.SJ_CONTROL_RECOVERY_ENABLED,'true');});
test('restores missing flag after thrown action',async()=>{const env={NODE_ENV:'test'};await assert.rejects(withOwnedRecovery(input,async()=>{throw Error('failure');},async()=>{},env),/failure/);assert.equal(Object.hasOwn(env,'SJ_CONTROL_RECOVERY_ENABLED'),false);});
test('ownership refusal cannot enable capability or call action',async()=>{const env={NODE_ENV:'test'};let called=false;await assert.rejects(withOwnedRecovery(input,async()=>{called=true;},async()=>{throw Error('NOT_OWNED');},env),/NOT_OWNED/);assert.equal(called,false);assert.equal(Object.hasOwn(env,'SJ_CONTROL_RECOVERY_ENABLED'),false);});
test('normal environment and incomplete UI scope refused before ownership work',async()=>{for(const [i,e]of [[input,{NODE_ENV:'production'}],[{...input,cross:{...input.cross,uiStep6:false}},{NODE_ENV:'test'}],[{...input,cross:{...input.cross,publicUiRoot:null}},{NODE_ENV:'test'}]]){let called=false;await assert.rejects(withOwnedRecovery(i,async()=>{called=true;},async()=>{called=true;},e));assert.equal(called,false);assert.equal(Object.hasOwn(e,'SJ_CONTROL_RECOVERY_ENABLED'),false);}});
test('actual scenario scopes the three-UI call rather than changing normal config or the earlier negative recovery proof',()=>{const source=require('node:fs').readFileSync(require.resolve('./sj-cross-app-scenario'),'utf8');assert.match(source,/withOwnedRecovery\(\{proof,token,cross\},runThreeUi\)/);assert.match(source,/finally\{delete process\.env\.SJ_CONTROL_RECOVERY_ENABLED;\}/);});
