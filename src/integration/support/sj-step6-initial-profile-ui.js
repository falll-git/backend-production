'use strict';

// Step6 initial singleton profile creation in the existing owned UI session.
// Parent owns services, authenticated bank tab 0, Control approval and cleanup.
// Positive writes below are visible UI inputs only. GETs and the explicit
// denied local-decision request are separate service assertions, not UI proof.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {assertContainer}=require('./sj-disposable-guard');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

exports.run=async({proof,out,cli,code,bankUi,publicUi,slug,httpApi,cycle,approve,inspect})=>{
  assert.match(proof.runId,/^[a-f0-9]{32}$/);
  assertContainer(proof,proof.pg);
  assert.equal(bankUi,'http://127.0.0.1:3111');
  assert.equal(publicUi,'http://127.0.0.1:4411');
  assert.match(slug,/^[a-z0-9][a-z0-9-]{1,119}$/);
  for(const fn of [cli,code,httpApi,cycle,approve,inspect])assert.equal(typeof fn,'function');
  const owner=JSON.parse(fs.readFileSync(path.join(proof.root,'owner.json')));
  assert.equal(owner.runId,proof.runId);assert.equal(owner.tokenHash,proof.tokenHash);
  assert.equal(fs.realpathSync(out),path.resolve(out));
  assert(path.basename(out).includes(proof.runId),'INITIAL_PROFILE_EVIDENCE_RUN_BINDING_REQUIRED');
  const evidence=path.join(out,'initial-profile-ui');fs.mkdirSync(evidence,{recursive:false});
  const portable=evidence.replaceAll('\\','/'),checks=[];
  const profileName='BPRS Cross App',profileRoute=bankUi+'/dashboard/seputar-jaminan/profil';
  let phase='fresh-profile-precondition';
  const progress=()=>fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({runId:proof.runId,phase,checks},null,2));
  const record=(check,detail={})=>{checks.push({check,pass:true,...detail});progress();};
  const act=async(label,fn,args={})=>{
    phase=label;progress();await cli('snapshot');
    return code(`async(page)=>JSON.stringify(await (${fn.toString()})(page,${JSON.stringify(args)}))`);
  };
  const get=route=>httpApi('maker','get',route);
  try{
    assert.equal(await get('/profile'),null,'INITIAL_PROFILE_MUST_BE_GENUINELY_ABSENT');
    await cli('tab-select','0');await cli('goto',profileRoute);
    record('initial-profile-real-empty-state',await act('empty-profile-ui',async page=>{
      await page.getByRole('heading',{name:'Profil BPRS',exact:true}).waitFor();
      await page.getByText('Profil BPRS belum dibuat',{exact:true}).waitFor();
      const create=page.getByRole('button',{name:'Buat profil',exact:true});await create.waitFor();
      if(!await create.isEnabled())throw Error('INITIAL_PROFILE_CREATE_NOT_AVAILABLE');
      return {empty:true,createEnabled:true};
    }));
    await inspect('bank-initial-profile-empty',profileRoute,'Profil BPRS belum dibuat');
    record('initial-profile-empty-five-viewport-capture-awaits-main-review');

    record('initial-profile-empty-save-validation-and-focus',await act('initial-profile-validation',async(page,{file})=>{
      await page.setViewportSize({width:1440,height:900});
      await page.getByRole('button',{name:'Buat profil',exact:true}).click();
      await page.locator('#sj-profile-name').waitFor();
      await page.waitForFunction(()=>document.activeElement?.id==='sj-profile-name');
      await page.getByRole('button',{name:'Simpan draf',exact:true}).click();
      await page.getByText('Perubahan belum disimpan',{exact:true}).waitFor();
      await page.getByText('Nama publik BPRS harus berisi sedikitnya 3 karakter.',{exact:true}).waitFor();
      await page.waitForFunction(()=>document.activeElement?.id==='sj-profile-name');
      await page.screenshot({path:file,type:'jpeg',quality:85,fullPage:true});
      return {validationVisible:true,nameFocused:true,screenshot:file};
    },{file:portable+'/initial-profile-empty-validation.jpg'}));
    assert.equal(await get('/profile'),null,'EMPTY_UI_SAVE_MUST_NOT_CREATE_PROFILE');

    const imageFile=path.join(evidence,'owned-initial-profile-logo.png');
    await require('sharp')({create:{width:640,height:480,channels:3,background:'#CBD6BF'}}).png().toFile(imageFile);
    record('owned-initial-profile-file-generated',{sha256:crypto.createHash('sha256').update(fs.readFileSync(imageFile)).digest('hex'),width:640,height:480});
    const logo=await act('initial-profile-fill-and-upload',async(page,{profileName,slug,imageFile,file})=>{
      await page.locator('#sj-profile-name').fill(profileName);
      await page.locator('#sj-profile-slug').fill(slug);
      await page.locator('#sj-profile-city').fill('Bandung');
      await page.locator('#sj-profile-province').fill('Jawa Barat');
      await page.locator('#sj-profile-description').fill('Data pengujian terisolasi, bukan publikasi operasional.');
      await page.locator('#sj-profile-website').fill('');
      const pending=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/v1/seputar-jaminan/media');
      await page.locator('#sj-profile-logo-upload').setInputFiles(imageFile);
      const response=await pending;
      if(response.status()!==201)throw Error('INITIAL_PROFILE_LOGO_UPLOAD_REJECTED_'+response.status());
      const body=await response.json();
      if(body.success!==true||body.data?.purpose!=='BPRS_PUBLIC_MARK')throw Error('INITIAL_PROFILE_LOGO_RECEIPT_INVALID');
      await page.getByText('Logo berhasil disimpan dan akan diperiksa oleh sistem.',{exact:true}).waitFor();
      await page.setViewportSize({width:390,height:900});
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('INITIAL_PROFILE_FORM_DOCUMENT_OVERFLOW');
      await page.screenshot({path:file,type:'jpeg',quality:85,fullPage:true});
      return body.data;
    },{profileName,slug,imageFile:imageFile.replaceAll('\\','/'),file:portable+'/initial-profile-complete-form-390.jpg'});
    assert.match(logo.id,UUID);assert.equal(logo.purpose,'BPRS_PUBLIC_MARK');
    record('initial-profile-logo-uploaded-through-real-file-input',{mediaId:logo.id,purpose:logo.purpose});
    // The fresh editor does not poll logo_ready. Save the legitimate draft,
    // process its uploaded media, then reload before using the real Ajukan CTA.
    const saved=await act('initial-profile-save-draft',async page=>{
      const pending=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.startsWith('/api/v1/seputar-jaminan/profile/save-operations/'));
      await page.getByRole('button',{name:'Simpan draf',exact:true}).click();
      const response=await pending;if(response.status()!==200)throw Error('INITIAL_PROFILE_DRAFT_REJECTED_'+response.status());
      const body=await response.json();if(body.success!==true)throw Error('INITIAL_PROFILE_DRAFT_RECEIPT_INVALID');
      await page.getByText('Draf profil BPRS berhasil disimpan.',{exact:true}).waitFor();
      return {id:body.data?.resource_id,state:body.data?.state};
    });
    assert.match(saved.id,UUID);assert.equal(saved.state,'DRAFT');
    let profile=await get('/profile');
    assert.equal(profile.id,saved.id);assert.equal(profile.state,'DRAFT');assert.equal(profile.current_version_id,null);
    assert.equal(profile.display_name,profileName);assert.equal(profile.public_slug,slug);assert.equal(profile.logo_media_id,logo.id);
    record('initial-profile-created-as-draft-through-ui',{profileId:profile.id,logoMediaId:logo.id,approvedVersionAbsent:true});

    let ready;
    for(let attempt=0;attempt<20;attempt++){await cycle();ready=await get('/media/'+logo.id+'/status');if(ready.state==='READY')break;}
    assert.equal(ready.state,'READY');assert.equal(ready.central_ready,true);
    record('initial-profile-logo-real-worker-scanner-ready',{mediaId:logo.id,state:ready.state});
    await cli('goto',profileRoute);
    record('initial-profile-draft-survives-navigation',await act('initial-profile-draft-reload',async(page,{profileName})=>{
      await page.getByRole('heading',{name:profileName,exact:true}).waitFor();
      const submit=page.getByRole('button',{name:'Ajukan',exact:true});await submit.waitFor();
      if(!await submit.isEnabled())throw Error('INITIAL_PROFILE_SUBMIT_UNAVAILABLE_AFTER_MEDIA_READY');
      return {draftVisible:true,submitEnabled:true};
    },{profileName}));
    profile=await get('/profile');assert.equal(profile.id,saved.id);assert.equal(profile.state,'DRAFT');assert.equal(profile.current_version_id,null);assert.equal(profile.logo_ready,true);
    await inspect('bank-initial-profile-draft',profileRoute,profileName);
    record('initial-profile-draft-five-viewport-capture-awaits-main-review');

    record('initial-profile-submit-through-ui',await act('initial-profile-submit',async page=>{
      await page.setViewportSize({width:1440,height:900});
      const pending=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/v1/seputar-jaminan/profile/submit');
      await page.getByRole('button',{name:'Ajukan',exact:true}).click();
      const response=await pending;if(response.status()!==200)throw Error('INITIAL_PROFILE_SUBMIT_REJECTED_'+response.status());
      const body=await response.json();if(body.data?.state!=='IN_REVIEW')throw Error('INITIAL_PROFILE_SUBMIT_STATE_INVALID');
      await page.getByText('Profil BPRS diajukan untuk diperiksa.',{exact:true}).waitFor();
      return {state:body.data.state};
    }));
    profile=await get('/profile');assert.equal(profile.id,saved.id);assert.equal(profile.state,'IN_REVIEW');assert.equal(profile.current_version_id,null);
    await httpApi('checker','post','/profile/verify',{expected_version:profile.lock_version},409);
    record('initial-profile-local-checker-denied-under-central-authority',{status:409,evidence:'REAL_SERVICE_NEGATIVE_NOT_UI'});

    phase='initial-profile-control-ui-decision';progress();
    const profileCommand=await approve('profile',profile.id);
    assert.match(profileCommand?.commandId||'',UUID);assert.match(profileCommand?.reviewId||'',UUID);
    for(let attempt=0;attempt<20;attempt++){await cycle();profile=await get('/profile');if(profile.state==='VERIFIED'&&profile.sync_state==='ACKNOWLEDGED')break;}
    assert.equal(profile.id,saved.id);assert.equal(profile.state,'VERIFIED');assert.equal(profile.sync_state,'ACKNOWLEDGED');assert.match(profile.current_version_id,UUID);
    assert.equal(profile.display_name,profileName);assert.equal(profile.logo_media_id,logo.id);
    record('initial-profile-control-ui-decision-applied-and-bank-acknowledged',{profileId:profile.id,commandId:profileCommand.commandId,reviewId:profileCommand.reviewId,approvedVersionId:profile.current_version_id});
    await inspect('public-profile',publicUi+'/bprs/'+slug,profileName);
    record('initial-profile-real-public-website-five-viewport-capture-awaits-main-review',{url:publicUi+'/bprs/'+slug});
    phase='completed';progress();
    fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({pass:true,runId:proof.runId,phase,checks,
      scope:'Actual initial profile creation/upload/draft/reload/submission and Control UI decision; actual worker ACK and rendered public website. Main-agent visual review and parent cleanup remain required.'},null,2),{flag:'wx'});
    return {profile,logo,profileCommand,checks};
  }catch(error){
    fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({pass:false,runId:proof.runId,phase,checks,
      error:{name:error.name,code:typeof error.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:null}},null,2),{flag:'wx'});
    throw error;
  }
};
