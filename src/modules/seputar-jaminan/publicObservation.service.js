const crypto=require('node:crypto');
const prisma=require('../../config/prisma');
const {AppError}=require('../../utils/errors');
const contract=require('./publicObservation.contract');
const MAX_BODY=256*1024;
async function target(kind,id){
  if(!['PROFILE','PUBLICATION'].includes(kind))throw new AppError('Jenis pemeriksaan tidak dikenal.',422);
  const row=kind==='PROFILE'?await prisma.sj_public_profiles.findFirst():await prisma.sj_publications.findUnique({where:{id}});
  if(!row)throw new AppError('Data tidak ditemukan.',404);
  const profile=kind==='PROFILE'?row:await prisma.sj_public_profiles.findFirst();
  const settings=await prisma.sj_integration_settings.findFirst();
  let source,websiteOrigin=null;
  try{source=contract.origin(settings?.central_base_url);if(process.env.SJ_PUBLIC_WEBSITE_ORIGIN)websiteOrigin=contract.origin(process.env.SJ_PUBLIC_WEBSITE_ORIGIN);}catch{throw new AppError('Alamat pemeriksaan SJ belum siap.',409);}
  if(!profile||!settings||!profile.current_version_id)throw new AppError('Identitas profil yang disetujui belum tersedia.',409);
  const logos=await prisma.sj_media_assets.findMany({where:{purpose:'BPRS_PUBLIC_MARK',central_media_id:{not:null}},select:{central_media_id:true}});
  if(!logos.length)throw new AppError('Identitas logo di SJ belum tersedia.',409);
  return {kind,id:row.id,source,websiteOrigin,slug:profile.public_slug,identity:kind==='PROFILE'?profile.public_slug:row.public_reference_code,logoIds:logos.map(l=>l.central_media_id)};
}
function wire(row){
  if(!row)return null;
  return {id:row.id,state:row.state,started_at:row.started_at,checked_at:row.finished_at,source_origin:row.source_origin,
    public_identity:row.public_identity,institution_slug:row.institution_slug,observed_version:row.observed_version,
    profile_snapshot:row.profile_snapshot??null,publication_snapshot:row.publication_snapshot??null,failure_code:row.failure_code};
}
async function readFor(t){
  // One query, two independent facts. Start order prevents a slow earlier
  // request from replacing a more recent observation. Environment is scoped.
  const rows=await prisma.$queryRaw`WITH scoped AS (
    SELECT * FROM public.sj_public_observations WHERE
    (publication_id=${t.kind==='PUBLICATION'?t.id:null}::text OR profile_id=${t.kind==='PROFILE'?t.id:null}::text)
    AND source_origin=${t.source} AND public_identity=${t.identity} AND institution_slug=${t.slug}
  ) (SELECT 'latest' AS fact,* FROM scoped ORDER BY started_at DESC,id DESC LIMIT 1)
  UNION ALL (SELECT 'success' AS fact,* FROM scoped WHERE state IN ('AVAILABLE','NOT_FOUND') ORDER BY started_at DESC,id DESC LIMIT 1)`;
  // A changed website environment must not keep exposing the previous site's link.
  for(const row of rows)if(row.profile_snapshot?.public_page_url&&!contract.validProfilePage(row.profile_snapshot.public_page_url,t))
    row.profile_snapshot={...row.profile_snapshot,public_page_url:null};
  for(const row of rows)if(row.publication_snapshot?.public_page_url&&!contract.validAssetPage(row.publication_snapshot.public_page_url,t))
    row.publication_snapshot={...row.publication_snapshot,public_page_url:null};
  return {scope:'SJ_PUBLIC_API',version_evidence:rows.find(r=>r.fact==='success')?.observed_version?(t.kind==='PROFILE'?'SOURCE_PROFILE_EVENT':'SOURCE_PUBLICATION_EVENT'):'UNAVAILABLE',freshness:'CHECK_TIME_ONLY',
    last_success:wire(rows.find(r=>r.fact==='success')),latest_attempt:wire(rows.find(r=>r.fact==='latest'))};
}
exports.read=async(kind,id)=>readFor(await target(kind,id));
// Read only the current page in one bounded query. Never trigger public checks
// from a list request, or reuse observations from another installation identity.
exports.publicationSummaries=async(publications,settings)=>{
  const summaries=new Map(publications.map(row=>[row.id,null]));
  if(!publications.length)return summaries;
  let source;try{source=contract.origin(settings?.central_base_url);}catch{return summaries;}
  const profile=await prisma.sj_public_profiles.findFirst();
  if(!profile?.current_version_id)return summaries;
  const logo=await prisma.sj_media_assets.findFirst({where:{purpose:'BPRS_PUBLIC_MARK',central_media_id:{not:null}},select:{id:true}});
  if(!logo)return summaries;
  const identities=JSON.stringify(publications.map(row=>({id:row.id,identity:row.public_reference_code})));
  const rows=await prisma.$queryRaw`SELECT p.id,o.fact,o.state,o.started_at,o.finished_at,o.observed_version
    FROM jsonb_to_recordset(${identities}::jsonb) AS p(id text,identity text)
    LEFT JOIN LATERAL (
      (SELECT 'latest' AS fact,state,started_at,finished_at,observed_version
       FROM public.sj_public_observations WHERE publication_id=p.id
       AND source_origin=${source} AND public_identity=p.identity AND institution_slug=${profile.public_slug}
       ORDER BY started_at DESC,id DESC LIMIT 1)
      UNION ALL
      (SELECT 'success' AS fact,state,started_at,finished_at,observed_version
       FROM public.sj_public_observations WHERE publication_id=p.id
       AND source_origin=${source} AND public_identity=p.identity AND institution_slug=${profile.public_slug}
       AND state IN ('AVAILABLE','NOT_FOUND') ORDER BY started_at DESC,id DESC LIMIT 1)
    ) o ON true`;
  for(const row of rows){
    if(!summaries.has(row.id))continue;
    const summary=summaries.get(row.id)||{scope:'SJ_PUBLIC_API',freshness:'CHECK_TIME_ONLY',last_success:null,latest_attempt:null};
    if(row.fact)summary[row.fact==='success'?'last_success':'latest_attempt']={state:row.state,started_at:row.started_at,checked_at:row.finished_at,observed_version:row.observed_version};
    summaries.set(row.id,summary);
  }
  return summaries;
};
async function bodyLimited(response){
  if(!response.headers.get('content-type')?.toLowerCase().includes('application/json'))throw Error('RESPONSE_INVALID');
  const reader=response.body?.getReader();if(!reader)throw Error('RESPONSE_INVALID');
  const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY)throw Error('RESPONSE_TOO_LARGE');chunks.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
exports.check=async(kind,id)=>{
  const t=await target(kind,id),attempt=crypto.randomUUID();
  await prisma.$executeRaw`INSERT INTO public.sj_public_observations(id,publication_id,profile_id,source_origin,public_identity,institution_slug)
    VALUES(${attempt}::uuid,${kind==='PUBLICATION'?t.id:null}::text,${kind==='PROFILE'?t.id:null}::text,${t.source},${t.identity},${t.slug})`;
  let state='FAILED',failure='UNREACHABLE',observedVersion=null,snapshot=null,assetSnapshot=null;
  // Technical request deadline only, NOT a business freshness/retention policy.
  const signal=AbortSignal.timeout(8000);
  try{
    const route=kind==='PUBLICATION'?'assets':'institutions';
    const response=await fetch(`${t.source}/v1/public/${route}/${encodeURIComponent(t.identity)}`,{
      headers:{Accept:'application/json','Cache-Control':'no-cache'},redirect:'error',signal});
    const body=await bodyLimited(response);
    if(response.status===200&&contract.validatePublicResponse(kind,body,t)){
      state='AVAILABLE';failure=null;
      if(kind==='PROFILE'){observedVersion=body.public_profile_version??null;snapshot=contract.profileSnapshot(body);}
      else{observedVersion=body.public_asset_version??null;assetSnapshot=contract.publicationSnapshot(body);}
    }
    else if(response.status===404&&contract.isNotFound(kind,body)){
      // A bank draft slug is not registry authority. A profile 404 can be a
      // wrong/unregistered address, not a withdrawal. Require a prior positive
      // identity-bound observation on this same origin/address before absence.
      const bound=kind==='PUBLICATION'||(await prisma.$queryRaw`SELECT 1 FROM public.sj_public_observations
        WHERE profile_id=${t.id} AND source_origin=${t.source} AND public_identity=${t.identity}
        AND institution_slug=${t.slug} AND state='AVAILABLE' LIMIT 1`).length>0;
      if(bound){state='NOT_FOUND';failure=null;}else failure='IDENTITY_UNCONFIRMED';
    }
    else failure=response.status>=500||response.status===429?'SERVICE_UNAVAILABLE':'RESPONSE_INVALID';
  }catch{failure=signal.aborted?'TIMEOUT':'RESPONSE_OR_NETWORK_ERROR';}
  // Only this pending attempt changes. No aggregate version, ACK, workflow,
  // previous success, credential or raw error is overwritten. Only public allowlist content is stored.
  const updated=await prisma.$executeRaw`UPDATE public.sj_public_observations SET state=${state},failure_code=${failure}::text,finished_at=clock_timestamp(),
    observed_version=${observedVersion}::integer,profile_snapshot=${snapshot?JSON.stringify(snapshot):null}::jsonb,
    publication_snapshot=${assetSnapshot?JSON.stringify(assetSnapshot):null}::jsonb
    WHERE id=${attempt}::uuid AND state='PENDING'`;
  if(updated!==1)throw new AppError('Hasil pemeriksaan belum dapat disimpan. Coba muat ulang.',503);
  return readFor(t);
};
