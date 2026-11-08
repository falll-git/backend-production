'use strict';

// Step 6 only: real user inputs in the three owned UIs. Worker cycles and GET
// assertions are explicit; no POST/PATCH business write through the API helper.
// This module neither starts services nor closes the parent's inspection tabs.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {assertContainer}=require('./sj-disposable-guard');
const {recoverContactReadThroughUi}=require('./sj-step6-contact-recovery');

const CATEGORIES=Object.freeze(['LAND','BUILDING','MACHINE_EQUIPMENT','VEHICLE']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function browserSource(fn,args){return `async(page)=>JSON.stringify(await (${fn.toString()})(page,${JSON.stringify(args)}))`;}
function assertPrerequisites({proof,cross,bankUi,publicUi,controlOrigin}){
  assert.match(proof.runId,/^[a-f0-9]{32}$/i);
  assert.equal(cross.performance,false,'Step 6 does not run performance workloads');
  assert.equal(bankUi,'http://127.0.0.1:3111');
  assert.equal(publicUi,'http://127.0.0.1:4411');
  assert.equal(controlOrigin,'http://127.0.0.1:4320');
  for(const category of CATEGORIES){
    assert.match(cross.step6CollateralIds?.[category]||'',UUID,'four new collateral prerequisites required');
    assert.equal(cross.step6CollateralNumbers?.[category],'SJ-'+proof.runId+'-UI-'+category);
  }
  assert.equal(new Set(Object.values(cross.step6CollateralIds)).size,4);
}

exports.browserSource=browserSource;
exports.assertPrerequisites=assertPrerequisites;
function assertUiEligibleSource({status,choice,expectedId,expectedNumber}){
  assert.equal(status,200,'actual UI source read must succeed');
  assert.equal(choice?.id,expectedId,'actual UI source ID must match the owned prerequisite');
  assert.equal(choice?.collateral_number,expectedNumber,'actual UI source number must match the owned prerequisite');
}
exports.assertUiEligibleSource=assertUiEligibleSource;
function assertDraftMediaBinding(asset,{sourceId,category,title,mediaId}){
  assert.equal(asset.state,'DRAFT','real UI draft must exist before waiting for media transfer');
  assert.equal(asset.source_collateral_id,sourceId);assert.equal(asset.asset_category,category);
  assert.equal(asset.current_version?.title,title);
  assert.equal(asset.current_version?.media?.[0]?.id,mediaId,'worker needs a committed publication-version/media binding');
}
exports.assertDraftMediaBinding=assertDraftMediaBinding;
exports.run=async({proof,cross,out,cli,code,bankUi,publicUi,controlOrigin,httpApi,cycle,rpc,approve,inspect})=>{
  assertPrerequisites({proof,cross,bankUi,publicUi,controlOrigin});
  assertContainer(proof,proof.pg);
  for(const fn of [cli,code,httpApi,cycle,rpc,approve,inspect])assert.equal(typeof fn,'function');
  const evidence=path.join(out,'step6-ui');fs.mkdirSync(evidence,{recursive:false});
  const portable=evidence.replaceAll('\\','/'),checks=[],assets=[];
  let phase='prerequisites',contact;
  const saved=()=>fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({runId:proof.runId,phase,checks,assets},null,2));
  const record=(check,detail={})=>{checks.push({check,pass:true,...detail});saved();};
  const act=async(label,fn,args={})=>{phase=label;saved();await cli('snapshot');return code(browserSource(fn,args));};
  const bank=async target=>{await cli('tab-select','0');await cli('goto',bankUi+target);};
  const selectControl=async target=>{await cli('tab-select','1');if(target)await cli('goto',controlOrigin+target);};
  const get=route=>httpApi('maker','get',route);
  const settle=async(route,accept)=>{
    for(let attempt=0;attempt<20;attempt++){await cycle();const value=await get(route);if(accept(value))return value;}
    throw Error('STEP6_STATE_NOT_SETTLED');
  };
  const screen=async(label,width=1440)=>act('screenshot-'+label,async(page,{file,width})=>{
    await page.setViewportSize({width,height:900});await page.evaluate(()=>document.fonts.ready);
    // Desktop sidebar appears immediately, but workspace margin transitions.
    // Never accept a capture taken halfway through that real layout change.
    await page.waitForFunction(()=>{
      const shell=document.querySelector('.control-shell'),workspace=document.querySelector('.control-workspace'),sidebar=document.querySelector('.control-sidebar');
      if(!shell||!workspace||!sidebar)return true;
      const running=document.getAnimations().some(a=>a.playState==='running'&&[workspace,sidebar].includes(a.effect?.target));
      if(running)return false;
      const margin=parseFloat(getComputedStyle(workspace).marginLeft),collapsed=shell.classList.contains('is-collapsed');
      const expected=innerWidth>=1024&&!collapsed?sidebar.getBoundingClientRect().width:0;
      return Math.abs(margin-expected)<0.5&&(!(innerWidth>=1024&&!collapsed)||workspace.getBoundingClientRect().left>=sidebar.getBoundingClientRect().right-0.5);
    },null,{timeout:5000});
    await page.screenshot({path:file,type:'jpeg',quality:85,fullPage:true});
    return {file,width:await page.evaluate(()=>innerWidth),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)};
  },{file:portable+'/'+label+'-'+width+'.jpg',width});
  const checkScreen=async(label,width=1440)=>{const shot=await screen(label,width);assert.equal(shot.overflow,false,label+' horizontal document overflow');record('screenshot-awaiting-main-visual-review',shot);};
  const lifecycle=async({label,route,trigger,action,resourceId,expected})=>{
    await bank(route);
    const request=await act('lifecycle-'+label,async(page,{trigger,action,reason,pathname})=>{
      await page.setViewportSize({width:1440,height:900});
      if(trigger.kind==='menu'){
        await page.getByRole('button',{name:trigger.menu,exact:true}).click();
        await page.getByRole('menuitem',{name:trigger.item,exact:true}).click();
      }else await page.getByRole('button',{name:trigger.button,exact:true}).click();
      const dialog=page.getByRole('dialog').filter({has:page.locator('#sj-change-request-reason')});
      await dialog.waitFor();
      // Empty reason must remain a visible validation failure with native focus.
      await dialog.getByRole('button',{name:'Kirim permintaan',exact:true}).click();
      await dialog.getByRole('alert').waitFor();
      await page.waitForFunction(()=>document.activeElement?.id==='sj-change-request-reason');
      if(!await dialog.locator('#sj-change-request-reason').evaluate(el=>document.activeElement===el))throw Error('LIFECYCLE_VALIDATION_FOCUS');
      await dialog.locator('#sj-change-request-reason').fill(reason);
      const pending=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===pathname);
      await dialog.getByRole('button',{name:'Kirim permintaan',exact:true}).click();
      const response=await pending;
      if(response.status()!==201)throw Error('LIFECYCLE_UI_REQUEST_REJECTED_'+response.status());
      const body=await response.json();
      await page.getByText('Permintaan berhasil dikirim ke Ruwang Control.',{exact:true}).waitFor();
      if(body.data.action!==action)throw Error('LIFECYCLE_ACTION_MISMATCH');
      return {id:body.data.id,action:body.data.action,state:body.data.state};
    },{trigger,action,reason:'Permintaan UI '+label+' pada resource disposable milik run.',pathname:'/api/v1/seputar-jaminan/'+(action==='REVOKE_CONTACT'?'contacts/'+resourceId:action==='REVOKE_MEDIA'?'media/'+resourceId:'publications/'+resourceId)+'/change-requests'});
    assert.match(request.id,UUID);await approve('change_request',request.id);
    if(expected){const row=await settle('/publications/'+resourceId,r=>r.state===expected&&r.sync_state==='ACKNOWLEDGED');assert.ok(row.current_version,'archive must retain content');}
    record('real-ui-lifecycle-'+label,{resourceId,requestId:request.id,action});
    return request;
  };
  try{
    // Login correctly revokes browserMaker's bootstrap session. Never mint a
    // replacement browser fixture session, extract its token or bypass auth.
    // Each positive source read is proved below by the real picker-triggered
    // authenticated request and selection. The independent API maker remains
    // a negative RLS actor for these browser-owned debtor prerequisites.
    const makerEligible=await get('/eligible-collaterals?limit=20');
    assert.equal(makerEligible.items.some(item=>Object.values(cross.step6CollateralIds).includes(item.id)),false,'maker cannot read browser actor-owned debtor sources');
    record('api-maker-cannot-read-browser-owned-source-prerequisites');

    await bank('/dashboard/seputar-jaminan/kontak');
    const contactLabel='Kontak UI lengkap '+proof.runId.slice(0,8);
    contact=await act('new-contact-ui',async(page,{contactLabel})=>{
      await page.setViewportSize({width:1440,height:900});
      await page.getByRole('button',{name:'Tambah kontak',exact:true}).click();
      const dialog=page.getByRole('dialog').filter({has:page.locator('#sj-contact-label')});await dialog.waitFor();
      await dialog.locator('#sj-contact-label').fill(contactLabel);
      await dialog.locator('#sj-contact-phone').fill('+6281234567803');
      const pending=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.includes('/contacts/save-operations/'));
      await dialog.getByRole('button',{name:'Simpan dan ajukan',exact:true}).click();
      const response=await pending;if(!response.ok())throw Error('UI_CONTACT_SAVE_REJECTED');const body=await response.json();
      await page.getByText('Kontak disimpan dan diajukan untuk diperiksa.',{exact:true}).waitFor();
      return {id:body.data.resource_id,state:body.data.state};
    },{contactLabel});
    assert.match(contact.id,UUID);assert.equal(contact.state,'IN_REVIEW');await approve('contact',contact.id);
    contact=await get('/contacts/'+contact.id);assert.equal(contact.state,'VERIFIED');
    record('own-contact-created-and-submitted-through-ui',{id:contact.id});
    // Fixture bytes are not posted through an API helper. A real file input
    // submits this generated clean image through the application upload flow.
    const imageFile=path.join(evidence,'owned-ui-image.png');
    await require('sharp')({create:{width:640,height:480,channels:3,background:'#B9D6E4'}}).png().toFile(imageFile);
    const imageSHA=crypto.createHash('sha256').update(fs.readFileSync(imageFile)).digest('hex');
    record('owned-upload-file-generated',{sha256:imageSHA,width:640,height:480});

    for(const category of CATEGORIES){
      await bank('/dashboard/seputar-jaminan/publikasi');
      await act('create-open-'+category,async page=>{
        await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'Buat publikasi',exact:true}).click();
        const dialog=page.getByRole('dialog',{name:'Buat publikasi baru',exact:true});await dialog.waitFor();
        // No source selected: this is an actual frontend validation negative.
        await dialog.getByRole('button',{name:'Simpan draf',exact:true}).click();
        await dialog.getByRole('alert').getByText('Pilih agunan yang menjadi sumber publikasi.',{exact:false}).waitFor();
        await page.waitForFunction(()=>document.activeElement?.id==='sj-publication-source-collateral');
        if(!await dialog.locator('#sj-publication-source-collateral').evaluate(el=>document.activeElement===el))throw Error('CREATE_VALIDATION_FOCUS');
        return {sourceValidation:true};
      });
      const title='Aset UI baru '+category+' '+proof.runId.slice(0,8);
      const uploaded=await act('fill-and-upload-'+category,async(page,{category,title,sourceNumber,expectedSourceId,contactVersion,imageFile})=>{
        const dialog=page.getByRole('dialog',{name:'Buat publikasi baru',exact:true});
        await dialog.locator('#sj-publication-source-collateral').click();
        const sourceRead=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname==='/api/v1/seputar-jaminan/eligible-collaterals'&&new URL(r.url()).searchParams.get('search')===sourceNumber);
        await page.getByRole('combobox',{name:'Cari nomor atau keterangan agunan…',exact:true}).fill(sourceNumber);
        const sourceResponse=await sourceRead;
        if(sourceResponse.status()!==200)throw Error('UI_ELIGIBLE_SOURCE_STATUS_'+sourceResponse.status());
        const sourceBody=await sourceResponse.json();
        const matches=sourceBody.data.items.filter(item=>item.id===expectedSourceId&&item.collateral_number===sourceNumber);
        if(matches.length!==1)throw Error('UI_ELIGIBLE_SOURCE_IDENTITY_MISMATCH');
        const sourceChoice={status:sourceResponse.status(),choice:{id:matches[0].id,collateral_number:matches[0].collateral_number}};
        const option=page.getByRole('option').filter({hasText:sourceNumber});await option.waitFor();
        if(await option.count()!==1)throw Error('SOURCE_OPTION_NOT_UNIQUE');await option.click();
        await dialog.locator('#sj-publication-category').selectOption(category);
        const selected=await dialog.locator('#sj-publication-taxonomy').inputValue();if(!selected)throw Error('CATEGORY_TAXONOMY_MISSING');
        await dialog.locator('#sj-publication-title').fill(title);
        await dialog.locator('#sj-publication-description').fill('Aset pengujian UI terisolasi, bukan penawaran nyata. Informasi aman tanpa data nasabah.');
        await dialog.locator('#sj-publication-city').fill('Bandung');await dialog.locator('#sj-publication-province').fill('Jawa Barat');
        await dialog.locator('#sj-publication-whatsapp-contact').selectOption(contactVersion);
        if(category==='LAND')await dialog.locator('#sj-publication-attribute-land_area_m2').fill('120');
        if(category==='BUILDING')await dialog.locator('#sj-publication-attribute-building_area_m2').fill('80');
        if(category==='VEHICLE')await dialog.locator('#sj-publication-attribute-brand').fill('Merek tes');
        if(['VEHICLE','MACHINE_EQUIPMENT'].includes(category)){
          await dialog.locator('#sj-publication-attribute-model_or_type').fill('Model pengujian');
          await dialog.locator('#sj-publication-attribute-public_condition').selectOption('BAIK');
        }
        const pending=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/seputar-jaminan/media');
        await dialog.locator('#sj-publication-add-media').setInputFiles(imageFile);
        const response=await pending;if(response.status()!==201)throw Error('UI_UPLOAD_REJECTED');const body=await response.json();
        await dialog.locator('#sj-publication-media-alt-0').fill('Foto aset tes UI '+category);
        await page.getByText('1 gambar berhasil disimpan.',{exact:true}).waitFor();
        return {mediaId:body.data.id,taxonomyId:selected,sourceChoice};
      },{category,title,sourceNumber:cross.step6CollateralNumbers[category],expectedSourceId:cross.step6CollateralIds[category],contactVersion:contact.current_version_id,imageFile:imageFile.replaceAll('\\','/')});
      assertUiEligibleSource({...uploaded.sourceChoice,expectedId:cross.step6CollateralIds[category],expectedNumber:cross.step6CollateralNumbers[category]});
      record('actual-browser-source-read-and-selection-'+category,uploaded.sourceChoice);
      assert.match(uploaded.mediaId,UUID);
      // PUBLICATION_IMAGE transfer requires a committed publication-version
      // binding (syncWorker.uploadMedia). It cannot become READY while it exists
      // only in the unsaved form. Do not force status or fabricate a binding.
      if(category==='LAND'){await checkScreen('new-publication-complete-form',390);await checkScreen('new-publication-complete-form',1440);}
      const receipt=await act('save-new-draft-'+category,async page=>{
        const dialog=page.getByRole('dialog',{name:'Buat publikasi baru',exact:true});
        const pending=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.includes('/publications/save-operations/'));
        await dialog.getByRole('button',{name:'Simpan draf',exact:true}).click();
        const response=await pending;if(!response.ok())throw Error('NEW_DRAFT_UI_REJECTED');const body=await response.json();
        await page.getByText('Draf publikasi berhasil disimpan.',{exact:true}).waitFor();
        return {id:body.data.resource_id,state:body.data.state};
      });
      assert.match(receipt.id,UUID);assert.equal(receipt.state,'DRAFT');
      let asset=await get('/publications/'+receipt.id);
      assertDraftMediaBinding(asset,{sourceId:cross.step6CollateralIds[category],category,title,mediaId:uploaded.mediaId});
      const readyMedia=await settle('/media/'+uploaded.mediaId+'/status',row=>row.state==='READY'&&row.central_ready===true);
      record('real-ui-draft-binding-then-worker-media-ready-'+category,{publicationId:asset.id,mediaId:uploaded.mediaId,state:readyMedia.state,centralReady:readyMedia.central_ready});
      await bank('/dashboard/seputar-jaminan/publikasi?detail='+asset.id);
      await act('submit-new-draft-'+category,async page=>{
        const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Ajukan pemeriksaan',exact:true}).click();
        await page.getByText('Publikasi diajukan untuk diperiksa.',{exact:true}).waitFor();return {submitted:true};
      });
      asset=await get('/publications/'+asset.id);assert.equal(asset.state,'IN_REVIEW');
      await approve('publication',asset.id);
      asset=await settle('/publications/'+asset.id,row=>row.state==='PUBLISHED'&&row.sync_state==='ACKNOWLEDGED');
      assert.equal(asset.published_version.title,title);
      assets.push({id:asset.id,reference_code:asset.reference_code,category,mediaId:uploaded.mediaId,title});
      record('new-'+category+'-draft-upload-submit-control-ui-approve',{resourceId:asset.id,mediaId:uploaded.mediaId});
      await inspect('step6-new-publication-'+category,publicUi+'/aset/'+asset.reference_code,title);
    }

    // URL state, a genuine empty filter and Back/Forward. No page total is
    // fabricated for the bank's cursor-only contract.
    await bank('/dashboard/seputar-jaminan/publikasi');
    const navigation=await act('bank-filter-empty-back-forward',async(page,{title,empty,file})=>{
      await page.setViewportSize({width:1440,height:900});const search=page.getByRole('textbox',{name:'Cari publikasi',exact:true});
      await search.fill(title);await page.waitForURL(url=>url.searchParams.get('search')===title);
      await page.getByText(title,{exact:true}).first().waitFor();
      const filtered=page.url();
      await page.getByRole('button',{name:'Atur ulang',exact:true}).click();await page.waitForURL(url=>!url.searchParams.has('search'));const reset=page.url();
      await page.goBack();await page.waitForURL(filtered);await page.getByText(title,{exact:true}).first().waitFor();
      await page.goForward();await page.waitForURL(reset);
      await search.fill(empty);await page.waitForURL(url=>url.searchParams.get('search')===empty);
      await page.getByText('Publikasi tidak ditemukan',{exact:true}).waitFor();await page.screenshot({path:file,type:'jpeg',quality:85,fullPage:true});
      await page.getByRole('button',{name:'Atur ulang',exact:true}).click();await page.waitForURL(url=>!url.searchParams.has('search'));
      return {back:true,forward:true,empty:true,screenshot:file};
    },{title:assets[0].title,empty:'TidakAda-'+proof.runId,file:portable+'/bank-empty-filter.jpg'});
    record('bank-filter-url-empty-back-forward',navigation);

    // All lifecycle writes below still originate from visible bank controls.
    // Original service-fixture assets are left alone for the caller's gates.
    const first=assets[0];
    await lifecycle({label:'withdraw-own-land',route:'/dashboard/seputar-jaminan/publikasi?detail='+first.id,trigger:{kind:'menu',menu:'Aksi publikasi',item:'Ajukan penarikan'},action:'UNPUBLISH_PUBLICATION',resourceId:first.id,expected:'UNPUBLISHED'});
    await cli('tab-select','2');await cli('goto',publicUi+'/aset/'+first.reference_code);
    const withdrawn=await act('public-withdrawn-ui',async page=>{
      await page.getByRole('heading',{name:'Aset ini tidak dapat ditemukan.',exact:true}).waitFor();return {publicUnavailable:true};
    });record('public-withdrawn-real-route',withdrawn);
    await checkScreen('public-withdrawn',390);
    for(const asset of assets){
      await lifecycle({label:'archive-own-'+asset.category,route:'/dashboard/seputar-jaminan/publikasi?detail='+asset.id,trigger:{kind:'menu',menu:'Aksi publikasi',item:'Ajukan arsip'},action:'ARCHIVE_PUBLICATION',resourceId:asset.id,expected:'ARCHIVED'});
      await cli('tab-select','2');await cli('goto',publicUi+'/aset/'+asset.reference_code);
      record('public-archived-negative-'+asset.category,await act('public-archived-negative-'+asset.category,async(page,{origin,reference,file})=>{
        await page.getByRole('heading',{name:'Aset ini tidak dapat ditemukan.',exact:true}).waitFor();
        const response=await page.request.get(origin+'/api/public/assets/'+encodeURIComponent(reference));
        if(response.status()!==404)throw Error('ARCHIVED_PUBLIC_ADAPTER_NOT_404');
        await page.screenshot({path:file,type:'jpeg',quality:85,fullPage:true});
        return {resourceReference:reference,renderedUnavailable:true,adapterStatus:response.status(),screenshot:file};
      },{origin:publicUi,reference:asset.reference_code,file:portable+'/public-archived-'+asset.category+'.jpg'}));
    }
    await lifecycle({label:'revoke-own-contact',route:'/dashboard/seputar-jaminan/kontak',trigger:{kind:'menu',menu:'Aksi kontak '+contactLabel,item:'Ajukan pencabutan'},action:'REVOKE_CONTACT',resourceId:contact.id});
    const contacts=await get('/contacts?paged=true&limit=20');assert.equal(contacts.items.some(row=>row.id===contact.id),false);
    // Archived publication details retain the photo and the supported removal
    // action. The dedicated image is no longer referenced by active content.
    await lifecycle({label:'revoke-own-media',route:'/dashboard/seputar-jaminan/publikasi?detail='+first.id,trigger:{kind:'button',button:'Ajukan pencabutan'},action:'REVOKE_MEDIA',resourceId:first.mediaId});
    assert.equal((await get('/media/'+first.mediaId+'/status')).state,'REVOKED');

    await selectControl('/operators');
    const account='ui-'+proof.runId.slice(0,20);
    const operator=await act('control-operator-create-and-duplicate',async(page,{account,password,file})=>{
      await page.setViewportSize({width:1440,height:900});const open=page.getByRole('button',{name:'Buat akun',exact:true});await open.click();
      let dialog=page.getByRole('dialog',{name:'Buat akun operator',exact:true});await dialog.waitFor();
      await page.waitForFunction(()=>document.activeElement?.getAttribute('name')==='displayName');
      const initial=await dialog.locator('[name="displayName"]').evaluate(el=>document.activeElement===el);if(!initial)throw Error('OPERATOR_INITIAL_FOCUS');
      for(let i=0;i<9;i++){await page.keyboard.press('Tab');if(!await dialog.evaluate(el=>el.contains(document.activeElement)))throw Error('OPERATOR_TAB_TRAP');}
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});if(!await open.evaluate(el=>document.activeElement===el))throw Error('OPERATOR_RESTORE_FOCUS');
      await open.click();dialog=page.getByRole('dialog',{name:'Buat akun operator',exact:true});
      await dialog.locator('[name="displayName"]').fill('Operator UI disposable');await dialog.locator('[name="username"]').fill(account);await dialog.locator('[name="password"]').fill(password);
      const pending=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/operators');
      await dialog.getByRole('button',{name:'Simpan akun',exact:true}).click();const response=await pending;if(response.status()!==201)throw Error('OPERATOR_CREATE_REJECTED_'+response.status());
      await dialog.waitFor({state:'hidden'});await page.getByText('@'+account,{exact:true}).waitFor();
      await open.click();dialog=page.getByRole('dialog',{name:'Buat akun operator',exact:true});
      await dialog.locator('[name="displayName"]').fill('Duplikat tidak boleh dibuat');await dialog.locator('[name="username"]').fill(account);await dialog.locator('[name="password"]').fill(password);
      const duplicate=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/operators');await dialog.getByRole('button',{name:'Simpan akun',exact:true}).click();
      if((await duplicate).status()!==409)throw Error('OPERATOR_DUPLICATE_NOT_DENIED');await dialog.getByText('Username sudah digunakan. Pilih username lain.',{exact:true}).waitFor();
      await page.waitForFunction(()=>document.activeElement?.getAttribute('name')==='username');
      if(!await dialog.locator('[name="username"]').evaluate(el=>document.activeElement===el))throw Error('OPERATOR_DUPLICATE_FOCUS');
      // Never screenshot a populated password form, even in a disposable run.
      await dialog.locator('[name="password"]').fill('');await page.screenshot({path:file,type:'jpeg',quality:85,fullPage:true});
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});return {created:true,duplicate409:true,focusTrap:true,escapeRestore:true,screenshot:file};
    },{account,password:cross.browserPassword,file:portable+'/control-operator-duplicate.jpg'});
    record('real-control-operator-ui-create-duplicate-keyboard',operator);
    const notifications=await act('control-notifications-keyboard',async page=>{
      const bell=page.getByRole('button',{name:'Buka notifikasi',exact:true});await bell.click();const dialog=page.getByRole('dialog',{name:'Notifikasi',exact:true});await dialog.waitFor();
      await dialog.getByRole('link',{name:/Pengajuan konten/}).waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      if(!await bell.evaluate(el=>document.activeElement===el))throw Error('NOTIFICATION_ESCAPE_FOCUS');return {loaded:true,escapeRestore:true};
    });record('control-notification-real-counts-and-escape',notifications);
    await selectControl('/reviews');
    record('control-keyboard-tabs',await act('control-keyboard-tabs',async page=>{
      const tab=page.getByRole('tab',{name:'Pengajuan konten',exact:true});await tab.click();await tab.press('End');
      const lifecycle=page.getByRole('tab',{name:'Penarikan & perubahan',exact:true});await page.waitForFunction(()=>document.getElementById('sj-lifecycle')?.getAttribute('aria-selected')==='true');if(await lifecycle.getAttribute('aria-selected')!=='true')throw Error('CONTROL_TAB_END');
      await lifecycle.press('Home');await page.waitForFunction(()=>document.getElementById('sj-content')?.getAttribute('aria-selected')==='true');if(await page.getByRole('tab',{name:'Pengajuan konten',exact:true}).getAttribute('aria-selected')!=='true')throw Error('CONTROL_TAB_HOME');return {end:true,home:true};
    }));
    await checkScreen('control-reviews',390);await checkScreen('control-reviews',1440);
    // Only actual disabled/absent routes from the current source are checked;
    // unknown URLs are not used as fictitious feature contracts.
    record('control-navigation-has-only-current-modules',await act('control-navigation-current',async page=>{
      const links=await page.locator('nav[aria-label="Navigasi utama"]').first().locator('a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
      const expected=['/','/reviews','/monitoring','/operators'];if(JSON.stringify(links)!==JSON.stringify(expected))throw Error('CONTROL_NAVIGATION_SCOPE');return {links};
    }));
    await bank('/dashboard/seputar-jaminan/kontak');
    record('bank-controlled-read-failure-and-recovery',await act('bank-read-failure-and-recovery',recoverContactReadThroughUi,
      {file:portable+'/bank-contact-read-error.jpg',recoveredFile:portable+'/bank-contact-read-recovered.jpg'}));
    phase='completed';
    const result={pass:true,runId:proof.runId,checks,assets,evidence,coverage:'Actual bank UI new contact and four categories with file inputs; Control UI decisions and operator create/duplicate; withdrawal/archive/revocation and actual public website readback. Screenshots require separate main-agent visual review.',pending:['Shared profile hide is intentionally deferred to the final lifecycle hook; original service publications/profile must remain available to the caller.','Full visual, native zoom, modes and final logout are main-agent inspection responsibilities.']};
    fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2),{flag:'wx'});return result;
  }catch(error){
    // No exception text/credentials/payload dumps. Parent preserves its own
    // safe diagnostic and actual process result; this is not a PASS receipt.
    fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({pass:false,runId:proof.runId,phase,checks,assets,error:{name:error.name,code:error.code||null}},null,2),{flag:'wx'});
    throw error;
  }
};

exports.finalProfileHide=require('./sj-step6-final-profile-ui').run;
