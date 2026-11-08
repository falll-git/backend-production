const test=require('node:test'),assert=require('node:assert/strict');
const {safeHarnessError}=require('./sj-harness-error');
const {archiveDecisionInput}=require('./sj-production-performance');
const {controlPath}=require('./sj-peer-paths');
const {validateDecision}=require(controlPath('src/domain/review.ts'));

test('unconfirmed owned UI CLOSE survives IPC sanitization for parent resource retention',()=>{
  assert.deepEqual(safeHarnessError({name:'Error',code:'UI_CHILD_CLOSE_UNCONFIRMED',message:'private'}),{name:'Error',code:'UI_CHILD_CLOSE_UNCONFIRMED'});
});

test('allowlisted lifecycle validation detail survives without private message',()=>{
  const error=Object.assign(new Error('password=private https://secret.invalid'),{name:'RequestValidationError',code:'VALIDATION_FAILED',reason:'REASON_REQUIRED',status:400});
  assert.deepEqual(safeHarnessError(error),{name:'RequestValidationError',code:'VALIDATION_FAILED',reason:'REASON_REQUIRED',status:400});
});
test('unknown names, codes and reasons fail closed',()=>{
  assert.deepEqual(safeHarnessError({name:'PRIVATE_ID',code:'PRIVATE_CREDENTIAL',reason:'PRIVATE_ENDPOINT',message:'secret',stack:'secret'}),{name:'Error',code:null});
});
test('secrets in database metadata, payload, stack and cause never escape',()=>{
  const error=Object.assign(new Error('private'),{code:'P2002',meta:{token:'private',sql:'private'},cause:{message:'private'},payload:{password:'private'}});
  assert.deepEqual(safeHarnessError(error),{name:'Error',code:'P2002'});
});
test('actual state assertion preserves known enums only',()=>{
  let error;try{assert.equal('IN_REVIEW','ARCHIVED','private assertion message');}catch(e){error=e;}
  assert.deepEqual(safeHarnessError(error),{name:'AssertionError',code:'ERR_ASSERTION',assertion:{operator:'strictEqual',actual:'IN_REVIEW',expected:'ARCHIVED'}});
});
test('arbitrary assertion strings are represented only by type',()=>{
  const error={name:'AssertionError',code:'ERR_ASSERTION',operator:'strictEqual',actual:'postgres://secret',expected:'C:/private/file'};
  assert.deepEqual(safeHarnessError(error).assertion,{operator:'strictEqual',actual:{type:'string'},expected:{type:'string'}});
});
test('bounded numeric and boolean assertions survive',()=>{
  assert.deepEqual(safeHarnessError({name:'AssertionError',code:'ERR_ASSERTION',operator:'strictEqual',actual:28,expected:27}).assertion,{operator:'strictEqual',actual:28,expected:27});
  assert.deepEqual(safeHarnessError({code:'ERR_ASSERTION',operator:'strictEqual',actual:false,expected:true}).assertion,{operator:'strictEqual',actual:false,expected:true});
});
test('unbounded numeric assertions contain no original values',()=>{
  for(const value of [Infinity,NaN,1000001,-1000001])assert.deepEqual(safeHarnessError({code:'ERR_ASSERTION',operator:'strictEqual',actual:value,expected:0}).assertion.actual,{type:'number'});
});
test('objects and arrays expose no contents',()=>{
  const cycle={secret:'private'};cycle.self=cycle;
  assert.deepEqual(safeHarnessError({code:'ERR_ASSERTION',operator:'deepStrictEqual',actual:cycle,expected:['private','secret']}).assertion,{operator:'deepStrictEqual',actual:{type:'object'},expected:{type:'array',length:2}});
});
test('null assertion scalars are retained rather than mistaken for absence',()=>{
  assert.deepEqual(safeHarnessError({code:'ERR_ASSERTION',operator:'strictEqual',actual:null,expected:null}).assertion,{operator:'strictEqual',actual:null,expected:null});
});
test('hostile array descriptors and revoked proxies cannot throw or invoke getters',()=>{
  const array=new Proxy(['private'],{get(){throw Error('getter invoked');},getOwnPropertyDescriptor(){throw Error('private');}});
  assert.deepEqual(safeHarnessError({code:'ERR_ASSERTION',operator:'deepStrictEqual',actual:array,expected:[]}).assertion.actual,{type:'array',length:null});
  const revoked=Proxy.revocable({},{});revoked.revoke();
  assert.deepEqual(safeHarnessError({code:'ERR_ASSERTION',operator:'strictEqual',actual:revoked.proxy,expected:0}).assertion.actual,{type:'object'});
});
test('getters are never invoked',()=>{
  const error={};for(const key of ['name','code','reason','status','assertion','harnessFailure','operator','actual','expected'])Object.defineProperty(error,key,{get(){throw Error('getter invoked');}});
  assert.deepEqual(safeHarnessError(error),{name:'Error',code:null});
});
test('throwing proxies fail closed',()=>{
  assert.deepEqual(safeHarnessError(new Proxy({},{getOwnPropertyDescriptor(){throw Error('private');}})),{name:'Error',code:null});
});
test('null and primitive failures fail closed',()=>{
  for(const value of [null,undefined,'private',17,true])assert.deepEqual(safeHarnessError(value),{name:'Error',code:null});
});
test('invalid statuses are omitted',()=>{
  for(const status of [99,600,200.5,'401',Infinity,NaN])assert.deepEqual(safeHarnessError({status}),{name:'Error',code:null});
});
test('safe IPC failure is propagated and sanitized again',()=>{
  const error=Object.assign(new Error('RPC private'),{harnessFailure:{name:'SessionExpiredError',code:'SESSION_EXPIRED',message:'private',status:401}});
  assert.deepEqual(safeHarnessError(error),{name:'SessionExpiredError',code:'SESSION_EXPIRED',status:401});
});
test('forged IPC details cannot expose arbitrary values',()=>{
  const error={harnessFailure:{name:'private',code:'PRIVATE_TOKEN',reason:'private',payload:{secret:'private'},assertion:{operator:'private'}}};
  assert.deepEqual(safeHarnessError(error),{name:'Error',code:null});
});
test('IPC assertions keep valid state and numeric scalars',()=>{
  const error={harnessFailure:{name:'AssertionError',code:'ERR_ASSERTION',assertion:{operator:'strictEqual',actual:'PENDING',expected:'APPLIED'}}};
  assert.deepEqual(safeHarnessError(error),{name:'AssertionError',code:'ERR_ASSERTION',assertion:{operator:'strictEqual',actual:'PENDING',expected:'APPLIED'}});
});
test('failed diagnostic persistence remains visible as a boolean only',()=>{
  const error={harnessFailure:{name:'SessionExpiredError',code:'SESSION_EXPIRED'},harnessDiagnosticWriteFailed:true};
  assert.deepEqual(safeHarnessError(error),{name:'SessionExpiredError',code:'SESSION_EXPIRED',harnessDiagnosticWriteFailed:true});
});
test('archive decision supplies the reason required by the actual Control contract',()=>{
  const snapshot={id:'owned-review',instanceId:'owned-instance',kind:'change_request',state:'IN_REVIEW',version:1,checksum:'a'.repeat(64),contributors:[]};
  const principal={id:'owned-reviewer',issuer:'ruwang-control',active:true,sessionVerified:true,grants:[{instanceId:snapshot.instanceId,role:'internal_operator',active:true}]};
  const rpc=archiveDecisionInput('owned-change-request');
  assert.equal(rpc.kind,'change_request');assert.equal(rpc.sourceId,'owned-change-request');assert.equal(rpc.decision,'approve');assert.ok(rpc.reason.trim());
  const input={instanceId:snapshot.instanceId,reviewId:snapshot.id,expectedVersion:snapshot.version,expectedChecksum:snapshot.checksum,decision:rpc.decision,reason:rpc.reason};
  const context={connected:true,authority:'central',auditWritable:true};
  assert.deepEqual(validateDecision(principal,snapshot,input,context),{allowed:true,next:'COMMAND_PENDING'});
  assert.deepEqual(validateDecision(principal,snapshot,{...input,reason:''},context),{allowed:false,reason:'REASON_REQUIRED'});
  assert.deepEqual(validateDecision(principal,snapshot,{...input,reason:'   '},context),{allowed:false,reason:'REASON_REQUIRED'});
});
