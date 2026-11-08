const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
// Infrastructure bootstrap only: isolated users/RBAC and a source agunan.
// No INSERT/UPDATE into SJ profile/contact/media/publication/version/outbox tables.
async function seedActors(client, runId, browserPassword, {publicationSources=0,step6PublicationSources=false}={}) {
  if(!Number.isInteger(publicationSources)||publicationSources<0||publicationSources>32)throw Error('BOUNDED_SOURCE_FIXTURES_REQUIRED');
  if(typeof step6PublicationSources!=='boolean'||(step6PublicationSources&&!browserPassword))throw Error('UI_SOURCE_FIXTURES_REQUIRE_BROWSER');
  const division = crypto.randomUUID();
  await client.query('INSERT INTO divisions(id,name,updated_at) VALUES ($1,$2,now())',[division,'SJ test '+runId]);
  const actors = {};
  for (const kind of ['maker','checker','denied','outsider','outsideChecker',...(browserPassword?['browserMaker']:[])]) {
    const id=crypto.randomUUID(),role=crypto.randomUUID(), password=kind==='browserMaker'?browserPassword:crypto.randomBytes(24).toString('hex');
    const outside=['outsider','outsideChecker'].includes(kind);
    const actorDivision=outside?crypto.randomUUID():division;
    if(outside)await client.query('INSERT INTO divisions(id,name,updated_at) VALUES($1,$2,now())',[actorDivision,'Other test division '+kind+' '+runId]);
    await client.query('INSERT INTO roles(id,name,updated_at) VALUES ($1,$2,now())',[role,`SJ ${kind} ${runId}`]);
    await client.query(`INSERT INTO users(id,name,username,email,password,role_id,division_id,is_active,onboarding_status,password_set_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,true,'ACTIVE',now(),now())`,[id,`SJ ${kind}`,`${kind}-${runId}`,`${kind}-${runId}@example.test`,await bcrypt.hash(password,10),role,actorDivision]);
    actors[kind]={id,role_id:role,division_id:actorDivision}; // No login password output or runtime privilege escalation.
    // Session bootstrap is an auth prerequisite, not an SJ business transition.
    const sessionId=crypto.randomUUID();
    await client.query(`INSERT INTO refresh_tokens(id,user_id,token_hash,expires_at,updated_at) VALUES($1,$2,$3,now()+interval '1 hour',now())`,[sessionId,id,crypto.randomBytes(32).toString('hex')]);
    actors[kind].session_id=sessionId;
    if(kind!=='denied') for(const section of ['ringkasan','profil','kontak','publikasi','pengajuan','debtor-source']) {
      const url=section==='debtor-source'?'/dashboard/informasi-debitur/master-debitur':'/dashboard/seputar-jaminan/'+section;
      let menu=(await client.query('SELECT id FROM menus WHERE url=$1 LIMIT 1',[url])).rows[0];
      if(!menu){menu={id:crypto.randomUUID()};await client.query('INSERT INTO menus(id,name,url,updated_at) VALUES ($1,$2,$3,now())',[menu.id,section,url]);}
      const features=['checker','outsideChecker'].includes(kind)?['sj_profile_verify','sj_contact_verify','sj_review','sj_publish','sj_unpublish','sj_archive','sj_reconfirm','sj_sync_retry']:[];
      await client.query('INSERT INTO role_menus(id,role_id,menu_id,can_create,can_read,can_update,can_delete,features,updated_at) VALUES($1,$2,$3,true,true,true,false,$4,now())',[crypto.randomUUID(),role,menu.id,features]);
    }
  }
  // Agunan fixture is a prerequisite from a different module, not a forged SJ lifecycle.
  const debtor=crypto.randomUUID();
  await client.query('INSERT INTO digital_debtors(id,name,debtor_number,marketing_user_id,created_by,updated_at) VALUES($1,$2,$3,$4,$4,now())',[debtor,'Debitur tes terisolasi','SJ-'+runId,actors.maker.id]);
  actors.collateralIds={};
  for(const category of ['LAND','BUILDING','MACHINE_EQUIPMENT','VEHICLE']) {
    const collateral=crypto.randomUUID();
    await client.query('INSERT INTO debtor_collaterals(id,debtor_id,collateral_number,period_month,updated_at) VALUES($1,$2,$3,$4,now())',[collateral,debtor,'SJ-'+runId+'-'+category,'2026-09']);
    actors.collateralIds[category]=collateral;
  }
  // Four additional source records are UI creation prerequisites, not SJ state.
  // Existing service publications already consume the first four collaterals.
  actors.step6CollateralIds={};actors.step6CollateralNumbers={};
  let uiDebtor;
  if(step6PublicationSources){
    uiDebtor=crypto.randomUUID();
    await client.query('INSERT INTO digital_debtors(id,name,debtor_number,marketing_user_id,created_by,updated_at) VALUES($1,$2,$3,$4,$4,now())',[uiDebtor,'Debitur sumber UI terisolasi','SJ-UI-'+runId,actors.browserMaker.id]);
  }
  if(step6PublicationSources)for(const category of ['LAND','BUILDING','MACHINE_EQUIPMENT','VEHICLE']) {
    const id=crypto.randomUUID(),number='SJ-'+runId+'-UI-'+category;
    await client.query('INSERT INTO debtor_collaterals(id,debtor_id,collateral_number,period_month,updated_at) VALUES($1,$2,$3,$4,now())',[id,uiDebtor,number,'2026-09']);
    actors.step6CollateralIds[category]=id;actors.step6CollateralNumbers[category]=number;
  }
  actors.performanceCollateralIds=[];
  for(let index=0;index<publicationSources;index++){
    const id=crypto.randomUUID();
    await client.query('INSERT INTO debtor_collaterals(id,debtor_id,collateral_number,period_month,updated_at) VALUES($1,$2,$3,$4,now())',[id,debtor,'SJ-'+runId+'-PERF-'+index,'2026-09']);
    actors.performanceCollateralIds.push(id);
  }
  return actors;
}
module.exports={seedActors};
