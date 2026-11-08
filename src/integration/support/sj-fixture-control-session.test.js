const test=require('node:test'),assert=require('node:assert/strict');
const {renewFixtureControlSession}=require('./sj-fixture-control-session');
function fixture({expired=false,loginError=false,wrongOperator=false,logoutError=false}={}) {
  const actor={operator:{id:'unit-operator'},sessionId:'old',principal:{id:'unit-operator',issuer:'ruwang-control',grants:[{role:'internal_operator'}]}},token='a'.repeat(40);
  const fresh={...actor,operator:{id:wrongOperator?'other':actor.operator.id},sessionId:'new'};
  let retired=expired;const calls=[],config=Object.freeze({CONTROL_SESSION_IDLE_MINUTES:30,CONTROL_SESSION_ABSOLUTE_MINUTES:480});
  const failure=Error('unit authentication failure');
  const auth={
    async loadOperatorSession(value,cfg,options){calls.push('load');assert.equal(cfg,config);assert.equal(options.touch,false);return value===token?(retired?null:actor):fresh;},
    async loginOperator(credentials,_context,cfg){calls.push('login');assert.equal(cfg,config);assert.deepEqual(credentials,{username:'unit-only',password:'not-operational'});if(loginError)throw failure;return {token:'b'.repeat(40),session:fresh};},
    async logoutOperator(value){calls.push('logout');assert.equal(value,actor);if(logoutError)throw failure;retired=true;}
  };
  const input={auth,config,actor,token,credentials:{username:'unit-only',password:'not-operational'},context:()=>({requestId:'unit'}),reason:'before-lawful-performance-cleanup'};
  return {input,calls,failure,fresh};
}
for(const expired of [false,true])test('explicit phase re-login with '+(expired?'expired':'valid')+' old fixture session uses official auth only (double)',async()=>{
  const f=fixture({expired}),r=await renewFixtureControlSession(f.input);
  assert.equal(r.actor,f.fresh);assert.equal(r.receipt.previousSessionRejected,expired);
  assert.deepEqual(f.calls,['load','login','load','logout','load']);
  assert.equal(r.receipt.authenticated,true);assert.equal(r.receipt.retiredSessionRejected,true);
  assert.doesNotMatch(JSON.stringify(r.receipt),/token|password|unit-operator/);
  assert.equal(f.input.config.CONTROL_SESSION_IDLE_MINUTES,30);
});
test('invalid boundary rejected before any authentication call',async()=>{
  const f=fixture();await assert.rejects(renewFixtureControlSession({...f.input,reason:'after-failed-decision'}));assert.deepEqual(f.calls,[]);
});
for(const option of ['loginError','logoutError'])test(option+' propagates without another login/decision retry',async()=>{
  const f=fixture({[option]:true});await assert.rejects(renewFixtureControlSession(f.input),e=>e===f.failure);assert.equal(f.calls.filter(c=>c==='login').length,1);
});
test('wrong account cannot replace fixture decision actor',async()=>{
  const f=fixture({wrongOperator:true});await assert.rejects(renewFixtureControlSession(f.input));assert.equal(f.calls.includes('logout'),false);
});
