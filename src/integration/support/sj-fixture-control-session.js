'use strict';
// Test orchestration only: use real Control authentication, never session SQL,
// synthetic principals, longer TTLs or an automatic retry after a decision.
const assert=require('node:assert/strict');
async function renewFixtureControlSession({auth,config,actor,token,credentials,context,reason}) {
  assert.equal(reason,'before-lawful-performance-cleanup');
  assert.equal(typeof context,'function');
  assert.equal(typeof token,'string');assert.ok(token.length>=32);
  assert.ok(actor?.operator?.id&&actor.sessionId);
  const previous=await auth.loadOperatorSession(token,config,{requestId:context().requestId,touch:false});
  const login=await auth.loginOperator(credentials,context(),config);
  assert.equal(typeof login.token,'string');assert.notEqual(login.token,token);
  const fresh=await auth.loadOperatorSession(login.token,config,{requestId:context().requestId,touch:false});
  assert.ok(fresh,'new real login must load successfully');
  assert.equal(fresh.operator.id,actor.operator.id);
  assert.equal(fresh.principal.id,actor.principal.id);
  assert.equal(fresh.principal.issuer,actor.principal.issuer);
  assert.notEqual(fresh.sessionId,actor.sessionId);
  assert.ok(fresh.principal.grants.length>0&&fresh.principal.grants.every(g=>g.role==='internal_operator'));
  await auth.logoutOperator(actor,context().requestId);
  assert.equal(await auth.loadOperatorSession(token,config,{requestId:context().requestId,touch:false}),null,'retired old session must be rejected');
  return {actor:fresh,token:login.token,receipt:{reason,authenticated:true,sameOperator:true,
    previousSessionRejected:previous===null,retiredSessionRejected:true,sessionPolicyChanged:false}};
}
module.exports={renewFixtureControlSession};
