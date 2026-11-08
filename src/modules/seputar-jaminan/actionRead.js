// Read-time permission/state assessment. This describes starting an existing
// action, never promises its later transaction will succeed or be public.
const ROOT='/dashboard/seputar-jaminan/';
const blocked=(code,reason)=>({code,reason});
const absent=blocked('SETUP_REQUIRED','Koneksi Seputar Jaminan belum disiapkan.');
const permission=blocked('PERMISSION_DENIED','Anda belum punya izin untuk tindakan ini.');
const review=blocked('IN_REVIEW','Tunggu hasil pemeriksaan sebelum mengubah data.');
const draft=blocked('DRAFT_REQUIRED','Simpan draf perubahan terlebih dahulu.');
const sync=blocked('DEPENDENCY_NOT_READY','Profil, kontak, atau gambar belum siap. Periksa status pengirimannya.');

async function context(client,rows=[],kind){
  const {userId}=require('../../config/database-context').getDatabaseContext();
  const user=userId?await require('../../utils/rbac').resolveRequestUser({id:userId}):null;
  const [settings,grants]=await Promise.all([
    client.sj_integration_settings.findFirst(),
    user?client.role_menus.findMany({where:{role_id:user.role_id,menu:{url:{startsWith:ROOT}}},select:{can_read:true,can_create:true,can_update:true,features:true,menu:{select:{url:true}}}}):[],
  ]);
  const scopes=new Map();
  if(user&&rows.length){
    const input=rows.map(row=>({id:row.id,division:row.owner_division_id||null}));
    const divided=['publication','media'].includes(kind);
    const results=divided?await client.$queryRaw`
      SELECT x.id,public.ruwang_arsip_sj_can_access_division(x.division,'update') AS allowed
      FROM jsonb_to_recordset(${JSON.stringify(input)}::jsonb) AS x(id text,division text)`:
      await client.$queryRaw`SELECT public.ruwang_arsip_sj_has_global_access('update') AS allowed`;
    for(const row of rows)scopes.set(row.id,divided?results.find(r=>r.id===row.id)?.allowed===true:results[0]?.allowed===true);
  }
  let centralReady=true;
  if(settings?.review_authority==='central'){
    try{require('./controlReviewSnapshot.service').assertCentralSnapshotConfig(settings);}catch{centralReady=false;}
  }
  const refs=new Map();
  if(kind==='contact'&&user&&rows.length&&grants.some(g=>g.can_update&&
    (g.menu.url===ROOT+'kontak'||(g.menu.url===ROOT+'pengajuan'&&g.can_read&&g.features.includes('sj_contact_verify'))))){
    const ids=rows.filter(r=>r.state==='VERIFIED'&&!r.revoked_at&&scopes.get(r.id)).map(r=>({id:r.id}));
    if(ids.length){
      const results=await client.$queryRaw`SELECT x.id,public.ruwang_arsip_sj_contact_referenced(x.id) AS used
        FROM jsonb_to_recordset(${JSON.stringify(ids)}::jsonb) AS x(id text)`;
      for(const row of results){if(typeof row.used!=='boolean')throw Error('Invalid contact usage result');refs.set(row.id,row.used);}
    }
  }
  return {userId:user?.id,settings,scopes,refs,centralReady,
    can:(menu,feature)=>grants.some(g=>g.menu.url===ROOT+menu&&g.can_update===true&&(!feature||(g.can_read===true&&g.features.includes(feature)))),
    canCreate:menu=>grants.some(g=>g.menu.url===ROOT+menu&&g.can_create===true)};
}

// Resource-independent entry controls have no row lock version. These assess
// permission/configuration only; input and dependencies are checked on submit.
function entryActions(ctx,scope){
  const draftFlag=!ctx.settings?absent:!ctx.settings.draft_enabled?blocked('FEATURE_DISABLED','Pembuatan draf belum diaktifkan.'):null;
  const result=(allowed,checks=[])=>{
    const failure=!ctx.userId||!allowed?permission:checks.find(Boolean);
    return {available:!failure,reason:failure?.reason||null,reason_code:failure?.code||null,mode:'DIRECT'};
  };
  return {scope:'START_ACTION',expected_version:null,revalidated_on_submit:true,actions:{
    create_publication:result(ctx.canCreate?.('publikasi')&&scope.division_create,[draftFlag]),
    create_contact:result(ctx.canCreate?.('kontak')&&scope.global_create,[draftFlag]),
    create_profile:result(ctx.can('profil')&&scope.global_create&&scope.global_update,[draftFlag]),
    upload_media:result((ctx.canCreate?.('profil')||ctx.canCreate?.('publikasi'))&&scope.division_create,[draftFlag]),
    reconcile:result(ctx.can('ringkasan','sj_sync_retry')&&scope.global_create,[!ctx.settings?absent:!ctx.settings.sync_enabled?blocked('FEATURE_DISABLED','Pengiriman SJ belum diaktifkan.'):null]),
  }};
}
async function readEntryActions(client){
  const ctx=await context(client);
  const [scope]=await client.$queryRaw`SELECT
    public.ruwang_arsip_sj_has_global_access('create') AS global_create,
    public.ruwang_arsip_sj_has_global_access('update') AS global_update,
    public.ruwang_arsip_sj_can_access_division(public.ruwang_arsip_current_user_division_id(),'create') AS division_create`;
  return entryActions(ctx,scope||{});
}

function assessor(row,ctx){
  const settings=ctx.settings;
  const flag=name=>!settings?absent:settings[name]!==true?blocked('FEATURE_DISABLED','Fitur ini belum diaktifkan.'):
    name==='review_enabled'&&!ctx.centralReady?blocked('CENTRAL_NOT_READY','Pengiriman pengajuan ke Control belum siap.'):null;
  const authority=central=>!settings?absent:(settings.review_authority||'local')!==(central?'central':'local')?
    blocked('AUTHORITY_MISMATCH',central?'Tindakan ini tidak memakai pemeriksaan Control.':'Keputusan dilakukan melalui Ruwang Control.'):null;
  const action=(menu,feature,checks=[],mode='DIRECT')=>{
    const failure=!ctx.userId||!ctx.can(menu,feature)||ctx.scopes.get(row.id)!==true?permission:checks.find(Boolean);
    return {available:!failure,reason:failure?.reason||null,reason_code:failure?.code||null,mode};
  };
  return {flag,authority,action,settings};
}
function publication(row,ctx){
  const {flag,authority,action,settings}=assessor(row,ctx),v=row.current_version;
  const central=settings?.review_authority==='central';
  const maker=v&&[v.last_edited_by,v.submitted_by].includes(ctx.userId)?blocked('MAKER_CHECKER','Minta rekan yang tidak membuat atau mengajukan perubahan untuk memeriksanya.'):null;
  const reviewing=v?.state==='IN_REVIEW'?null:blocked('NOT_IN_REVIEW','Tidak ada pengajuan yang menunggu pemeriksaan.');
  const dependencies=!v||!Array.isArray(v.media)||!v.media.length||v.media.some(l=>l.media_asset?.state!=='READY'||!l.media_asset.central_media_id)
    ||v.whatsapp_contact_version?.contact?.sync_state!=='ACKNOWLEDGED'||v.profile_version?.profile?.sync_state!=='ACKNOWLEDGED'?sync:null;
  const withdrawal=require('./publicationLifecycle').withdrawalEligibility(row);
  const withdrawBlock=withdrawal.eligible?null:blocked('WITHDRAWAL_BLOCKED',withdrawal.reason);
  const lifecycle=(feature,checks)=>central?action('publikasi',null,[flag('review_enabled'),authority(true),...checks],'REQUEST_CONTROL'):
    action(feature==='sj_reconfirm'?'ringkasan':'pengajuan',feature,[flag('sync_enabled'),authority(false),...checks]);
  // Archive has no feature flag in the actual service; only setup + authority.
  const archiveChecks=central?[row.state==='IN_REVIEW'?review:null]:[row.state==='PUBLISHED'?blocked('WITHDRAW_FIRST','Tarik katalog terlebih dahulu sebelum mengarsipkannya.'):null];
  return envelope(row,ctx,{
    edit_draft:action('publikasi',null,[flag('draft_enabled'),!v?draft:v.state==='IN_REVIEW'?review:null]),
    submit:action('publikasi',null,[flag('review_enabled'),v?.state!=='DRAFT'?draft:null,dependencies]),
    request_revision:action('pengajuan','sj_review',[flag('review_enabled'),authority(false),reviewing,maker]),
    approve:action('pengajuan','sj_publish',[flag('publish_enabled'),authority(false),reviewing,maker,
      !settings?.sync_enabled||settings?.connection_state!=='ACTIVE'?blocked('CONNECTION_NOT_READY','Koneksi pengiriman belum aktif.'):null,dependencies]),
    unpublish:lifecycle('sj_unpublish',[withdrawBlock]),
    reconfirm:lifecycle('sj_reconfirm',[row.state!=='PUBLISHED'||!row.published_version_id?blocked('NO_APPROVED_PUBLICATION','Katalog belum berada pada tahap konfirmasi ulang.'):null]),
    archive:central?lifecycle('sj_archive',[...archiveChecks,row.state==='ARCHIVED'?blocked('ALREADY_ARCHIVED','Katalog sudah diarsipkan.'):null]):
      action('pengajuan','sj_archive',[!settings?absent:null,authority(false),...archiveChecks,row.state==='ARCHIVED'?blocked('ALREADY_ARCHIVED','Katalog sudah diarsipkan.'):null]),
    check_public:action('publikasi',null,[]),
  });
}
function envelope(row,_ctx,actions){return {scope:'START_ACTION',expected_version:row.lock_version,revalidated_on_submit:true,actions};}

function profile(row,ctx){
  const {flag,authority,action}=assessor(row,ctx),v=row.versions?.[0];
  const maker=v&&[v.created_by,row.updated_by].includes(ctx.userId)?blocked('MAKER_CHECKER','Minta rekan yang tidak membuat atau mengajukan profil untuk memeriksanya.'):null;
  const reviewing=v?.state==='IN_REVIEW'?null:blocked('NOT_IN_REVIEW','Tidak ada pengajuan yang menunggu pemeriksaan.');
  const media=row.logo_media?.state!=='READY'||!row.logo_media?.central_media_id?blocked('LOGO_NOT_READY','Tunggu logo selesai dikirim.'):null;
  return envelope(row,ctx,{
    edit_draft:action('profil',null,[flag('draft_enabled'),v?.state==='IN_REVIEW'?review:null]),
    submit:action('profil',null,[flag('review_enabled'),v?.state!=='DRAFT'?draft:null,media]),
    request_revision:action('pengajuan','sj_profile_verify',[flag('review_enabled'),authority(false),reviewing,maker]),
    verify:action('pengajuan','sj_profile_verify',[flag('sync_enabled'),authority(false),reviewing,maker,media]),
    request_hide:action('profil',null,[flag('review_enabled'),authority(true),row.state!=='VERIFIED'?blocked('NOT_VERIFIED','Profil belum disetujui atau sedang diubah.'):null],'REQUEST_CONTROL'),
    check_public:action('profil',null,[]),
  });
}
function contact(row,ctx){
  const {flag,authority,action}=assessor(row,ctx),v=row.versions?.[0];
  const revoked=row.revoked_at?blocked('REVOKED','Kontak sudah dicabut.'):null;
  const maker=v&&[v.created_by,row.updated_by].includes(ctx.userId)?blocked('MAKER_CHECKER','Minta rekan yang tidak membuat atau mengajukan kontak untuk memeriksanya.'):null;
  const reviewing=v?.state==='IN_REVIEW'?null:blocked('NOT_IN_REVIEW','Tidak ada pengajuan yang menunggu pemeriksaan.');
  const verified=row.state!=='VERIFIED'?blocked('NOT_VERIFIED','Kontak harus disetujui terlebih dahulu.'):null;
  const reference=ctx.refs?.get(row.id);
  const used=row.state==='VERIFIED'&&!row.revoked_at&&reference!==false?
    reference===true?blocked('CONTACT_IN_USE',require('./contactUsage').CONTACT_USED_MESSAGE):
      blocked('CONTACT_USAGE_UNKNOWN','Penggunaan kontak belum bisa diperiksa. Coba lagi.'):null;
  return envelope(row,ctx,{
    edit_draft:action('kontak',null,[flag('draft_enabled'),revoked,v?.state==='IN_REVIEW'?review:null]),
    submit:action('kontak',null,[flag('review_enabled'),v?.state!=='DRAFT'?draft:null]),
    request_revision:action('pengajuan','sj_contact_verify',[flag('review_enabled'),authority(false),reviewing,maker]),
    verify:action('pengajuan','sj_contact_verify',[flag('sync_enabled'),authority(false),reviewing,maker]),
    set_default:action('kontak',null,[revoked,verified,row.is_default?blocked('ALREADY_DEFAULT','Kontak ini sudah menjadi kontak utama.'):null]),
    revoke:ctx.settings?.review_authority==='central'?
      action('kontak',null,[flag('review_enabled'),authority(true),revoked,verified,used],'REQUEST_CONTROL'):
      action('pengajuan','sj_contact_verify',[flag('sync_enabled'),authority(false),revoked,verified,used]),
  });
}
function changeRequest(row,ctx){
  const {flag,authority,action}=assessor(row,ctx);
  return envelope({lock_version:row.request_version},ctx,{
    resubmit:action('pengajuan',null,[flag('review_enabled'),authority(true),
      row.submitted_by!==ctx.userId?blocked('SUBMITTER_REQUIRED','Hanya pengaju awal yang bisa mengajukan ulang permintaan ini.'):null,
      row.state!=='REVISION_REQUIRED'?blocked('REVISION_REQUIRED','Permintaan ini belum meminta perbaikan.'):null], 'REQUEST_CONTROL'),
  });
}
function media(row,ctx){
  const {flag,authority}=assessor(row,ctx);
  // A removal request may carry impact blockers for Control to inspect. It is
  // not permission to revoke a referenced image; the decision rechecks usage.
  const combined={...ctx,can:()=>ctx.can('profil')||ctx.can('publikasi')};
  return {scope:'START_ACTION',expected_version:null,revalidated_on_submit:true,actions:{
    request_revoke:assessor(row,combined).action('publikasi',null,[flag('review_enabled'),authority(true),
      row.revoked_at||['REVOKED','DELETED'].includes(row.state)?blocked('REVOKED','Gambar sudah dicabut.'):null], 'REQUEST_CONTROL'),
  }};
}
function syncEvent(row,ctx){
  const {action}=assessor(row,ctx);
  return {scope:'START_ACTION',expected_version:null,revalidated_on_submit:true,actions:{
    retry:action('ringkasan','sj_sync_retry',[!['FAILED','QUARANTINED','RETRYING'].includes(row.state)?
      blocked('RETRY_UNAVAILABLE','Pengiriman ini belum bisa diulangi.'):null,
      require('./outboxTarget').outboxTargetBlock(row,ctx.settings)]),
  }};
}
module.exports={context,publication,profile,contact,changeRequest,entryActions,readEntryActions,media,syncEvent};
