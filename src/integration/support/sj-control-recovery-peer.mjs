import assert from 'node:assert/strict';
import crypto from 'node:crypto';
export async function controlRecoveryProof({load,controlPath,settings,actor,jobId,provider='BANK'}) {
  const auth=await load(controlPath('src/server/auth/service.ts'));
  const config=(await load(controlPath('src/lib/env.ts'))).getRuntimeConfig();
  const service=await load(controlPath('src/server/delivery-recovery.ts'));
  const deliveryRecovery=(who,instance,input)=>service.deliveryRecovery(who,instance,input,provider);
  const {query}=await load(controlPath('src/server/database.ts'));
  const ctx=()=>({requestId:crypto.randomUUID(),ipHash:null,userAgentHash:null});
  const bootstrap=await auth.loginOperator({username:'bootstrap-'+settings.proof.runId,password:settings.cross.bootstrapPassword},ctx(),config);
  const username=(provider==='SJ'?'processing-':'delivery-')+jobId.slice(0,8)+'-'+settings.proof.runId;
  let operator;
  const originalFetch=globalThis.fetch;
  try {
    assert.ok(await deliveryRecovery(actor,settings.instanceId,{action:'list',cursor:null,state:null}));
    await auth.createOperator({actor:bootstrap.session,username,displayName:'Delivery isolated',password:settings.cross.browserPassword,requestId:crypto.randomUUID()});
    operator=await auth.loginOperator({username,password:settings.cross.browserPassword},ctx(),config);
    let csrf=await auth.rotateCsrfToken(operator.session);
    const {NextRequest}=await load(controlPath('node_modules/next/server.js'));
    const segment=provider==='SJ'?'processing-recovery':'delivery-recovery';
    const route=await load(controlPath(`app/api/instances/[instanceId]/${segment}/route.ts`));
    const call=async(body,expected=200,headers={})=>{
      const request=new NextRequest(config.CONTROL_PUBLIC_ORIGIN+`/api/instances/${settings.instanceId}/${segment}`,{
        method:'POST',headers:{origin:config.CONTROL_PUBLIC_ORIGIN,'content-type':'application/json',
          cookie:'control_session='+operator.token,'x-csrf-token':csrf,...headers},body:JSON.stringify(body)});
      const response=await route.POST(request,{params:Promise.resolve({instanceId:settings.instanceId})});
      const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data.error??{}));return data.data;
    };
    await call({action:'detail',jobId},401,{cookie:''});await call({action:'detail',jobId},403,{'x-csrf-token':''});
    await call({action:'detail',jobId},403,{origin:'https://foreign.example.invalid'});
    await call({action:'detail',jobId,operator_id:crypto.randomUUID()},400);
    await call({action:'retry',jobId,requestId:crypto.randomUUID(),expectedRevision:'a'.repeat(64),reason:'x'.repeat(5000)},400);
    await call({action:'check_result',requestId:crypto.randomUUID()},409);
    await assert.rejects(deliveryRecovery(operator.session,crypto.randomUUID(),{action:'detail',jobId}),e=>e.code==='FORBIDDEN');
    await auth.revokeOperatorSessions({actor:bootstrap.session,instanceId:settings.instanceId,targetOperatorId:operator.session.operator.id,requestId:crypto.randomUUID()});
    await assert.rejects(deliveryRecovery(operator.session,settings.instanceId,{action:'detail',jobId}),e=>e.code==='SESSION_EXPIRED');
    operator=await auth.loginOperator({username,password:settings.cross.browserPassword},ctx(),config);
    csrf=await auth.rotateCsrfToken(operator.session);
    const detail=await call({action:'detail',jobId});assert.equal(detail.value.item.retry.allowed,true);
    const requestId=crypto.randomUUID(),input={action:'retry',jobId,requestId,expectedRevision:detail.value.item.revision,reason:'Tujuan sudah diperiksa dalam pengujian terisolasi'};
    let writes=0;
    globalThis.fetch=async(url,options)=>{
      if(JSON.parse(options?.body||'{}').operation==='retry'){writes++;throw new TypeError('TEST_DISCONNECT_BEFORE_SEND');}
      return originalFetch(url,options);
    };
    await call(input,503);assert.equal(writes,1);globalThis.fetch=originalFetch;
    assert.equal((await query('SELECT state FROM control.delivery_recovery_requests WHERE id=$1',[requestId]))[0].state,'UNKNOWN');
    assert.equal((await call({action:'check_result',requestId})).value.state,'NOT_RECORDED');
    await call({...input,requestId:crypto.randomUUID()},409);
    globalThis.fetch=async(url,options)=>{
      const response=await originalFetch(url,options);
      if(JSON.parse(options?.body||'{}').operation==='retry') {
        writes++;const headers=new Headers(response.headers);headers.delete('x-rc-ack-signature');
        return new Response(await response.arrayBuffer(),{status:response.status,headers});
      }
      return response;
    };
    await call({action:'repeat_request',requestId},503);globalThis.fetch=originalFetch;
    assert.equal((await query('SELECT state FROM control.delivery_recovery_requests WHERE id=$1',[requestId]))[0].state,'UNKNOWN');
    const recovered=await call({action:'check_result',requestId});assert.equal(recovered.value.result.state,'SCHEDULED');
    assert.equal((await query('SELECT state FROM control.delivery_recovery_requests WHERE id=$1',[requestId]))[0].state,'RECORDED');
    let extraWrites=0;globalThis.fetch=async(url,options)=>{if(JSON.parse(options?.body||'{}').operation==='retry')extraWrites++;return originalFetch(url,options);};
    const repeated=await Promise.all([call(input),call(input),call({action:'repeat_request',requestId})]);
    for(const item of repeated)assert.deepEqual(item.value,recovered.value);assert.equal(extraWrites,0);assert.equal(writes,2);
    return {check:`Control ${provider} recovery API: real equal internal access/login/CSRF; unknown institution/revoked session denied; disconnect before send and lost signed response preserve UNKNOWN; same-ID receipt recovery without duplicate scheduling`,pass:true};
  } finally {
    globalThis.fetch=originalFetch;
    if(operator)await auth.logoutOperator(operator.session,crypto.randomUUID());
    await auth.logoutOperator(bootstrap.session,crypto.randomUUID());
  }
}
