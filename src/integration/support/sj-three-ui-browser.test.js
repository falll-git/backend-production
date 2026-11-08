const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { captureBaselinePage } = require('./sj-three-ui-browser');
const { collectVisibleMedia } = require('./sj-step6-visible-media');

const widths = [360, 390, 768, 1024, 1440];
const options = (changes = {}) => ({
  widths, target: 'http://127.0.0.1:4411/assets/test-owned',
  expected: 'Owned fixture', out: 'C:/owned-test-evidence',
  label: 'bank-contact', publicDetail: false, bankDetail: false, ...changes,
});

// Pure harness double: no browser, API, service, filesystem screenshot or DOM
// renderer is started. The exact serialized callbacks execute against this
// deliberately small DOM; their assertions do not prove real viewport/focus UX.
function fakePage(settings = {}) {
  const events = new EventEmitter();
  const state = { width: 0, url: '', focused: null, screenshots: [], trace: [], waits: [], selectors: [], timers: 0, cleared: 0, frameMs: 0, focusStarted: 0 };
  const rect = (top = 200) => ({ left: 16, right: state.width - 16, top, bottom: top + 24, width: state.width - 32, height: 24 });
  const element = (top = 200) => ({
    parentElement: null,
    style: { visibility: 'visible', display: 'block', opacity: '1', transform: 'none' },
    getBoundingClientRect: () => rect(top),
    getAnimations: () => [],
    getAttribute: () => null,
    contains: () => false,
  });
  const wrapper = element(), frame = element(), active = element();
  const hero = { ...element(), parentElement: wrapper, complete: settings.imageUnready !== true,
    naturalWidth: 1920, naturalHeight: 1080, currentSrc: 'http://127.0.0.1:4411/media/owned' };
  if (settings.heroOpacity) hero.style.opacity = settings.heroOpacity;
  if (settings.heroTransform) hero.style.transform = settings.heroTransform;
  if (settings.heroAnimating) hero.getAnimations = () => [{ playState: 'running' }];
  active.href = settings.heroHref || hero.currentSrc;
  active.getAttribute = (name) => name === 'data-pswp-width' ? String(settings.heroWidth || 1920) : '1080';
  active.querySelector = (selector) => selector === '.asset-gallery-image-frame' ? frame : hero;
  const observation = { ...element(), textContent: settings.observationLoading ? 'Memuat hasil pengecekan…' : 'Tampil saat dicek',
    getAttribute: () => settings.observationBusy ? 'true' : 'false' };
  const publisher = element(), footer = element(), dock = element();
  const assetHeading={...element(100),textContent:'Owned fixture',closest:()=>null};
  if(settings.headingOpacity)assetHeading.style.opacity=settings.headingOpacity;
  const stagedHeading={...element(),textContent:'Owned fixture',getBoundingClientRect:()=>({left:0,right:0,top:0,bottom:0,width:0,height:0}),closest:()=>({tagName:'DIV',id:'S:owned'})};
  const scrollPending = () => settings.nativeScrollFrames && state.frameMs - state.focusStarted < settings.nativeScrollFrames * 16;
  const focusRect = (node, safeTop, initialTop) => {
    const result=rect(state.focused === node && !scrollPending() ? safeTop : initialTop);
    if(settings.zeroFocusGeometry)result.width=0;
    if(settings.invalidFocusGeometry)result.top=NaN;
    return result;
  };
  publisher.getBoundingClientRect = () => focusRect(publisher,220,920);
  footer.getBoundingClientRect = () => focusRect(footer,760,1060);
  dock.getBoundingClientRect = () => ({ left: 0, right: state.width, top: 820, bottom: 900, width: state.width, height: 80 });
  const document = {
    get activeElement() { return settings.focusLostFrames&&state.frameMs-state.focusStarted>=settings.focusLostFrames*16?null:state.focused; },
    get fonts() { return { ready: settings.fontsReject ? Promise.reject(Error('FakeFontsRejected')) : Promise.resolve() }; },
    documentElement: { get scrollWidth() { return state.width + (settings.reportWidthOffset || 0) + (settings.overflow ? 1 : 0); } },
    querySelectorAll: (selector) => selector === 'img' ? [hero] : selector==='#asset-title'?(settings.assetHeadingMissing?[]:[assetHeading,...(settings.stagedHeadingCopy?[stagedHeading]:[]),...(settings.visibleHeadingCopy?[assetHeading]:[])]) : selector==='main:not([data-loading-variant]) > header h1'?(settings.realHeadingMissing?[]:[assetHeading,...(settings.stagedHeadingCopy?[stagedHeading]:[]),...(settings.visibleHeadingCopy?[assetHeading]:[])]) : selector.startsWith('main[') && settings.mainBusy ? [element()] : [],
    querySelector: (selector) => selector === '.asset-gallery-slide.is-active' ? active
      : selector === 'section[aria-label="Pemeriksaan ketersediaan publik"]' ? (settings.observationMissing ? null : observation)
        : selector === '.site-header' ? { getBoundingClientRect: () => ({ bottom: 80 }) }
          : selector === '[data-mobile-contact]' ? dock : null,
    elementFromPoint: () => settings.hitBlocked ? dock : state.focused || hero,
  };
  const context = vm.createContext({ document,
    getComputedStyle: (node) => node.style,
    DOMMatrix: class { constructor() { this.isIdentity = false; } },
    performance: { now: () => state.frameMs }, scrollY: 0,
    requestAnimationFrame: (callback) => { state.frameMs += 16; state.trace.push('frame'); callback(state.frameMs); },
    setTimeout: () => { state.timers += 1; return state.timers; },
    clearTimeout: () => { state.cleared += 1; },
    scrollTo: () => { state.trace.push('scroll-to-top'); },
  });
  Object.defineProperties(context, {
    innerWidth: { get: () => state.width + (settings.reportWidthOffset || 0) },
    innerHeight: { get: () => 900 },
  });
  const evaluate = async (callback, value) => new vm.Script('(' + callback.toString() + ')').runInContext(context)(value);
  const locator = (node, selector) => ({
    first() { return this; }, filter() { return this; },
    async waitFor(input) {
      assert.equal(input.timeout, 30000);
      if(selector==='#asset-title'&&settings.stagedHeadingCopy)throw Error('FakeHiddenHeadingStrictViolation');
      if(selector==='#asset-title:visible'&&settings.visibleHeadingCopy)throw Error('FakeVisibleHeadingStrictViolation');
      if(selector==='#asset-title:visible'&&settings.assetHeadingMissing)throw Error('FakeAssetHeadingDeadline');
      if (selector === 'main:not([data-loading-variant]) > header h1' && settings.stagedHeadingCopy) throw Error('FakeHiddenProfileHeadingStrictViolation');
      if (selector === 'main:not([data-loading-variant]) > header h1:visible') {
        if(settings.visibleHeadingCopy)throw Error('FakeVisibleProfileHeadingStrictViolation');
        if (settings.realHeadingMissing) throw Error('FakeRealHeadingDeadline');
        if (settings.realHeadingDelayed) state.trace.push('wait-real-heading');
      }
      state.trace.push('heading-ready');
    },
    async innerText() {
      if (selector === 'main header h1' && settings.loadingHeadingPresent) return 'Memuat profil BPRS';
      return settings.headingMismatch ? 'Wrong route' : 'Owned fixture';
    },
    evaluate: async (callback) => evaluate(callback, node),
    evaluateAll: async(callback)=>evaluate(callback,(selector?.startsWith('main:')?settings.realHeadingMissing:settings.assetHeadingMissing)?[]:[assetHeading,...(settings.stagedHeadingCopy?[stagedHeading]:[]),...(settings.visibleHeadingCopy?[assetHeading]:[])]),
  });
  const page = {
    on: (...args) => events.on(...args), off: (...args) => events.off(...args),
    async setViewportSize(size) { assert.equal(size.height, 900); state.width = size.width; state.trace.push('viewport:' + size.width); },
    async goto(url) { state.url = url; state.focused = null; state.trace.push('goto'); if (settings.pageError) events.emit('pageerror', { name: 'FakePageError' }); },
    url: () => state.url,
    locator: (selector) => {
      state.selectors.push(selector);
      return locator(selector.includes('publisher-heading') ? publisher : selector === 'footer a[href]' ? footer
        : selector.startsWith('section[aria-label=') ? observation : null, selector);
    },
    getByText: () => locator(null), evaluate,
    async waitForFunction(callback, value, input) {
      assert.equal(input.timeout, 20000); state.waits.push(value); state.trace.push('settle-predicate');
      if (!await evaluate(callback, value)) throw Error('FakeBaselineSettleDeadline');
    },
    keyboard: { async press(key) {
      assert.equal(key, 'Tab'); state.trace.push('Tab');
      state.focused = settings.focusStuck ? null : state.focused === publisher ? footer : publisher;
      state.focusStarted = state.frameMs;
    } },
    async screenshot(input) { if (settings.screenshotReject) throw Error('FakeScreenshotRejected'); state.trace.push('screenshot'); state.screenshots.push(JSON.parse(JSON.stringify(input))); },
  };
  return { page, state, events };
}

function serializedCapture() {
  return new vm.Script('(()=>{const collectVisibleMedia='+collectVisibleMedia.toString()+';return (' + captureBaselinePage.toString() + ');})()').runInNewContext();
}

test('exact serialized baseline function and generated wrapper compile without executing their bodies', () => {
  const context = vm.createContext();
  Object.defineProperty(context, 'page', { get() { throw Error('Body must not execute during compilation'); } });
  const source = captureBaselinePage.toString();
  assert.equal(typeof new vm.Script('(' + source + ')').runInContext(context), 'function');
  const wrapper = `async(page)=>{const inspect=${source};return await inspect(page,${JSON.stringify(options())});}`;
  assert.equal(typeof new vm.Script('(' + wrapper + ')').runInContext(context), 'function');
});

test('pure serialized capture records all five actual CSS widths and settled screenshot metadata', async () => {
  const fake = fakePage();
  const result = JSON.parse(await serializedCapture()(fake.page, options()));
  assert.deepEqual(result.map((row) => row.width), widths);
  assert.deepEqual(result.map((row) => row.url), Array(5).fill(options().target));
  assert.ok(result.every((row) => !row.overflow && row.errors.length === 0 && row.observation === null));
  assert.ok(result.every((row) => row.media.length === 1 && row.media[0].loaded && row.media[0].width === 1920 && row.media[0].height === 1080));
  assert.deepEqual(fake.state.screenshots, widths.map((width) => ({ path: options().out + '/bank-contact-' + width + '.png', fullPage: false })));
  assert.ok(fake.state.timers >= 5); assert.equal(fake.state.cleared, fake.state.timers);
  assert.equal(fake.events.listenerCount('pageerror'), 0);
});

test('font readiness rejection prevents screenshot and always removes the pageerror listener', async () => {
  const fake = fakePage({ fontsReject: true });
  await assert.rejects(serializedCapture()(fake.page, options()), /FakeFontsRejected/);
  assert.deepEqual(fake.state.screenshots, []); assert.equal(fake.state.cleared, 1);
  assert.equal(fake.events.listenerCount('pageerror'), 0);
});

test('visible unready media cannot produce a settled screenshot or a PASS-shaped record', async () => {
  const fake = fakePage({ imageUnready: true });
  await assert.rejects(serializedCapture()(fake.page, options()), /VISIBLE_MEDIA_TIMEOUT/);
  assert.deepEqual(fake.state.screenshots, []); assert.equal(fake.events.listenerCount('pageerror'), 0);
});

test('visible busy main content cannot produce a settled screenshot', async () => {
  const fake = fakePage({ mainBusy: true });
  await assert.rejects(serializedCapture()(fake.page, options()), /FakeBaselineSettleDeadline/);
  assert.deepEqual(fake.state.screenshots, []);
});

test('bank detail exports the exact settled public-observation state, not a synthesized success label', async () => {
  const fake = fakePage();
  const result = JSON.parse(await serializedCapture()(fake.page, options({ bankDetail: true })));
  assert.ok(result.every((row) => row.observation.settled === true && row.observation.loading === false));
  assert.ok(fake.state.waits.every((value) => value.bankDetail === true && value.publicDetail === false));
});

test('missing or busy bank observation rejects capture before screenshot', async () => {
  for (const changes of [{ observationBusy: true }, { observationMissing: true }]) {
    const fake = fakePage(changes);
    await assert.rejects(serializedCapture()(fake.page, options({ bankDetail: true })), /FakeBaselineSettleDeadline/);
    assert.deepEqual(fake.state.screenshots, []); assert.equal(fake.events.listenerCount('pageerror'), 0);
  }
});

test('loading text is retained even if its observation advertises aria-busy false', async () => {
  const fake = fakePage({ observationLoading: true });
  const result = JSON.parse(await serializedCapture()(fake.page, options({ bankDetail: true })));
  assert.ok(result.every((row) => row.observation.settled === true && row.observation.loading === true));
  assert.ok(result.every((row) => !Object.hasOwn(row, 'pass')), 'only the runner may validate and mark a capture PASS');
});

test('exact public route heading is checked before any screenshot', async () => {
  for (const changes of [{ publicDetail: true, label: 'public-publication-LAND' }, { label: 'public-profile' }]) {
    const fake = fakePage({ headingMismatch: true });
    await assert.rejects(serializedCapture()(fake.page, options(changes)), /BaselineRouteHeadingMismatch/);
    assert.deepEqual(fake.state.screenshots, []); assert.equal(fake.events.listenerCount('pageerror'), 0);
  }
});

test('hidden streamed heading copy is retained as evidence, never chosen instead of the unique visible heading', async()=>{
  const fake=fakePage({stagedHeadingCopy:true});
  const rows=JSON.parse(await serializedCapture()(fake.page,options({widths:[768],publicDetail:true,label:'public-publication-BUILDING'})));
  assert.ok(fake.state.selectors.includes('#asset-title:visible'));
  assert.equal(rows[0].headingEvidence.before.count,2);
  assert.deepEqual(rows[0].headingEvidence.after.nodes.map(node=>node.visible),[true,false]);
  assert.deepEqual(rows[0].headingEvidence.after.nodes[1].hiddenAncestor,{tag:'DIV',id:'S:owned'});
});

test('two visible asset headings remain a strict failure with safe diagnostic metadata and no screenshot',async()=>{
  const fake=fakePage({visibleHeadingCopy:true});
  await assert.rejects(serializedCapture()(fake.page,options({publicDetail:true,label:'public-publication-BUILDING'})),error=>{
    assert.match(error.message,/BaselineHeadingWait/);assert.match(error.message,/FakeVisibleHeadingStrictViolation/);
    assert.match(error.message,/"count":2/);return true;
  });
  assert.deepEqual(fake.state.screenshots,[]);assert.equal(fake.events.listenerCount('pageerror'),0);
});

test('missing visible asset heading is a bounded failure, not hidden staging success',async()=>{
  const fake=fakePage({assetHeadingMissing:true});
  await assert.rejects(serializedCapture()(fake.page,options({publicDetail:true,label:'public-publication-BUILDING'})),/FakeAssetHeadingDeadline/);
  assert.deepEqual(fake.state.screenshots,[]);assert.equal(fake.events.listenerCount('pageerror'),0);
});

test('a transparent asset heading cannot produce a settled public-detail screenshot',async()=>{
  const fake=fakePage({headingOpacity:'0'});
  await assert.rejects(serializedCapture()(fake.page,options({publicDetail:true,label:'public-publication-LAND'})),/FakeBaselineSettleDeadline/);
  assert.deepEqual(fake.state.screenshots,[]);assert.equal(fake.events.listenerCount('pageerror'),0);
});

test('profile capture excludes the real loading-route heading and waits for delayed route content', async () => {
  const fake = fakePage({ loadingHeadingPresent: true, realHeadingDelayed: true });
  const result = JSON.parse(await serializedCapture()(fake.page, options({ widths: [768], label: 'public-profile' })));
  assert.equal(result.length, 1);
  assert.ok(fake.state.selectors.includes('main:not([data-loading-variant]) > header h1:visible'));
  assert.ok(!fake.state.selectors.includes('main header h1'));
  assert.ok(fake.state.trace.indexOf('wait-real-heading') < fake.state.trace.indexOf('screenshot'));
});

test('profile capture retains a hidden streamed copy but selects only the unique visible actual heading',async()=>{
  const fake=fakePage({stagedHeadingCopy:true});
  const rows=JSON.parse(await serializedCapture()(fake.page,options({widths:[768],label:'public-profile'})));
  assert.ok(fake.state.selectors.includes('main:not([data-loading-variant]) > header h1:visible'));
  assert.equal(rows[0].headingEvidence.before.count,2);
  assert.deepEqual(rows[0].headingEvidence.after.nodes.map(node=>node.visible),[true,false]);
  assert.deepEqual(rows[0].headingEvidence.after.nodes[1].hiddenAncestor,{tag:'DIV',id:'S:owned'});
});

test('two visible profile headings remain strict failure with actual DOM metadata and no screenshot',async()=>{
  const fake=fakePage({visibleHeadingCopy:true});
  await assert.rejects(serializedCapture()(fake.page,options({label:'public-profile'})),error=>{
    assert.match(error.message,/BaselineHeadingWait/);assert.match(error.message,/FakeVisibleProfileHeadingStrictViolation/);
    assert.match(error.message,/"count":2/);return true;
  });
  assert.deepEqual(fake.state.screenshots,[]);assert.equal(fake.events.listenerCount('pageerror'),0);
});

test('transparent profile heading cannot produce a settled screenshot or a false route success',async()=>{
  const fake=fakePage({headingOpacity:'0'});
  await assert.rejects(serializedCapture()(fake.page,options({label:'public-profile'})),/FakeBaselineSettleDeadline/);
  assert.deepEqual(fake.state.screenshots,[]);assert.equal(fake.events.listenerCount('pageerror'),0);
});

test('a loading heading cannot substitute for missing actual profile content', async () => {
  const fake = fakePage({ loadingHeadingPresent: true, realHeadingMissing: true });
  await assert.rejects(serializedCapture()(fake.page, options({ label: 'public-profile' })), /FakeRealHeadingDeadline/);
  assert.deepEqual(fake.state.screenshots, []);
  assert.equal(fake.events.listenerCount('pageerror'), 0);
});

test('loading copy does not waive an incorrect real profile identity or busy content', async () => {
  for (const changes of [{ headingMismatch: true }, { mainBusy: true }]) {
    const fake = fakePage({ loadingHeadingPresent: true, ...changes });
    await assert.rejects(serializedCapture()(fake.page, options({ label: 'public-profile' })),
      changes.headingMismatch ? /BaselineRouteHeadingMismatch/ : /FakeBaselineSettleDeadline/);
    assert.deepEqual(fake.state.screenshots, []);
    assert.equal(fake.events.listenerCount('pageerror'), 0);
  }
});

test('public gallery dimensions, current source, opacity, animation and transform remain readiness requirements', async () => {
  for (const changes of [{ heroWidth: 320 }, { heroHref: 'http://127.0.0.1:4411/media/wrong' },
    { heroOpacity: '0.5' }, { heroAnimating: true }, { heroTransform: 'matrix(0.5, 0, 0, 0.5, 0, 0)' }]) {
    const fake = fakePage(changes);
    await assert.rejects(serializedCapture()(fake.page, options({ publicDetail: true, label: 'public-publication-LAND' })), /FakeBaselineSettleDeadline/);
    assert.deepEqual(fake.state.screenshots, []);
  }
});

test('pure mobile double preserves native Tab focus, viewport hit proofs and four focus screenshots', async () => {
  const fake = fakePage();
  const result = JSON.parse(await serializedCapture()(fake.page, options({ publicDetail: true, label: 'public-publication-LAND' })));
  assert.equal(fake.state.screenshots.length, 9);
  for (const row of result.slice(0, 2)) {
    for (const proof of [row.mobileReachability.publisher, row.mobileReachability.footer]) {
      assert.deepEqual({steps:proof.steps,focused:proof.focused,insideViewport:proof.insideViewport,hit:proof.hit}, { steps: 1, focused: true, insideViewport: true, hit: true });
      assert.equal(proof.nativeScroll.settled, true); assert.equal(proof.nativeScroll.samples, 3);
    }
    assert.equal(row.mobileReachability.screenshots.length, 2);
  }
  assert.ok(result.slice(2).every((row) => row.mobileReachability === null));
  assert.equal(fake.state.screenshots.filter((row) => row.fullPage === false).length, 9);
  assert.equal(fake.state.trace.filter((event) => event === 'Tab').length, 4);
});

test('exhausted native focus search retains its failure metadata without scripted focus rescue', async () => {
  const fake = fakePage({ focusStuck: true });
  const result = JSON.parse(await serializedCapture()(fake.page, options({ widths: [360], publicDetail: true, label: 'public-publication-LAND' })));
  for (const proof of [result[0].mobileReachability.publisher, result[0].mobileReachability.footer]) {
    assert.equal(proof.steps, 81); assert.equal(proof.focused, false); assert.equal(proof.hit, false);
      assert.equal(proof.nativeScroll.settled, false);
  }
  assert.equal(fake.state.trace.filter((event) => event === 'Tab').length, 160);
  assert.equal(Object.hasOwn(result[0], 'pass'), false);
});

test('blocked mobile hit target remains false even when native focus and viewport checks pass', async () => {
  const fake = fakePage({ hitBlocked: true });
  const result = JSON.parse(await serializedCapture()(fake.page, options({ widths: [390], publicDetail: true, label: 'public-publication-LAND' })));
  for (const proof of [result[0].mobileReachability.publisher, result[0].mobileReachability.footer]) {
    assert.equal(proof.focused, true); assert.equal(proof.insideViewport, true); assert.equal(proof.hit, false);
    assert.equal(proof.nativeScroll.settled, false); assert.ok(proof.nativeScroll.elapsedMs >= 5000);
  }
});

test('native smooth scrolling is observed until safe exact positions converge, without scripted rescue', async () => {
  const fake = fakePage({ nativeScrollFrames: 8 });
  const result = JSON.parse(await serializedCapture()(fake.page, options({ widths: [360], publicDetail: true, label: 'public-publication-LAND' })));
  for (const proof of [result[0].mobileReachability.publisher,result[0].mobileReachability.footer]) {
    assert.equal(proof.focused, true); assert.equal(proof.insideViewport, true); assert.equal(proof.hit, true);
    assert.equal(proof.nativeScroll.settled, true); assert.ok(proof.nativeScroll.samples > 3);
    assert.ok(proof.nativeScroll.before.top > 900); assert.ok(proof.nativeScroll.after.bottom < 820);
  }
});

test('a focused target whose scroll never reaches the safe viewport stays failed and bounded', async () => {
  const fake = fakePage({ nativeScrollFrames: 1000 });
  const result = JSON.parse(await serializedCapture()(fake.page, options({ widths: [390], publicDetail: true, label: 'public-publication-LAND' })));
  for (const proof of [result[0].mobileReachability.publisher,result[0].mobileReachability.footer]) {
    assert.equal(proof.focused, true); assert.equal(proof.insideViewport, false);
    assert.equal(proof.nativeScroll.settled, false); assert.ok(proof.nativeScroll.elapsedMs >= 5000);
    assert.ok(proof.nativeScroll.samples < 320);
  }
});

test('focus lost while native scrolling is settling fails without restoring it', async () => {
  const fake = fakePage({ nativeScrollFrames: 8, focusLostFrames: 5 });
  const result = JSON.parse(await serializedCapture()(fake.page, options({ widths: [360], publicDetail: true, label: 'public-publication-LAND' })));
  for (const proof of [result[0].mobileReachability.publisher,result[0].mobileReachability.footer]) {
    assert.equal(proof.focused, false); assert.equal(proof.nativeScroll.settled, false);
    assert.ok(proof.nativeScroll.elapsedMs < 5000);
  }
});

test('zero or nonfinite target geometry never produces a successful native reachability proof', async () => {
  for(const settings of [{zeroFocusGeometry:true},{invalidFocusGeometry:true}]) {
    const fake=fakePage(settings);
    const result=JSON.parse(await serializedCapture()(fake.page, options({widths:[390],publicDetail:true,label:'public-publication-LAND'})));
    for(const proof of [result[0].mobileReachability.publisher,result[0].mobileReachability.footer]) {
      assert.equal(proof.insideViewport,false); assert.equal(proof.hit,false);
      assert.equal(proof.nativeScroll.settled,false); assert.ok(proof.nativeScroll.elapsedMs>=5000);
    }
  }
});

test('actual reported CSS width, overflow and pageerror are preserved for runner rejection', async () => {
  const fake = fakePage({ reportWidthOffset: 1, overflow: true, pageError: true });
  const result = JSON.parse(await serializedCapture()(fake.page, options()));
  assert.deepEqual(result.map((row) => row.width), widths.map((width) => width + 1));
  assert.ok(result.every((row) => row.overflow && row.errors.length === 1 && row.errors[0].name === 'FakePageError'));
  assert.ok(result.every((row) => !Object.hasOwn(row, 'pass')));
});

test('screenshot rejection retains failure and removes its pageerror listener', async () => {
  const fake = fakePage({ screenshotReject: true });
  await assert.rejects(serializedCapture()(fake.page, options()), /FakeScreenshotRejected/);
  assert.equal(fake.events.listenerCount('pageerror'), 0);
});

test('runner source strictly validates captured widths, media, observation and native mobile reachability before PASS', () => {
  // Static unit contract only, not browser/rendered UX evidence. The actual
  // runner assertions execute during the separate owned three-UI integration.
  const source = fs.readFileSync(path.join(__dirname, 'sj-three-ui-browser.js'), 'utf8');
  assert.match(source, /assert\.equal\(result\.width,width\)/);
  assert.match(source, /assert\.equal\(result\.overflow,false\);assert\.deepEqual\(result\.errors,\[\]\)/);
  assert.match(source, /assert\.ok\(result\.media\.every\(image=>image\.loaded\)/);
  assert.match(source, /assert\.deepEqual\(result\.observation,\{settled:true,loading:false\}\)/);
  assert.match(source, /assert\.ok\(item\.focused&&item\.insideViewport&&item\.hit&&item\.steps<=80&&item\.nativeScroll\.settled/);
  assert.ok(source.indexOf('item.focused&&item.insideViewport&&item.hit&&item.steps<=80') < source.indexOf('checks.push({label,url:result.url'));
  assert.doesNotMatch(captureBaselinePage.toString(), /\.focus\(|scrollIntoView\(/);
});
