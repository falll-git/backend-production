// Browser evidence only against the test-owned Control server. Credentials are
// random test prerequisites, never operational accounts or captured cookies.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const execute=require('node:util').promisify(require('node:child_process').execFile);
const {runBrowserCode}=require('./sj-browser-code-file');
exports.run=async({proof,cross,origin,reviews})=>{
  assert.ok(cross.browserRoot);assert.equal(new URL(origin).hostname,'127.0.0.1');
  const session='sj-cross-'+proof.runId.slice(0,10),workspace='C:/Users/falll/Documents/Codex/2026-09-13/https-seputarjaminan-ruwangarsip-com-https-seputarjaminan';
  const out=path.join(workspace,'output/playwright/cross-app-'+proof.runId);fs.mkdirSync(out,{recursive:true});
  const toolchain=require('./sj-browser-toolchain').resolveCliToolchain(cross.browserToolchain);
  const {resolveTestBrowserSelection,browserCommandArgs}=require('./sj-browser-selection');
  const browserSelection=cross.browserSelection?resolveTestBrowserSelection(cross.browserSelection.proofPath):null;
  if(browserSelection)assert.deepEqual(browserSelection,cross.browserSelection,'selected browser proof drift');
  const browserEnv={...Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','USERPROFILE','APPDATA','LOCALAPPDATA'].includes(k.toUpperCase()))),NO_UPDATE_NOTIFIER:'1'};
  const cli=async(...args)=>(await execute(process.execPath,[toolchain.entry,'--session',session,...browserCommandArgs(args,browserSelection)],{cwd:workspace,env:browserEnv,windowsHide:true,encoding:'utf8',timeout:60000})).stdout;
  const parse=output=>{assert.ok(!output.includes('### Error'),'browser command failed');const raw=output.split('### Result')[1]?.split('###')[0]?.trim();assert.ok(raw,'browser result missing');const value=JSON.parse(raw);return typeof value==='string'?JSON.parse(value):value;};
  const capture=async source=>parse(await runBrowserCode({out,source,execute:filename=>cli('run-code','--filename='+filename)}));
  const checks=[];let phase='open';
  try{
    const opened=await cli('open',origin+'/login');assert.ok(!opened.includes('### Error'));
    const engine=parse(await cli('run-code','async(page)=>{const browser=page.context().browser();if(!browser)throw Error("BrowserVersionUnavailable");return JSON.stringify({version:browser.version()});}'));
    assert.match(engine.version,/^\d+(?:\.\d+){1,3}$/);
    if(browserSelection)assert.equal(engine.version,browserSelection.version,'actual browser does not match explicit proof');
    fs.writeFileSync(path.join(out,'browser-engine.json'),JSON.stringify({runId:proof.runId,at:new Date().toISOString(),...engine,selection:browserSelection,toolchain},null,2),{flag:'wx'});
    const snapshot=await cli('snapshot');const snapshotFile=snapshot.match(/\]\(([^)]+\.yml)\)/)?.[1];
    const dom=snapshot.includes('```yaml')?snapshot: snapshotFile?fs.readFileSync(path.resolve(workspace,snapshotFile),'utf8'):'';assert.match(dom,/textbox "Username"/);assert.match(dom,/textbox "Password Tampilkan password"/);assert.match(dom,/button "Masuk"/);
    phase='login-validation';
    const validation=parse(await cli('run-code',`async(page)=>{const input=page.getByRole('textbox',{name:'Username',exact:true});const pattern=await input.getAttribute('pattern');new RegExp(pattern,'v');await input.fill('Invalid Name');const invalid=await input.evaluate(e=>e.validity.patternMismatch);await input.fill('reviewer-test');const valid=await input.evaluate(e=>e.validity.valid);return JSON.stringify({invalid,valid});}`));
    assert.equal(validation.invalid,true);assert.equal(validation.valid,true);
    // CLI output contains executed code: do not save or print login output.
    phase='login';
    const login=parse(await cli('run-code',`async(page)=>{await page.getByRole('textbox',{name:'Username',exact:true}).fill(${JSON.stringify('reviewer-'+proof.runId)});await page.getByRole('textbox',{name:'Password Tampilkan password',exact:true}).fill(${JSON.stringify(cross.browserPassword)});await page.getByRole('button',{name:'Masuk',exact:true}).click();await page.waitForURL(${JSON.stringify(origin+'/')});return JSON.stringify({authenticated:page.url()===${JSON.stringify(origin+'/')}});}`));assert.equal(login.authenticated,true);
    for(const width of [360,390,768,1024,1440])for(const review of reviews){
      phase=review.kind+'-'+width;
      const file=path.join(out,review.kind+'-'+width+'.png').replaceAll('\\','/'),target=origin+'/reviews/'+review.reviewId;
      // Wait for actual content, historical media and the current text wordmark.
      // A prior network-idle failure exposed a stalled runtime image optimizer;
      // retain request diagnostics and reject outstanding requests as well.
      const r=await capture(`async(page)=>{const errors=[],pending=new Map();const onError=e=>errors.push(e.message);const onRequest=req=>pending.set(req,{path:new URL(req.url()).pathname,resourceType:req.resourceType()});const onDone=req=>pending.delete(req);page.on('pageerror',onError);page.on('request',onRequest);page.on('requestfinished',onDone);page.on('requestfailed',onDone);try{await page.setViewportSize({width:${width},height:900});await page.goto(${JSON.stringify(target)},{waitUntil:'domcontentloaded'});await page.getByRole('region',{name:'Keputusan pemeriksaan',exact:true}).getByText('Diterapkan di bank',{exact:true}).waitFor();await page.getByText(${JSON.stringify(review.expected)},{exact:true}).first().waitFor();${review.kind==='profile'?`await page.waitForFunction(()=>{const images=[...document.querySelectorAll('img[src*="/media/"]')];return images.length>0&&images.every(img=>img.complete&&img.naturalWidth>0);});`:''}${width>=1024?`await page.locator('.control-brand').getByText('RuwangControl',{exact:true}).waitFor();`:''}let networkIdle=true;try{await page.waitForLoadState('networkidle',{timeout:5000});}catch(e){if(e.name!=='TimeoutError')throw e;networkIdle=false;}await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});const state=await page.evaluate(()=>({url:location.href,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,text:document.body.innerText}));await page.screenshot({path:${JSON.stringify(file)},fullPage:true});return JSON.stringify({state,errors,networkIdle,pending:[...pending.values()]});}finally{page.off('pageerror',onError);page.off('request',onRequest);page.off('requestfinished',onDone);page.off('requestfailed',onDone);}}`);
      assert.equal(r.state.url,target);assert.equal(r.state.width,width);assert.equal(r.errors.length,0);assert.ok(r.state.scrollWidth<=width,'horizontal overflow');assert.ok(r.state.text.includes(review.expected),'snapshot label mismatch: '+review.kind);
      for(const retired of ['Pemeriksaan publik terakhir','Tampil saat dicek','Tidak ditemukan saat dicek'])assert.ok(!r.state.text.includes(retired),'retired Control public observation must remain absent');
      assert.equal(r.pending.length,0,'unexpected pending requests after actual content/media readiness');
      // The UI intentionally separates the decision from bank application.
      // Assert the two fields in their decision section, not an obsolete badge.
      const decision=parse(await cli('run-code',`async(page)=>{const region=page.getByRole('region',{name:'Keputusan pemeriksaan',exact:true});return JSON.stringify({approved:await region.getByText('Disetujui',{exact:true}).count(),applied:await region.getByText('Diterapkan di bank',{exact:true}).count(),waiting:(await region.innerText()).includes('Menunggu keputusan pusat')});}`));
      assert.equal(decision.approved,1);assert.equal(decision.applied,1);assert.equal(decision.waiting,false);
      if(review.kind==='profile'){
        const media=parse(await cli('run-code',`async(page)=>{const images=page.locator('img[src*="/media/"]');return JSON.stringify({count:await images.count(),loaded:await images.evaluateAll(items=>items.every(img=>img.complete&&img.naturalWidth>0))});}`));
        assert.ok(media.count>0,'profile snapshot media required');assert.equal(media.loaded,true,'approved snapshot media must load');
      }
      checks.push({kind:review.kind,width,url:target,pass:true,screenshot:file,expected:review.expected,networkIdle:r.networkIdle,pendingRequests:r.pending});fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({pass:true,checks},null,2));
    }
    assert.deepEqual(require('./sj-browser-toolchain').resolveCliToolchain(cross.browserToolchain),toolchain,'browser toolchain changed during run');
    if(browserSelection)assert.deepEqual(resolveTestBrowserSelection(browserSelection.proofPath),browserSelection,'selected browser bytes changed during run');
    return {check:'production Control browser, real isolated login, approved snapshot media and decision/application, retired public checking absent, five CSS widths',pass:true,checks,evidence:out};
  }catch(e){
    // Never persist login command/output; other phases contain isolated display
    // data only. Retain bounded CLI diagnostics instead of hiding runner faults.
    const detail=phase!=='login'?(String(e.stdout||'').split('### Error')[1]?.split('###')[0]?.trim()||String(e.stderr||'')).replace(/postgres(?:ql)?:\/\/\S+/g,'[database]').slice(0,700):undefined;
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({pass:false,phase,checks,code:e.code||e.name,reason:e instanceof assert.AssertionError?e.message:'Browser command failed; no credentials recorded',detail},null,2));throw Error('CONTROL_BROWSER_FAILED');}
  finally{try{await cli('close');}catch{}}
};
