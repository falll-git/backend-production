// Only for the isolated harness. Deliberately NOT a real SJ/Control implementation.
const http=require('node:http');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const control=require('../../modules/seputar-jaminan/controlReview.contract');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
// Read the actual peer's pure schema only. No Control server/config/DB imports.
const schemaPath=require('./sj-peer-paths').controlPath('src/domain/review-snapshot.ts');
async function loadControlSchema(){
  const source=fs.readFileSync(schemaPath);
  const {reviewSnapshotEnvelopeSchema}=await import(pathToFileURL(schemaPath).href);
  return {schema:reviewSnapshotEnvelopeSchema,source:{path:schemaPath,sha256:crypto.createHash('sha256').update(source).digest('hex')}};
}
async function startDouble({contracts,bankPublicKey,controlPrivateKey,institutionId,keyId,instanceId,bankAckKeyId,controlKeyId,capability,publicSlug='bank-test'}) {
  const {schema:reviewSchema}=await loadControlSchema();
  const nonces=new Set(),events=new Map(),sessions=new Map(),snapshots=new Map();
  const appliedCounts=new Map(),cursors=new Map(),reconciliations=new Map();let ingestFault=null,reconciliationFault=null;
  const counters={signedRequests:0,uploads:0,events:0,snapshots:0,rejected:0};
  let origin,failNext=false,publicFault=null;
  const server=http.createServer(async(req,res)=>{
    const send=(status,data,headers={})=>{res.writeHead(status,{'content-type':'application/json',...headers});res.end(JSON.stringify(data));};
    try {
      const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>11*1024*1024)throw Error('SIZE');chunks.push(c);}
      const buffer=Buffer.concat(chunks),body=buffer.toString('utf8'),route=req.url;
      if(req.method==='GET'&&route==='/__test/ownership'){assert.equal(req.headers['x-test-capability'],capability);return send(200,{instanceId});}
      if(req.method==='GET'&&route.startsWith('/v1/public/')){
        // Public DTO shape from SJ public-service.ts; lifecycle data comes from
        // officially delivered snapshots. Still a contract double, NOT real SJ.
        if(publicFault==='timeout'){setTimeout(()=>{if(!res.destroyed)send(503,{});},9000).unref();return;}
        if(publicFault==='offline')return send(503,{code:'UNAVAILABLE'});
        if(publicFault==='empty')return send(200,{});
        if(publicFault==='generic404')return send(404,{code:'NOT_FOUND'});
        const kind=route.includes('/assets/')?'PUBLICATION':'PROFILE';
        const all=[...events.values()];
        const profileEvent=all.filter(e=>e.event_type==='UPSERT_BPRS_PROFILE').at(-1);
        const profile=profileEvent?.payload;
        const unavailable=()=>send(404,{request_id:crypto.randomUUID(),code:kind==='PUBLICATION'?'ASSET_NOT_FOUND':'INSTITUTION_NOT_FOUND',message:'Tidak tersedia.',retryable:false});
        if(!profile||publicFault==='not-found')return unavailable();
        const institution={public_slug:publicFault==='wrong-identity'?'another-bank':publicSlug,public_name:profile.public_name,public_mark_url:origin+'/v1/public/media/'+profile.public_mark};
        if(kind==='PROFILE')return send(200,{...institution,short_description:profile.short_description,office_city_regency:profile.office_city_regency,office_province:profile.office_province,published_asset_count:0,
          public_profile_version:profileEvent.aggregate_version,public_page_url:publicFault==='wrong-website'?'https://wrong.example/bprs/'+publicSlug:null});
        const snapshot=all.filter(e=>e.event_type==='UPSERT_PUBLICATION_SNAPSHOT'&&e.payload.reference_code===route.split('/').pop()).at(-1)?.payload;
        if(!snapshot)return unavailable();
        const media=snapshot.media.map(m=>({url:origin+'/v1/public/media/'+m.media_id,width:480,height:320,alt_text:m.alt_text}));
        return send(200,{reference_code:snapshot.reference_code,title:snapshot.title,description:snapshot.description,category:snapshot.category,
          subcategory:snapshot.subcategory,availability:snapshot.availability,institution,location:snapshot.location,cover:media[0],media,photo_count:media.length,
          attributes:snapshot.attributes,public_updated_at:snapshot.public_updated_at,whatsapp_url:'https://wa.me/6281234567890?text=Tes'});
      }
      if(route.startsWith('/__test/upload/')&&req.method==='PUT') {
        const s=sessions.get(route.split('/').pop());assert.ok(s);assert.equal(req.headers['x-test-upload-token'],s.token);assert.equal(s.uploaded,false);
        assert.equal(contracts.createContentSha256(buffer),s.request.sha256);assert.equal(buffer.length,s.request.size_bytes);
        const meta=await sharp(buffer).metadata();assert.equal(meta.width,s.request.width);assert.equal(meta.height,s.request.height);assert.equal(meta.format,'webp');
        s.uploaded=true;counters.uploads++;return send(200,{});
      }
      if(route==='/api/internal/sj-review/snapshots') {
        const h=control.headerNames,nonce=req.headers[h.acknowledgmentNonce],timestamp=req.headers[h.acknowledgmentTimestamp];
        assert.equal(req.headers[h.instanceId],instanceId);assert.equal(req.headers[h.acknowledgmentKeyId],bankAckKeyId);
        assert.ok(!nonces.has(nonce));assert.ok(Math.abs(Date.now()-Date.parse(timestamp))<300000);
        const payload=JSON.parse(body),digest=control.payloadDigest(payload);assert.equal(control.canonicalJson(payload),body);
        assert.equal(req.headers[h.acknowledgmentContentSha256],digest);
        assert.equal(control.verifyTransport(control.signingMessage({method:req.method,path:route,timestamp,nonce,contentSha256:digest}),req.headers[h.acknowledgmentSignature],bankPublicKey),true);
        assert.equal(payload.instance_id,instanceId);assert.equal(reviewSchema.safeParse(payload).success,true);
        nonces.add(nonce);snapshots.set(payload.snapshot_id,payload);counters.snapshots++;
        const ack={contract_version:1,snapshot_id:payload.snapshot_id,instance_id:instanceId,status:'ACCEPTED',received_at:new Date().toISOString()};
        const text=control.canonicalJson(ack),hash=control.payloadDigest(ack),ts=new Date().toISOString(),n=crypto.randomUUID();
        res.writeHead(200,{'content-type':'application/json',[h.keyId]:controlKeyId,[h.timestamp]:ts,[h.nonce]:n,[h.contentSha256]:hash,[h.signature]:control.signTransport(control.signingMessage({method:'POST',path:route,timestamp:ts,nonce:n,contentSha256:hash}),controlPrivateKey)});return res.end(text);
      }
      assert.equal(req.headers['x-sj-institution-id'],institutionId);assert.equal(req.headers['x-sj-key-id'],keyId);
      const nonce=req.headers['x-sj-nonce'],timestamp=req.headers['x-sj-timestamp'],hash=contracts.createContentSha256(body);
      assert.ok(nonce&&!nonces.has(nonce));assert.ok(Math.abs(Date.now()-Date.parse(timestamp))<300000);
      assert.equal(req.headers['x-sj-content-sha256'],hash);
      assert.equal(contracts.verifyIntegrationMessage(contracts.createSigningMessage({method:req.method,path:route,timestamp,nonce,contentSha256:hash}),req.headers['x-sj-signature'],bankPublicKey),true);
      nonces.add(nonce);counters.signedRequests++;
      if(failNext){failNext=false;return send(503,{error:{code:'TEST_INJECTED_UNAVAILABLE'}});}
      const payload=body?JSON.parse(body):null;
      // Actual reconciliation DTO shape; this double does not inspect public pages.
      if(route==='/v1/reconciliation/manifests'&&req.method==='POST') {
        assert.equal(contracts.validateSchema('https://seputarjaminan.com/contracts/v1/reconciliation-manifest.schema.json',payload).valid,true);
        assert.equal(payload.institution_id,institutionId);
        if(reconciliationFault==='empty-create')return send(200,{});
        const id=crypto.randomUUID();reconciliations.set(id,payload);
        return send(202,{request_id:crypto.randomUUID(),run_id:id,status:'PENDING',count_checked:0,count_mismatch:0,mismatches:[]});
      }
      if(route.startsWith('/v1/reconciliation/runs/')&&req.method==='GET') {
        const id=route.split('/').pop(),manifest=reconciliations.get(id);assert.ok(manifest);
        if(reconciliationFault==='offline')return send(503,{code:'TEST_UNAVAILABLE',retryable:true});
        if(reconciliationFault==='empty')return send(200,{});
        const mismatches=reconciliationFault==='mismatch'?[{aggregate_id:manifest.items[0].aggregate_id,code:'PUBLIC_ELIGIBILITY_MISMATCH',recommended_action:'CONTACT_OPERATIONS'}]:[];
        return send(200,{request_id:crypto.randomUUID(),run_id:reconciliationFault==='wrong-run'?crypto.randomUUID():id,status:'COMPLETED',count_checked:reconciliationFault==='incomplete'?0:manifest.items.length,count_mismatch:mismatches.length,mismatches});
      }
      if(route==='/v1/media/upload-sessions'&&req.method==='POST') {
        const validation=contracts.validateSchema('https://seputarjaminan.com/contracts/v1/media-upload-session-request.schema.json',payload);assert.equal(validation.valid,true);
        assert.equal(payload.institution_id,institutionId);
        const id=crypto.randomUUID(),mediaId=crypto.randomUUID(),token=crypto.randomBytes(20).toString('hex');sessions.set(id,{request:payload,mediaId,token,uploaded:false,completed:false});
        const response={request_id:crypto.randomUUID(),media_id:mediaId,upload_session_id:id,upload_url:origin+'/__test/upload/'+id,method:'PUT',headers:{'x-test-upload-token':token},expires_at:new Date(Date.now()+900000).toISOString(),max_bytes:10485760};
        assert.equal(contracts.validateSchema('https://seputarjaminan.com/contracts/v1/media-upload-session-response.schema.json',response).valid,true);
        return send(201,response);
      }
      if(/^\/v1\/media\/upload-sessions\/.+\/complete$/.test(route)) {
        const s=sessions.get(route.split('/')[4]);assert.ok(s?.uploaded);assert.equal(payload.media_id,s.mediaId);s.completed=true;return send(200,{request_id:crypto.randomUUID(),media_id:s.mediaId,status:'READY',rejection_code:null,checked_at:new Date().toISOString()});
      }
      if(/^\/v1\/media\/.+\/status$/.test(route)) {const s=[...sessions.values()].find(s=>s.mediaId===route.split('/')[3]);assert.ok(s);return send(200,{request_id:crypto.randomUUID(),media_id:s.mediaId,status:s.completed?'READY':'PROCESSING',rejection_code:null,checked_at:new Date().toISOString()});}
      if(route==='/v1/ingest/events') {
        contracts.assertValidIntegrationEvent(payload);assert.equal(payload.institution_id,institutionId);
        if(ingestFault==='disconnect'){req.socket.destroy();return;}
        if(ingestFault==='timeout'){setTimeout(()=>{if(!res.destroyed)send(503,{code:'TEST_TIMEOUT',retryable:true});},2000).unref();return;}
        if(ingestFault==='retryable')return send(503,{code:'TEST_TRANSIENT',retryable:true});
        if(ingestFault==='permanent')return send(422,{code:'TEST_PERMANENT',retryable:false});
        const old=events.get(payload.event_id);if(old)assert.equal(control.canonicalJson(old),control.canonicalJson(payload));
        if(!old){
          if((cursors.get(payload.aggregate_id)||0)>=payload.aggregate_version)return send(409,{code:'AGGREGATE_VERSION_CONFLICT',retryable:false});
          cursors.set(payload.aggregate_id,payload.aggregate_version);appliedCounts.set(payload.event_id,1);
        }
        events.set(payload.event_id,payload);counters.events++;
        if(ingestFault==='empty')return send(200,{});
        if(ingestFault==='invalid-json'){res.writeHead(200,{'content-type':'application/json'});res.end('broken');return;}
        return send(200,{request_id:crypto.randomUUID(),status:ingestFault==='unknown-status'?'RECEIVED':old?'DUPLICATE':'APPLIED',event_id:ingestFault==='wrong-event'?crypto.randomUUID():payload.event_id,active_aggregate_version:ingestFault==='wrong-version'?0:cursors.get(payload.aggregate_id),acknowledged_at:new Date().toISOString()});
      }
      return send(404,{error:{code:'TEST_ROUTE_NOT_IMPLEMENTED'}});
    }catch {counters.rejected++;send(400,{error:{code:'TEST_CONTRACT_REJECTED'}});}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
  return{origin,counters,events,snapshots,appliedCounts,setPublicFault:mode=>{publicFault=mode;},setIngestFault:mode=>{ingestFault=mode;},setReconciliationFault:mode=>{reconciliationFault=mode;},failNextRequest:()=>{failNext=true;},close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})};
}
module.exports={startDouble,loadControlSchema};
