// Three real production UI builds. No mocked route, injected token or cookie.
// Credential fixtures and worker orchestration are confined to the owned run.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),execute=require('node:util').promisify(require('node:child_process').execFile);
const {peerRoot}=require('./sj-peer-paths'),{digest,assertContainer}=require('./sj-disposable-guard');
const {runBrowserCode}=require('./sj-browser-code-file');
const {safeHarnessError}=require('./sj-harness-error');
const {observeOwnedUiChild}=require('./sj-owned-ui-child');
const {createOwnedUiLogs}=require('./sj-owned-ui-logs');
const {createOwnedUiKey}=require('./sj-owned-ui-key');
const {installBrowserObserver,readBrowserObserver}=require('./sj-step6-browser-observer');
const {decideThroughUi}=require('./sj-step6-review-ui');
const {collectVisibleMedia}=require('./sj-step6-visible-media');
// Serialized into the existing CLI; only reads/scrolls/focuses the actual UI.
// A heading alone is not a settled image or observation proof.
async function captureBaselinePage(page,{widths,target,expected,out,label,publicDetail,bankDetail}){
  const results=[];
  const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const settled=async()=>{
    await page.evaluate(async()=>{let timer;try{await Promise.race([document.fonts.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('BaselineFontsTimeout')),15000);})]);}finally{clearTimeout(timer);}});
    await page.waitForFunction(({publicDetail,publicProfile,bankDetail})=>{
      const visible=el=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0&&b.bottom>0&&b.top<innerHeight&&b.right>0&&b.left<innerWidth;};
      const opaque=el=>{for(let node=el;node&&node!==document.documentElement;node=node.parentElement){const s=getComputedStyle(node);if(s.visibility==='hidden'||s.display==='none'||Number(s.opacity)<0.99)return false;}return true;};
      // Image readiness is sampled atomically below, using the active dialog
      // and the same two-axis/clipping predicate for waiting and recording.
      if(publicDetail){
        const headings=[...document.querySelectorAll('#asset-title')].filter(visible);if(headings.length!==1||!opaque(headings[0]))return false;
        const active=document.querySelector('.asset-gallery-slide.is-active'),hero=active?.querySelector('.public-media[data-media-state="ready"] > img');
        if(!hero||!hero.complete||!hero.naturalWidth||!opaque(hero)||hero.naturalWidth!==Number(active.getAttribute('data-pswp-width'))||hero.naturalHeight!==Number(active.getAttribute('data-pswp-height'))||hero.currentSrc!==active.href)return false;
        const scoped=[hero,hero.parentElement,active.querySelector('.asset-gallery-image-frame')];
        if(scoped.some(el=>!el||Number(getComputedStyle(el).opacity)!==1||el.getAnimations().some(animation=>['running','pending'].includes(animation.playState))))return false;
        const transform=getComputedStyle(hero).transform;if(transform!=='none'&&!new DOMMatrix(transform).isIdentity)return false;
      }
      if(publicProfile){const headings=[...document.querySelectorAll('main:not([data-loading-variant]) > header h1')].filter(visible);if(headings.length!==1||!opaque(headings[0]))return false;}
      if(bankDetail){const observation=document.querySelector('section[aria-label="Pemeriksaan ketersediaan publik"]');if(!observation||observation.getAttribute('aria-busy')!=='false')return false;}
      return ![...document.querySelectorAll('main[data-loading-variant][aria-busy="true"]')].some(visible);
    },{publicDetail,publicProfile:label==='public-profile',bankDetail},{timeout:20000});
    await frame();
  };
  const geometry=locator=>locator.evaluate(async el=>{
    const started=performance.now(),deadline=started+5000;
    const sample=()=>{
      const b=el.getBoundingClientRect(),header=document.querySelector('.site-header')?.getBoundingClientRect(),dock=document.querySelector('[data-mobile-contact]')?.getBoundingClientRect();
      const headerBottom=header?.bottom??0,dockTop=dock&&dock.height>0?dock.top:innerHeight;
      const valid=[scrollY,innerWidth,innerHeight,b.left,b.right,b.top,b.bottom,b.width,b.height,headerBottom,dockTop].every(Number.isFinite)&&b.width>0&&b.height>0;
      const hit=valid?document.elementFromPoint(b.left+b.width/2,b.top+b.height/2):null;
      return {focused:document.activeElement===el,insideViewport:valid&&b.left>=0&&b.right<=innerWidth&&b.top>=headerBottom&&b.bottom<=Math.min(innerHeight,dockTop),hit:Boolean(hit&&(hit===el||el.contains(hit))),position:{scrollY,left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height,headerBottom,dockTop}};
    };
    const before=sample();let current=before,previous=null,stable=0,samples=0;
    for(;;){
      current=sample();samples++;
      const position=JSON.stringify(current.position);
      stable=current.focused&&current.insideViewport&&current.hit?(position===previous?stable+1:1):0;
      // Native Tab scrolling follows the page's smooth-scroll policy. Three
      // exact consecutive safe positions prove convergence, not two early RAFs.
      // Never rescue focus, hide the dock, scroll by script or waive obstruction.
      if(stable>=3||!current.focused||performance.now()>=deadline)break;
      previous=position;
      let timer;
      try{await Promise.race([new Promise(resolve=>requestAnimationFrame(resolve)),new Promise(resolve=>{timer=setTimeout(resolve,Math.max(1,deadline-performance.now()));})]);}
      finally{clearTimeout(timer);}
    }
    return {focused:current.focused,insideViewport:current.insideViewport,hit:current.hit,nativeScroll:{settled:stable>=3,samples,elapsedMs:performance.now()-started,before:before.position,after:current.position}};
  });
  const headingSnapshot=()=>page.locator(publicDetail?'#asset-title':'main:not([data-loading-variant]) > header h1').evaluateAll(nodes=>({count:nodes.length,nodes:nodes.slice(0,8).map(el=>{
    const b=el.getBoundingClientRect(),s=getComputedStyle(el),hidden=el.closest('[hidden]');
    return {text:el.textContent.trim(),visible:b.width>0&&b.height>0&&s.visibility!=='hidden'&&s.display!=='none',rect:{left:b.left,top:b.top,width:b.width,height:b.height},hiddenAncestor:hidden?{tag:hidden.tagName,id:hidden.id}:null};
  })}));
  for(const width of widths){
    const errors=[],onError=e=>errors.push({name:e.name});page.on('pageerror',onError);
    try{
      await page.setViewportSize({width,height:900});await page.goto(target);
      // The profile loading route also renders a visible main/header/h1.
      // Wait for the actual route heading, never treat that loading copy as
      // a mismatched profile or silently accept an incorrect real identity.
      // Streaming may keep non-rendered segment copies in the DOM. Require a
      // unique visible heading, not an arbitrary first copy. Two visible copies
      // still fail strict mode. Retain safe DOM evidence rather than guessing.
      const heading=publicDetail?page.locator('#asset-title:visible'):label==='public-profile'?page.locator('main:not([data-loading-variant]) > header h1:visible'):page.getByText(expected,{exact:true}).first();
      const headingEvidence=publicDetail||label==='public-profile'?{before:await headingSnapshot(),after:null}:null;
      try{await heading.waitFor({timeout:30000});}
      catch(error){if(headingEvidence)throw Error('BaselineHeadingWait '+JSON.stringify({before:headingEvidence.before,after:await headingSnapshot()})+' '+error.message);throw error;}
      if(publicDetail||label==='public-profile'){if((await heading.innerText()).trim()!==expected)throw Error('BaselineRouteHeadingMismatch');}await settled();
      if(headingEvidence)headingEvidence.after=await headingSnapshot();
      const mediaProof=await collectVisibleMedia(page),media=mediaProof.media;
      const observation=bankDetail?await page.locator('section[aria-label="Pemeriksaan ketersediaan publik"]').evaluate(el=>({settled:el.getAttribute('aria-busy')==='false',loading:el.textContent.includes('Memuat hasil pengecekan…')})):null;
      const file=out+'/'+label+'-'+width+'.png';await page.screenshot({path:file,fullPage:false});
      let mobileReachability=null;
      if(publicDetail&&width<768){
        const publisher=page.locator('section[aria-labelledby="publisher-heading"] a').filter({hasText:'Lihat profil BPRS'}),footer=page.locator('footer a[href]').first();
        const nativeFocus=async locator=>{let steps=0;for(;steps<80;steps++){await page.keyboard.press('Tab');if(await locator.evaluate(el=>document.activeElement===el))break;}await frame();return {steps:steps+1,...await geometry(locator)};};
        // No scripted focus/scrollIntoView rescue: prove native sequential
        // keyboard scrolling can reach controls above the real fixed dock.
        const publisherFocus=await nativeFocus(publisher),publisherShot=out+'/'+label+'-publisher-focus-'+width+'.png';
        await page.screenshot({path:publisherShot,fullPage:false});
        const footerFocus=await nativeFocus(footer),footerShot=out+'/'+label+'-footer-focus-'+width+'.png';
        await page.screenshot({path:footerShot,fullPage:false});
        mobileReachability={publisher:publisherFocus,footer:footerFocus,screenshots:[publisherShot,footerShot]};
        await page.evaluate(()=>scrollTo(0,0));await frame();
      }
      results.push({url:page.url(),width:await page.evaluate(()=>innerWidth),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),errors,media,mediaProof,observation,mobileReachability,headingEvidence,screenshot:file});
    }finally{page.off('pageerror',onError);}
  }
  return JSON.stringify(results);
}
exports.captureBaselinePage=captureBaselinePage;
exports.run=async({proof,cross,diagnosticToken,bankOrigin,controlOrigin,publicApiOrigin,profileId,publications,slug,cycle,rpc,httpApi,upload,renewHttpActors})=>{
  assertContainer(proof,proof.pg);
  assert.equal(Boolean(cross.uiInitialProfileMode&&cross.uiFinalLifecycleMode),false,'mutually exclusive UI key modes');
  const workspace='C:/Users/falll/Documents/Codex/2026-09-13/https-seputarjaminan-ruwangarsip-com-https-seputarjaminan';
  const out=path.join(workspace,'output/playwright/three-ui-'+proof.runId+(cross.uiInitialProfileMode?'-initial-profile':cross.uiFinalLifecycleMode?'-final-lifecycle':''));fs.mkdirSync(out,{recursive:true});
  const bankUi='http://127.0.0.1:3111',publicUi='http://127.0.0.1:4411',session='three-ui-'+proof.runId.slice(0,10)+(cross.uiInitialProfileMode?'-initial':cross.uiFinalLifecycleMode?'-final':''),processes=[],checks=[],ownedUiChildren=new Map();let proxy,bankKey=null,bankKeySetupAttempted=false,phase='setup',controlTab=false,publicTab=false;
  const toolchain=require('./sj-browser-toolchain').resolveCliToolchain(cross.browserToolchain);
  const profile=require('./sj-step6-browser-profile').ownedBrowserProfile(proof,cross);
  if(profile)fs.writeFileSync(path.join(out,'owned-browser-profile.json'),JSON.stringify({runId:proof.runId,...profile},null,2),{flag:'wx'});
  const {resolveTestBrowserSelection,browserCommandArgs}=require('./sj-browser-selection');
  const browserSelection=cross.browserSelection?resolveTestBrowserSelection(cross.browserSelection.proofPath):null;
  if(browserSelection)assert.deepEqual(browserSelection,cross.browserSelection,'selected browser proof drift');
  if(browserSelection)fs.writeFileSync(path.join(out,'browser-selection.json'),JSON.stringify(browserSelection,null,2),{flag:'wx'});
  if(toolchain)fs.writeFileSync(path.join(out,'browser-toolchain.json'),JSON.stringify({runId:proof.runId,at:new Date().toISOString(),...toolchain,updateNotifierDisabled:true},null,2),{flag:'wx'});
  const browserEnv={...Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','USERPROFILE','APPDATA','LOCALAPPDATA'].includes(k.toUpperCase()))),NO_UPDATE_NOTIFIER:'1'};
  const cli=async(...args)=>{try{return(await execute(process.execPath,[toolchain.entry,'--session',session,...browserCommandArgs(args,browserSelection)],{cwd:workspace,env:browserEnv,windowsHide:true,encoding:'utf8',timeout:90000})).stdout;}catch(e){if(phase!=='bank-login'){const detail=String(e.stdout||'').split('### Error')[1]?.split('###')[0]?.trim();if(detail)fs.writeFileSync(path.join(out,'failure-locator.txt'),detail.slice(0,1500));}throw e;}};
  const parse=output=>{assert.ok(!output.includes('### Error'), 'browser command failed');const raw=output.split('### Result')[1]?.split('###')[0]?.trim();assert.ok(raw,'browser result missing');const value=JSON.parse(raw);return typeof value==='string'?JSON.parse(value):value;};
  const code=async source=>parse(await cli('run-code',source));
  async function available(port){const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',()=>reject(Error('OWNED_UI_PORT_OCCUPIED_'+port)));probe.listen(port,'127.0.0.1',resolve);});await new Promise(r=>probe.close(r));}
  async function start(kind,root,port,patch={}){
    const prefix=kind==='frontend'?'bank':'sj',repo=peerRoot(kind==='frontend'?'frontend':'central');
    assert.ok(path.resolve(root).startsWith('D:\\ra-sj-local-evidence\\'+prefix+'-ui-build-'),'unproved UI build root');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,'result.json'))).pass,true);
    for(const f of JSON.parse(fs.readFileSync(path.join(root,'source.json'))))assert.equal(digest(fs.readFileSync(path.join(repo,f.file))),f.sha256,'UI source changed after build');
    await available(port);
    const clean=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'].includes(k)));
    const diagnostic=kind==='central'&&cross.catalogCancelDiagnostic===true;
    const diagnosticEnv={};
    if(diagnostic){
      assert.equal(typeof diagnosticToken,'string','private run capability required');
      assert.equal(digest(diagnosticToken),proof.tokenHash,'diagnostic run capability mismatch');
      Object.assign(diagnosticEnv,{SJ_TEST_HTTP_STREAM_DIAGNOSTIC_ENABLE:'1',
        SJ_TEST_HTTP_STREAM_DIAGNOSTIC_PROOF:path.join(proof.root,'proof.json'),
        SJ_TEST_HTTP_STREAM_DIAGNOSTIC_PATH:path.join(proof.root,'catalog-http-stream-diagnostic.jsonl'),
        SJ_TEST_HTTP_STREAM_DIAGNOSTIC_TOKEN:diagnosticToken,SJ_TEST_HTTP_STREAM_DIAGNOSTIC_ORIGIN:publicUi});
    }
    const args=[...(diagnostic?['--require',require.resolve('./sj-performance-http-stream-diagnostic')]:[]),path.join(repo,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)];
    const runtimeEnv={...clean,...JSON.parse(fs.readFileSync(path.join(root,'runtime-env.json'))),...patch,...diagnosticEnv};
    if(kind==='frontend'){
      assert.ok(bankKey,'owned bank key must exist before frontend launch');
      assert.equal(runtimeEnv.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY_FILE,bankKey.receipt.path,'only this invocation key is allowed');
      assert.ok(!runtimeEnv.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,'direct key must not shadow file-backed key');
    }
    const secrets=[cross.browserBankPassword,cross.browserPassword,cross.bootstrapPassword,
      cross.controlEncryptionKey,...Object.entries(runtimeEnv).filter(([key])=>/PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL|REDIS_URL/.test(key)).map(([,value])=>value)];
    if(kind==='frontend')secrets.push(bankKey.logSecret);
    const logs=createOwnedUiLogs({directory:out,label:kind==='central'?'public-ui':'bank-ui',secrets});
    let child;
    try{if(kind==='frontend')bankKey.markSpawnInvoked();child=spawn(process.execPath,args,{cwd:path.join(root,'app'),env:runtimeEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});}
    catch(error){logs.close();throw error;}
    const observer=observeOwnedUiChild(child,{onStdout:logs.stdout,onStderr:logs.stderr});
    processes.push(child);ownedUiChildren.set(child,{observer,logs});
    if(kind==='frontend')bankKey.bindChild(child,observer);
    for(let i=0;i<100;i++){assert.equal(child.exitCode,null,'UI process exited');try{const status=await new Promise((resolve,reject)=>{const request=http.get('http://127.0.0.1:'+port,response=>{response.resume();resolve(response.statusCode);});request.setTimeout(3000,()=>request.destroy());request.on('error',reject);});if(status===200)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw Error('UI_NOT_READY_'+port);
  }
  async function inspect(label,target,expected){
    if(target.startsWith(publicUi)){if(!publicTab){await cli('tab-new',target);publicTab=true;}else await cli('tab-select','2');}
    else await cli('tab-select','0');
    await cli('snapshot'); // Observe the current UI before the next interaction.
    const widths=[360,390,768,1024,1440];
    // One persistent browser command per surface avoids repeatedly bootstrapping
    // the Windows CLI. Every viewport still navigates, waits for real content,
    // records page errors/overflow and writes its own settled screenshot.
    const inspectSource=`async(page)=>{const collectVisibleMedia=${collectVisibleMedia.toString()};const inspect=${captureBaselinePage.toString()};return await inspect(page,${JSON.stringify({widths,target,expected,out:out.replaceAll('\\','/'),label,publicDetail:label.startsWith('public-publication-'),bankDetail:label.startsWith('bank-publication-')})});}`;
    const inspected=parse(await runBrowserCode({out,source:inspectSource,execute:filename=>cli('run-code','--filename='+filename)}));
    fs.writeFileSync(path.join(out,label+'-baseline.json'),JSON.stringify({runId:proof.runId,label,results:inspected},null,2),{flag:'wx'});
    assert.equal(inspected.length,widths.length);
    for(const [index,result] of inspected.entries()){
      const width=widths[index],file=path.join(out,label+'-'+width+'.png').replaceAll('\\','/');
      assert.equal(result.url,target);assert.equal(result.width,width);assert.equal(result.overflow,false);assert.deepEqual(result.errors,[]);assert.equal(result.screenshot,file);
      assert.ok(result.media.every(image=>image.loaded),'visible baseline image not loaded');
      assert.equal(result.mediaProof.settled,true);assert.ok(result.mediaProof.stableFrames>=3);assert.deepEqual(result.mediaProof.pending,[]);
      if(label.startsWith('bank-publication-'))assert.equal(result.mediaProof.scope.kind,'dialog','bank detail must be the actual active modal');
      if(result.observation)assert.deepEqual(result.observation,{settled:true,loading:false});
      if(result.headingEvidence)assert.deepEqual(result.headingEvidence.after.nodes.filter(node=>node.visible).map(node=>node.text),[expected],'one exact visible asset heading required');
      if(result.mobileReachability)for(const item of [result.mobileReachability.publisher,result.mobileReachability.footer])assert.ok(item.focused&&item.insideViewport&&item.hit&&item.steps<=80&&item.nativeScroll.settled,'mobile dock obstructs native keyboard target');
      checks.push({label,url:result.url,width,screenshot:file,media:result.media,observation:result.observation,mobileReachability:result.mobileReachability,pass:true});
    }
  }
  async function approve(kind,sourceId,decision='approve',note){
    await cycle();const prepared=await rpc('prepare-review',{kind,sourceId});
    if(!controlTab){
      await cli('tab-new',controlOrigin+'/login');controlTab=true;
      await code(`async(page)=>{await page.goto(${JSON.stringify(controlOrigin+'/login')});await page.getByRole('textbox',{name:'Username',exact:true}).fill(${JSON.stringify('reviewer-'+proof.runId)});await page.getByRole('textbox',{name:'Password Tampilkan password',exact:true}).fill(${JSON.stringify(cross.browserPassword)});await page.getByRole('button',{name:'Masuk',exact:true}).click();await page.waitForURL(${JSON.stringify(controlOrigin+'/')});return JSON.stringify({authenticated:true});}`);
    }else await cli('tab-select','1');
    // Reuse the session established through the real login form, but verify its
    // actual account before every decision. /login correctly redirects an active
    // operator to the dashboard; it is not a form to fill repeatedly.
    const current=await code(`async(page)=>{const response=await page.request.get(${JSON.stringify(controlOrigin+'/api/auth/session')});if(!response.ok())throw Error('Control session not valid');const body=await response.json();return JSON.stringify({username:body.data.operator.username});}`);
    assert.equal(current.username,'reviewer-'+proof.runId,'actual reviewer session must match the owned account');
    await cli('goto',controlOrigin+'/reviews/'+prepared.reviewId);await cli('snapshot');
    const label=decision==='approve'?'Setujui':'Minta revisi';
    const decisionNote=note??(decision==='request_revision'?'Perjelas nama kontak sebelum disetujui.':kind==='change_request'?'Dampak lifecycle fixture UI telah diperiksa.':null);
    assert.match(prepared.instanceId,/^[a-f0-9-]{36}$/i);
    const result=await code(`async(page)=>JSON.stringify(await (${decideThroughUi.toString()})(page,${JSON.stringify({label,note:decisionNote,decisionPath:'/api/instances/'+prepared.instanceId+'/reviews/'+prepared.reviewId+'/decisions',unknownScreenshot:path.join(out,'decision-unknown-'+prepared.reviewId+'.png').replaceAll('\\','/')})}))`);
    fs.writeFileSync(path.join(out,'decision-'+prepared.reviewId+'.json'),JSON.stringify({runId:proof.runId,kind,sourceId,requestedDecision:decision,...result},null,2),{flag:'wx'});
    assert.equal(result.applied,true,'Authentic bank APPLIED required: '+JSON.stringify(result));await cycle();
    checks.push({label:'browser-decision-'+kind+'-'+decision,url:controlOrigin+'/reviews/'+prepared.reviewId,pass:true});await cli('tab-select','0');
    return {...result,commandId:result.decision.commandId,reviewId:prepared.reviewId};
  }
  try{
    await available(7111);
    proxy=http.createServer((req,res)=>{const upstream=http.request(bankOrigin+req.url,{method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);});await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(7111,'127.0.0.1',resolve);});
    bankKeySetupAttempted=true;
    bankKey=createOwnedUiKey(proof,cross.uiInitialProfileMode?'initial':cross.uiFinalLifecycleMode?'final':'main');
    await start('frontend',cross.bankUiRoot,3111,bankKey.envPatch);await start('central',cross.publicUiRoot,4411,{SJ_PUBLIC_API_BASE_URL:publicApiOrigin,SJ_ALLOW_LOOPBACK_API:'true'});
    phase='bank-login';await cli('open',bankUi,...(profile?[profile.openArgument]:[]));const observed=await cli('snapshot');assert.ok(!observed.includes('### Error'));
    await code(`async(page)=>JSON.stringify(await (${installBrowserObserver.toString()})(page))`);
    if(toolchain){
      const engine=await code('async(page)=>{const browser=page.context().browser();if(!browser)throw Error("BrowserVersionUnavailable");return JSON.stringify({version:browser.version()});}');
      assert.match(engine.version,/^\d+(?:\.\d+){1,3}$/);
      if(browserSelection)assert.equal(engine.version,browserSelection.version,'actual browser does not match explicit proof');
      fs.writeFileSync(path.join(out,'browser-engine.json'),JSON.stringify({runId:proof.runId,at:new Date().toISOString(),...engine},null,2),{flag:'wx'});
    }
    await code(`async(page)=>{await page.locator('input[name="username"],#username').first().fill(${JSON.stringify(cross.browserBankUsername)});await page.locator('input[type="password"]').first().fill(${JSON.stringify(cross.browserBankPassword)});await page.getByRole('button',{name:'Masuk',exact:true}).click();await page.waitForURL(/\\/dashboard/);return JSON.stringify({authenticated:true});}`);
    if(cross.uiInitialProfileMode){
      phase='initial-profile-create-ui';
      const initial=await require('./sj-step6-initial-profile-ui').run({proof,out,cli,code,bankUi,publicUi,slug,httpApi,cycle,approve,inspect});
      const browserEvents=await code(`async(page)=>JSON.stringify(await (${readBrowserObserver.toString()})(page))`);
      fs.writeFileSync(path.join(out,'browser-events.json'),JSON.stringify(browserEvents,null,2),{flag:'wx'});
      assert.equal(browserEvents.overflow,false);
      assert.equal(browserEvents.events.some(event=>event.type==='pageerror'||event.type==='http'&&event.status>=500),false,'initial profile UI unexpected application error/5xx');
      const result={check:'initial singleton profile created, saved, submitted, approved via real UIs and public website readback',pass:true,...initial,evidence:out};
      fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2),{flag:'wx'});return result;
    }
    if(cross.uiFinalLifecycleMode){
      phase='final-profile-hide-and-logout';
      const final=await require('./sj-step6-ui-journey').finalProfileHide({proof,cross,out,cli,code,bankUi,publicUi,controlOrigin,httpApi,cycle,approve,slug});
      const browserEvents=await code(`async(page)=>JSON.stringify(await (${readBrowserObserver.toString()})(page))`);
      fs.writeFileSync(path.join(out,'browser-events.json'),JSON.stringify(browserEvents,null,2),{flag:'wx'});
      assert.equal(browserEvents.overflow,false);
      assert.equal(browserEvents.events.some(event=>event.type==='pageerror'||event.type==='http'&&event.status>=500),false,'final UI unexpected application error/5xx');
      fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(final,null,2),{flag:'wx'});return final;
    }
    phase='bank-profile-form';await cli('snapshot');
    await code(`async(page)=>{await page.setViewportSize({width:1440,height:900});const profile=page.locator('a[href="/dashboard/seputar-jaminan/profil"]').first();if(!await profile.isVisible()){await page.getByRole('button',{name:'Seputar Jaminan',exact:true}).click();}await profile.click({timeout:30000});await page.getByRole('button',{name:'Ajukan perubahan',exact:true}).waitFor({timeout:30000});return JSON.stringify({profileLoaded:true});}`);await cli('snapshot');
    const profileName='BPRS Browser Terverifikasi';
    await code(`async(page)=>{await page.getByRole('button',{name:'Ajukan perubahan',exact:true}).click();await page.locator('#sj-profile-name').fill(${JSON.stringify(profileName)});await page.getByRole('button',{name:'Simpan dan ajukan',exact:true}).click();await page.getByText('Profil disimpan dan diajukan untuk diperiksa.',{exact:true}).waitFor();return JSON.stringify({submitted:true});}`);
    phase='profile-control-decision';await approve('profile',profileId);
    phase='public-profile';
    const profileResponse=await fetch(publicApiOrigin+'/v1/public/institutions/'+encodeURIComponent(slug));
    const publicProfile=await profileResponse.json();
    fs.writeFileSync(path.join(out,'public-profile-api.json'),JSON.stringify({status:profileResponse.status,body:publicProfile},null,2));
    assert.equal(profileResponse.status,200);assert.equal(publicProfile.public_name,profileName);
    // Keep the bank worker's fetch egress guard confined to the real SJ API.
    // This diagnostic, like the readiness probe above, only reads our live
    // child website at the fixed loopback URL; no redirects or arbitrary URL.
    assert.ok(processes[1]&&processes[1].exitCode===null,'owned public UI must be alive');
    const websiteResponse=await new Promise((resolve,reject)=>{
      const req=http.get(publicUi+'/api/public/institutions',response=>{let bytes=0;const chunks=[];response.on('data',chunk=>{bytes+=chunk.length;if(bytes>1024*1024)response.destroy(Error('PUBLIC_UI_RESPONSE_TOO_LARGE'));else chunks.push(chunk);});response.on('error',reject);response.on('end',()=>resolve({status:response.statusCode,contentType:response.headers['content-type'],text:Buffer.concat(chunks).toString('utf8')}));});
      req.setTimeout(8000,()=>req.destroy(Error('PUBLIC_UI_TIMEOUT')));req.on('error',reject);
    });
    const websiteText=websiteResponse.text;
    let websiteBody;try{websiteBody=JSON.parse(websiteText);}catch{websiteBody={nonJson:true,contentType:websiteResponse.contentType,bytes:Buffer.byteLength(websiteText)};}
    fs.writeFileSync(path.join(out,'public-website-api.json'),JSON.stringify({status:websiteResponse.status,body:websiteBody},null,2));
    assert.equal(websiteResponse.status,200,'real website public API adapter must accept the actual SJ response');
    await inspect('public-profile',publicUi+'/bprs/'+slug,profileName);
    phase='bank-contact-draft';await cli('tab-select','0');await cli('goto',bankUi+'/dashboard/seputar-jaminan/kontak');await cli('snapshot');
    const contactLabel='Kontak browser '+proof.runId.slice(0,8);
    const saved=await code(`async(page)=>{await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'Tambah kontak',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.locator('#sj-contact-label').fill(${JSON.stringify(contactLabel)});await dialog.locator('#sj-contact-phone').fill('+6281234567802');const receipt=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.includes('/contacts/save-operations/'));await dialog.getByRole('button',{name:'Simpan draf',exact:true}).click();const response=await receipt;if(!response.ok())throw Error('Draft save rejected');const body=await response.json();await page.getByText('Draf kontak berhasil disimpan.',{exact:true}).waitFor();return JSON.stringify({id:body.data.resource_id,state:body.data.state});}`);
    assert.equal(saved.state,'DRAFT');assert.match(saved.id,/^[a-f0-9-]{36}$/);
    assert.equal((await httpApi('maker','get','/contacts/'+saved.id)).state,'DRAFT');
    await cli('snapshot');
    await code(`async(page)=>{await page.getByRole('button',{name:${JSON.stringify('Aksi kontak '+contactLabel)},exact:true}).click();await page.getByRole('menuitem',{name:'Ajukan',exact:true}).click();await page.getByText('Kontak diajukan untuk diperiksa.',{exact:true}).waitFor();return JSON.stringify({submitted:true});}`);
    phase='contact-browser-revision';await approve('contact',saved.id,'request_revision');
    await cli('goto',bankUi+'/dashboard/seputar-jaminan/kontak');await cli('snapshot');
    const revisedLabel='Kontak browser diperbaiki '+proof.runId.slice(0,8);
    await code(`async(page)=>{await page.getByRole('button',{name:${JSON.stringify('Aksi kontak '+contactLabel)},exact:true}).click();await page.getByRole('menuitem',{name:'Perbaiki kontak',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByText('Perjelas nama kontak sebelum disetujui.',{exact:true}).waitFor();await dialog.locator('#sj-contact-label').fill(${JSON.stringify(revisedLabel)});await dialog.getByRole('button',{name:'Simpan dan ajukan ulang',exact:true}).click();await page.getByText('Kontak disimpan dan diajukan untuk diperiksa.',{exact:true}).waitFor();return JSON.stringify({resubmitted:true});}`);
    await approve('contact',saved.id);await cli('goto',bankUi+'/dashboard/seputar-jaminan/kontak');
    assert.equal((await httpApi('maker','get','/contacts/'+saved.id)).state,'VERIFIED');
    await inspect('bank-contact',bankUi+'/dashboard/seputar-jaminan/kontak',revisedLabel);
    checks.push({label:'browser-contact-new-draft-submit-revision-resubmit-approve',resourceId:saved.id,pass:true});
    for(const publication of publications){
    phase='stale-profile-rollback';
    // A historical profile remains in the immutable snapshot after the profile
    // UI journey above. A stale submit must be a 409 with a fully rolled-back
    // operation, not an unmapped database500 or a substituted public snapshot.
    const before=await httpApi('maker','get','/publications/'+publication.id);
    const currentProfile=await httpApi('maker','get','/profile');
    assert.notEqual(before.current_version.profile_version_id,currentProfile.current_version_id);
    const staleOperation=crypto.randomUUID();
    await httpApi('maker','post','/publications/save-operations/'+staleOperation,{intent:'SAVE_AND_SUBMIT',resource_id:publication.id,draft:{expected_version:before.lock_version,title:before.current_version.title,profile_version_id:before.current_version.profile_version_id}},409);
    assert.deepEqual(await httpApi('maker','get','/save-operations/'+staleOperation),{status:'NOT_RECORDED',receipt:null});
    const unchanged=await httpApi('maker','get','/publications/'+publication.id);
    assert.equal(unchanged.lock_version,before.lock_version);assert.deepEqual(unchanged.current_version,before.current_version);assert.deepEqual(unchanged.published_version,before.published_version);
    checks.push({label:'stale-profile-atomic-rollback-'+publication.asset_category,pass:true});
    phase='bank-publication-form';await cli('tab-select','0');await cli('snapshot');
    // Mobile inspection closes the bank sidebar by design. Returning to a
    // desktop viewport does not silently change that persisted preference.
    // Open the actual navigation controls, rather than assuming a mounted link.
    await code(`async(page)=>{await page.setViewportSize({width:1440,height:900});const link=page.locator('a[href="/dashboard/seputar-jaminan/publikasi"]').first();if(!await link.isVisible()){const opener=page.getByRole('button',{name:'Buka sidebar',exact:true});if(await opener.isVisible())await opener.click();const section=page.getByRole('button',{name:'Seputar Jaminan',exact:true});await section.waitFor({timeout:30000});if(await section.getAttribute('aria-expanded')!=='true')await section.click();}await link.click({timeout:30000});await page.waitForURL(${JSON.stringify(bankUi+'/dashboard/seputar-jaminan/publikasi')});const row=page.getByRole('button',{name:${JSON.stringify('Aksi publikasi '+publication.reference_code)},exact:true});await row.click({timeout:30000});await page.getByRole('menuitem',{name:'Lihat detail',exact:true}).click();await page.getByRole('button',{name:'Ajukan perubahan',exact:true}).waitFor({timeout:30000});return JSON.stringify({detailLoaded:true});}`);await cli('snapshot');
    const title='Aset '+publication.asset_category+' terverifikasi melalui browser';
    const savedPublication=await code(`async(page)=>{await page.getByRole('button',{name:'Ajukan perubahan',exact:true}).click();await page.locator('#sj-publication-title').fill(${JSON.stringify(title)});const pending=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.includes('/publications/save-operations/'));const notified=page.getByText('Publikasi disimpan dan diajukan untuk diperiksa.',{exact:true}).waitFor({timeout:30000});await page.getByRole('button',{name:'Simpan dan ajukan',exact:true}).click();const response=await pending;const body=await response.json();const data=body.data;await notified;return JSON.stringify({status:response.status(),success:body.success===true,receipt:data&&{operation_id:data.operation_id,kind:data.kind,intent:data.intent,resource_id:data.resource_id,lock_version:data.lock_version,state:data.state,completed_at:data.completed_at,submission_error:data.submission_error},keys:data?Object.keys(data):[]});}`);
    fs.writeFileSync(path.join(out,'publication-save-'+publication.asset_category+'.json'),JSON.stringify(savedPublication,null,2));
    assert.equal(savedPublication.status,200,'real publication save API must succeed');assert.equal(savedPublication.receipt?.state,'IN_REVIEW');
    phase='publication-control-decision';await approve('publication',publication.id);
    const latest=await httpApi('maker','get','/publications/'+publication.id);assert.equal(latest.published_version.title,title);
    phase='public-publication';await inspect('public-publication-'+publication.asset_category,publicUi+'/aset/'+latest.reference_code,title);
    phase='bank-readback';await inspect('bank-publication-'+publication.asset_category,bankUi+'/dashboard/seputar-jaminan/publikasi?detail='+publication.id,title);
    // Finish the current modal workflow before using the background navigation.
    // An open accessible dialog intentionally makes the sidebar unavailable.
    // Use the same explicit return action as a user, not a forced/background click.
    await cli('snapshot');
    await code(`async(page)=>{const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Kembali ke daftar',exact:true}).click();await dialog.waitFor({state:'hidden'});if(new URL(page.url()).searchParams.has('detail'))throw Error('Detail context still open');return JSON.stringify({returned:true});}`);
    checks.push({label:'bank-publication-return-'+publication.asset_category,pass:true});
    }
    if(cross.uiStep6){
      phase='step6-extended-ui';
      checks.push({label:'owned-api-renewal-before-step6-ui',pass:true,...await renewHttpActors('before-step6-ui-extension')});
      checks.push(await require('./sj-step6-ui-journey').run({proof,cross,out,cli,code,bankUi,publicUi,controlOrigin,httpApi,cycle,rpc,upload,approve,inspect,publications,profileName}));
      phase='step6-main-inspection';
      checks.push(await require('./sj-step6-inspection-hold').waitForMain({proof,out,session,bankUi,publicUi,controlOrigin}));
      // Renew only the owned API fixtures after the deliberately long UI pass.
      // Browser sessions keep the real application's refresh/login behavior.
      checks.push({label:'owned-api-renewal-after-step6-ui',pass:true,...await renewHttpActors('after-step6-main-inspection')});
    }
    if(cross.performance){
      phase='production-performance';
      assert.equal(typeof renewHttpActors,'function','owned API fixture renewal is required before the long measurement phase');
      checks.push({label:'explicit-owned-api-fixture-renewal',pass:true,...await renewHttpActors()});
      // Long credential-free diagnostics use the CLI's official file input.
      // Login remains inline; do not persist authentication code or credentials.
      const performanceCode=async source=>parse(await runBrowserCode({out,source,execute:filename=>cli('run-code','--filename='+filename)}));
      checks.push(await require('./sj-production-performance').run({proof,cross,out,cli,code:performanceCode,bankUi,publicUi,controlOrigin,publicApiOrigin,publications,profileName,rpc,httpApi,cycle,upload,renewHttpActors}));
    }
    const browserEvents=await code(`async(page)=>JSON.stringify(await (${readBrowserObserver.toString()})(page))`);
    fs.writeFileSync(path.join(out,'browser-events.json'),JSON.stringify(browserEvents,null,2),{flag:'wx'});
    assert.equal(browserEvents.overflow,false,'browser evidence event bound exceeded');
    assert.equal(browserEvents.events.some(event=>event.type==='pageerror'||event.type==='http'&&event.status>=500),false,'unexpected application error/5xx requires diagnosis');
    if(toolchain)assert.deepEqual(require('./sj-browser-toolchain').resolveCliToolchain(cross.browserToolchain),toolchain,'browser toolchain changed during run');
    if(browserSelection)assert.deepEqual(resolveTestBrowserSelection(browserSelection.proofPath),browserSelection,'selected browser bytes changed during run');
    const result={check:'real three-UI E2E: bank UI login/draft/submit/revision, Control UI login/decisions, actual worker delivery/scanner, public SJ UI/readback',pass:true,coverage:cross.uiStep6?'Profile update, contact draft/revision/resubmit, four category updates, plus nested Step6 new contact/four category creation and lifecycle through real UIs; service prerequisites and service-only negatives remain separately labelled. Main visual/zoom/interaction report is separate.':'Profile update, new contact draft/revision/resubmit, and four publication category updates; initial category creation and lifecycle separately tested through real APIs',checks,evidence:out};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));return result;
  }catch(e){
    try{const events=await code(`async(page)=>JSON.stringify(await (${readBrowserObserver.toString()})(page))`);fs.writeFileSync(path.join(out,'browser-events-failed.json'),JSON.stringify(events,null,2),{flag:'wx'});}catch{}
    if(phase!=='bank-login'){try{await cli('screenshot','--filename='+path.join(out,'failure.png'));}catch{}try{await cli('snapshot');}catch{}}
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({pass:false,phase,checks,failure:safeHarnessError(e),reason:'Three UI scenario failed; see safe diagnostic, no credentials recorded'},null,2));throw Error('THREE_UI_FAILED_'+phase);}
  finally{
    const cleanupErrors=[],closed=[];let bankKeyCleanup=null;
    try{await cli('close');}catch{cleanupErrors.push('BROWSER_SESSION_CLOSE_FAILED');}
    for(const child of processes){const owned=ownedUiChildren.get(child);let receipt;
      try{receipt=await owned.observer.stop();}catch(error){cleanupErrors.push(error.code||'UI_CHILD_CLEANUP_FAILED');receipt=error.receipt;}
      if(owned.observer.closed){try{closed.push({process:receipt??owned.observer.receipt,logs:owned.logs.close()});}catch{cleanupErrors.push('UI_LOG_FINALIZATION_FAILED');}}
    }
    if(proxy){proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}
    if(bankKey){try{bankKeyCleanup=bankKey.cleanup();}catch(error){cleanupErrors.push(error.code||'UI_KEY_CLEANUP_FAILED');}}
    if(bankKeySetupAttempted&&!bankKey)cleanupErrors.push('UI_KEY_SETUP_UNCONFIRMED_RETAIN_RESOURCES');
    fs.writeFileSync(path.join(out,'ui-cleanup.json'),JSON.stringify({runId:proof.runId,pass:cleanupErrors.length===0,closed,bankKey:bankKeyCleanup,errors:cleanupErrors},null,2),{flag:'wx'});
    if(cleanupErrors.length){const error=Error('THREE_UI_CLEANUP_UNCONFIRMED_RETAIN_RESOURCES');error.code='UI_CHILD_CLOSE_UNCONFIRMED';throw error;}
  }
};
