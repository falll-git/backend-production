'use strict';
// Called only after the ordinary service lifecycle has released all active
// publications/contact dependencies. No service launch, SQL or API business
// mutation: hide and logout are real UI requests in an owned final session.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {assertContainer}=require('./sj-disposable-guard');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

exports.run=async({proof,cross,out,cli,code,bankUi,publicUi,controlOrigin,httpApi,cycle,approve,slug})=>{
  assertContainer(proof,proof.pg);assert.equal(cross.performance,false);assert.equal(cross.uiStep6,true);
  assert.equal(bankUi,'http://127.0.0.1:3111');assert.equal(publicUi,'http://127.0.0.1:4411');assert.equal(controlOrigin,'http://127.0.0.1:4320');
  assert.match(slug,/^[a-z0-9][a-z0-9-]{1,119}$/);
  const evidence=path.join(out,'final-profile-ui');fs.mkdirSync(evidence,{recursive:false});
  const portable=evidence.replaceAll('\\','/'),checks=[];let phase='profile-precondition';
  const record=(check,detail={})=>{checks.push({check,pass:true,...detail});};
  const run=async(label,fn,args={})=>{phase=label;await cli('snapshot');return code(`async(page)=>JSON.stringify(await (${fn.toString()})(page,${JSON.stringify(args)}))`);};
  try{
    const before=await httpApi('maker','get','/profile');assert.equal(before.state,'VERIFIED');
    await cli('tab-select','0');await cli('goto',bankUi+'/dashboard/seputar-jaminan/profil');
    const receipt=await run('request-profile-hide-ui',async(page,{origin,file})=>{
      await page.setViewportSize({width:1440,height:900});await page.getByRole('heading',{name:'Profil BPRS',exact:true}).waitFor();
      await page.getByRole('button',{name:'Aksi profil',exact:true}).click();await page.getByRole('menuitem',{name:'Ajukan sembunyikan profil',exact:true}).click();
      const dialog=page.getByRole('dialog').filter({has:page.locator('#sj-change-request-reason')});await dialog.waitFor();
      await dialog.locator('#sj-change-request-reason').fill('Sembunyikan profil disposable setelah seluruh alur dan aset selesai diuji.');
      await page.screenshot({path:file,type:'jpeg',quality:85,fullPage:true});
      const pending=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/seputar-jaminan/profile/change-requests');
      await dialog.getByRole('button',{name:'Kirim permintaan',exact:true}).click();const response=await pending;
      if(response.status()!==201)throw Error('PROFILE_HIDE_UI_REQUEST_REJECTED_'+response.status());
      const body=await response.json();if(body.data.action!=='HIDE_PROFILE')throw Error('PROFILE_HIDE_ACTION_MISMATCH');
      await page.getByText('Permintaan berhasil dikirim ke Ruwang Control.',{exact:true}).waitFor();
      if(new URL(page.url()).origin!==origin)throw Error('BANK_UI_ORIGIN_CHANGED');
      return {id:body.data.id,action:body.data.action,state:body.data.state,screenshot:file};
    },{origin:bankUi,file:portable+'/bank-hide-confirmation.jpg'});
    assert.match(receipt.id,UUID);record('profile-hide-real-bank-ui-request',receipt);
    // The shared callback creates/authenticates Control tab 1 through its real
    // login form and confirms this exact immutable snapshot via UI controls.
    await approve('change_request',receipt.id);
    let hidden;
    for(let attempt=0;attempt<20;attempt++){
      await cycle();hidden=await httpApi('maker','get','/profile');
      if(hidden.state==='HIDDEN'&&hidden.sync_state==='ACKNOWLEDGED')break;
    }
    assert.equal(hidden.state,'HIDDEN');assert.equal(hidden.sync_state,'ACKNOWLEDGED');
    assert.equal(hidden.id,before.id);assert.equal(hidden.current_version_id,before.current_version_id,'hide is not content deletion');
    record('profile-hide-control-ui-approval-bank-acknowledged',{profileId:hidden.id,requestId:receipt.id,contentRetained:true});
    await cli('tab-select','0');await cli('goto',bankUi+'/dashboard/seputar-jaminan/profil');
    record('bank-hidden-profile-visible',await run('bank-hidden-profile-visible',async(page,{file})=>{
      await page.getByText('Disembunyikan di bank',{exact:true}).first().waitFor();await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({path:file,type:'jpeg',quality:85,fullPage:true});return {screenshot:file};
    },{file:portable+'/bank-hidden-profile.jpg'}));
    // No public tab exists in this final session until after approval. The
    // rendered not-found state is distinct from a streaming HTML HTTP status.
    await cli('tab-new',publicUi+'/bprs/'+slug);
    const shots=await run('public-hidden-profile-five-viewports',async(page,{target,out})=>{
      const shots=[];
      for(const width of [360,390,768,1024,1440]){
        await page.setViewportSize({width,height:900});const response=await page.goto(target);
        await page.getByRole('heading',{name:'Profil BPRS ini tidak ditemukan.',exact:true}).waitFor();
        await page.evaluate(()=>document.fonts.ready);
        await page.waitForFunction(()=>[...document.images].filter(image=>{const b=image.getBoundingClientRect();return b.width>0&&b.height>0&&b.top<innerHeight&&b.bottom>0;}).every(image=>image.complete&&image.naturalWidth>0));
        const file=out+'/public-hidden-profile-'+width+'.jpg';await page.screenshot({path:file,type:'jpeg',quality:85,fullPage:true});
        shots.push({width:await page.evaluate(()=>innerWidth),url:page.url(),documentStatus:response?.status()??null,renderedProfileUnavailable:true,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),screenshot:file});
      }
      return shots;
    },{target:publicUi+'/bprs/'+slug,out:portable});
    assert.equal(shots.length,5);for(const shot of shots){assert.equal(shot.overflow,false);assert.equal(shot.url,publicUi+'/bprs/'+slug);record('public-hidden-profile-awaiting-main-visual-review',shot);}

    await cli('tab-select','0');
    record('bank-real-ui-logout',await run('bank-real-ui-logout',async(page,{origin,file})=>{
      await page.setViewportSize({width:1440,height:900});
      const logout=page.getByRole('button',{name:'Logout',exact:true});
      if(!await logout.isVisible())await page.getByRole('button',{name:'Buka sidebar',exact:true}).click();
      const pending=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/auth/logout');
      await logout.click();const response=await pending;if(response.status()!==200)throw Error('BANK_LOGOUT_NOT_CONFIRMED_'+response.status());
      await page.waitForURL(origin+'/');await page.getByRole('button',{name:'Masuk',exact:true}).waitFor();
      await page.goto(origin+'/dashboard/seputar-jaminan/profil');await page.waitForURL(origin+'/');await page.getByRole('button',{name:'Masuk',exact:true}).waitFor();
      await page.screenshot({path:file,type:'jpeg',quality:85,fullPage:true});return {status:response.status(),protectedRouteRedirect:true,screenshot:file};
    },{origin:bankUi,file:portable+'/bank-logged-out.jpg'}));
    await cli('tab-select','1');
    record('control-real-ui-logout',await run('control-real-ui-logout',async(page,{origin,file})=>{
      await page.setViewportSize({width:1440,height:900});const logout=page.getByRole('button',{name:'Keluar',exact:true});
      if(!await logout.isVisible())await page.getByRole('button',{name:'Buka sidebar',exact:true}).click();
      const pending=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/auth/logout');
      await logout.click();const response=await pending;if(!response.ok())throw Error('CONTROL_LOGOUT_NOT_CONFIRMED_'+response.status());
      await page.waitForURL(origin+'/login');await page.getByRole('button',{name:'Masuk',exact:true}).waitFor();
      await page.goto(origin+'/operators');await page.waitForURL(origin+'/login');await page.getByRole('button',{name:'Masuk',exact:true}).waitFor();
      await page.screenshot({path:file,type:'jpeg',quality:85,fullPage:true});return {status:response.status(),protectedRouteRedirect:true,screenshot:file};
    },{origin:controlOrigin,file:portable+'/control-logged-out.jpg'}));
    const result={runId:proof.runId,pass:true,check:'final profile hide and logout through real UIs',requestId:receipt.id,profileId:hidden.id,checks,evidence,visualReview:'PENDING_MAIN_AGENT',boundary:'HTML streaming status is recorded, not mislabelled as public API404; bank/SJ public API absence has its separate service assertion.'};
    fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(result,null,2),{flag:'wx'});return result;
  }catch(error){
    fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({runId:proof.runId,pass:false,phase,checks,error:{name:error.name,code:error.code||null}},null,2),{flag:'wx'});throw error;
  }
};
