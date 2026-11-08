'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {collectVisibleMedia}=require('./sj-step6-visible-media');

// These VM tests execute the production serialized function and its actual DOM
// callbacks. They are deliberately NOT real browser, service or visual proof.
function domPage(configuration={}){
  const state={time:0,frames:0,evaluations:0,timers:0,cleared:0},nodes=[];
  const body={tagName:'BODY',parentElement:null,style:{display:'block',visibility:'visible',opacity:'1',overflowX:'visible',overflowY:'visible'},getBoundingClientRect:()=>({left:0,right:800,top:0,bottom:900,width:800,height:900}),getAnimations:()=>[],contains:node=>node===body||nodes.includes(node)};
  const make=(kind,settings={})=>{
    const node={kind,parentElement:settings.parent||body,style:{display:'block',visibility:'visible',opacity:'1',overflowX:'visible',overflowY:'visible',...settings.style},
      complete:settings.complete??true,naturalWidth:settings.width??320,naturalHeight:settings.height??240,currentSrc:settings.source??'blob:owned-private-not-exported',
      rect:{left:20,right:340,top:100,bottom:340,width:320,height:240,...settings.rect},
      getBoundingClientRect(){return this.rect;},getAnimations(){return settings.animating&&state.frames<(settings.animationUntil??100)?[{playState:'running'}]:[];},
      getAttribute(name){if(name==='src')return this.currentSrc;if(name==='role')return kind==='loading'?'status':kind==='dialog'?'dialog':null;return null;},
      contains(other){for(let p=other;p;p=p.parentElement)if(p===this)return true;return false;}};
    nodes.push(node);return node;
  };
  const image=make('image',configuration.image||{});
  if(configuration.noImage)nodes.splice(nodes.indexOf(image),1);
  let dialog,background,preview;
  if(configuration.modal){dialog=make('dialog',{rect:{left:10,right:790,top:10,bottom:890,width:780,height:880}});image.parentElement=dialog;background=make('image',{complete:false,width:0,height:0,source:'https://private.test/secret-object-key'});}
  if(configuration.preview)preview=make(configuration.preview,{rect:{left:20,right:340,top:400,bottom:640,width:320,height:240}});
  if(configuration.clip){const parent=make('container',{rect:{left:10,right:100,top:50,bottom:80,width:90,height:30},style:{overflowY:'hidden'}});image.parentElement=parent;}
  const document={documentElement:body,
    querySelectorAll(selector){
      if(selector==='img')return nodes.filter(n=>n.kind==='image');
      if(selector==='[role="dialog"],dialog[open]')return nodes.filter(n=>n.kind==='dialog');
      if(selector==='[role="status"][aria-label^="Memuat pratinjau "],button[aria-label^="Muat ulang pratinjau "]')return nodes.filter(n=>n.kind==='loading'||n.kind==='retry');
      throw Error('unexpected selector '+selector);
    },
    elementFromPoint(x,y){if(configuration.occluded)return {contains:()=>false};if(configuration.ancestorOccludes)return body;return nodes.slice().reverse().find(n=>n.kind!=='dialog'&&(!dialog||dialog.contains(n))&&n.rect.left<=x&&n.rect.right>=x&&n.rect.top<=y&&n.rect.bottom>=y)||(dialog||body);},
  };
  const context=vm.createContext({document,innerWidth:800,innerHeight:900,getComputedStyle:node=>node.style,
    performance:{now:()=>state.time},
    requestAnimationFrame:callback=>{
      state.frames++;state.time+=16;
      if(configuration.loadAfter&&state.frames>=configuration.loadAfter){image.complete=true;image.naturalWidth=320;image.naturalHeight=240;}
      if(configuration.insertAfter===state.frames)make('image',{complete:false,width:0,height:0,source:'blob:late-private'});
      if(configuration.sourceChange===state.frames)image.currentSrc='blob:changed-private';
      if(configuration.previewClears&&state.frames>=configuration.previewClears){const index=nodes.indexOf(preview);if(index>=0)nodes.splice(index,1);}
      callback(state.time);
    },
    setTimeout:()=>{state.timers++;return state.timers;},clearTimeout:()=>{state.cleared++;},
  });
  const page={evaluate:async(callback,arg)=>{state.evaluations++;return new vm.Script('('+callback.toString()+')').runInContext(context)(arg);}};
  return {page,state,image,nodes,background};
}
const serialized=()=>new vm.Script('('+collectVisibleMedia.toString()+')').runInNewContext();
test('production serialized sampler atomically returns loaded media only after three stable frames',async()=>{
  const fake=domPage(),result=await serialized()(fake.page,{timeoutMs:160});
  assert.equal(result.settled,true);assert.equal(result.stableFrames,3);assert.equal(result.samples,3);assert.equal(result.media.length,1);
  assert.equal(result.media[0].loaded,true);assert.equal(result.media[0].sourceKind,'blob');assert.equal(result.scope.kind,'document');
  assert.equal(fake.state.timers,fake.state.cleared);assert(!JSON.stringify(result).includes('owned-private'));
});
test('visible newly inserted unready image cannot pass after a prior ready sample',async()=>{
  const fake=domPage({insertAfter:1});await assert.rejects(serialized()(fake.page,{timeoutMs:80}),/VISIBLE_MEDIA_TIMEOUT/);
  assert(fake.state.frames>=5);assert.equal(fake.state.timers,fake.state.cleared);
});
test('source identity changes reset the three-frame stability requirement',async()=>{
  const fake=domPage({sourceChange:2}),result=await serialized()(fake.page,{timeoutMs:160});
  assert.equal(result.samples,5);assert.equal(result.stableFrames,3);assert(!JSON.stringify(result).includes('changed-private'));
});
test('actual pending image later loading is awaited, not ignored or synthesized',async()=>{
  const fake=domPage({image:{complete:false,width:0,height:0},loadAfter:2}),result=await serialized()(fake.page,{timeoutMs:160});
  assert.equal(result.media[0].loaded,true);assert.equal(result.samples,5);
});
for(const preview of ['loading','retry'])test('visible '+preview+' preview forbids image-vacuous or image-loaded success',async()=>{
  const fake=domPage({preview});await assert.rejects(serialized()(fake.page,{timeoutMs:64}),error=>error.message.includes('VISIBLE_MEDIA_TIMEOUT')&&error.message.includes(preview+'-preview'));
});
test('loading preview disappearing and real loaded image must then be stable',async()=>{
  const fake=domPage({preview:'loading',previewClears:2}),result=await serialized()(fake.page,{timeoutMs:160});
  assert.equal(result.samples,5);assert.equal(result.pending.length,0);
});
test('a visible preview without any img cannot vacuously settle',async()=>{
  const fake=domPage({preview:'loading',noImage:true});await assert.rejects(serialized()(fake.page,{timeoutMs:64}),/VISIBLE_MEDIA_TIMEOUT/);
});
test('horizontal offscreen unready image is consistently excluded by readiness and metadata',async()=>{
  const fake=domPage({image:{complete:false,width:0,height:0,rect:{left:900,right:1220}}}),result=await serialized()(fake.page,{timeoutMs:160});
  assert.equal(result.media.length,0);assert.equal(result.excluded[0].reason,'offscreen');
});
test('an image clipped out by its scroll ancestor is excluded with explicit evidence',async()=>{
  const fake=domPage({clip:true,image:{complete:false,width:0,height:0}}),result=await serialized()(fake.page,{timeoutMs:160});
  assert.equal(result.media.length,0);assert.equal(result.excluded[0].reason,'ancestor-clipped');
});
test('active dialog explicitly scopes media and does not call its pending background image loaded',async()=>{
  const fake=domPage({modal:true}),result=await serialized()(fake.page,{timeoutMs:160});
  assert.equal(result.scope.kind,'dialog');assert.equal(result.media.length,1);assert.equal(result.media[0].loaded,true);
  assert.equal(result.excluded.find(item=>item.reason==='outside-active-dialog').kind,'image');
  assert(!JSON.stringify(result).includes('secret-object-key'));
});
test('fully occluded image remains excluded metadata, never a loaded media claim',async()=>{
  const fake=domPage({occluded:true,image:{complete:false,width:0,height:0}}),result=await serialized()(fake.page,{timeoutMs:160});
  assert.equal(result.media.length,0);assert.equal(result.excluded[0].reason,'occluded');
});
test('hit ancestor cannot falsely prove exposure unless media intentionally disables pointer events',async()=>{
  const blocked=domPage({ancestorOccludes:true}),excluded=await serialized()(blocked.page,{timeoutMs:160});
  assert.equal(excluded.media.length,0);assert.equal(excluded.excluded[0].reason,'occluded');
  const transparentPointer=domPage({ancestorOccludes:true,image:{style:{pointerEvents:'none'}}}),included=await serialized()(transparentPointer.page,{timeoutMs:160});
  assert.equal(included.media.length,1);assert.equal(included.media[0].loaded,true);
});
for(const configuration of [
  {image:{complete:false,width:0,height:0}},
  {image:{style:{opacity:'0'}}},
  {image:{animating:true}},
])test('visible incomplete, transparent or animated image is not waived by the sampler',async()=>{
  const fake=domPage(configuration);await assert.rejects(serialized()(fake.page,{timeoutMs:80}),/VISIBLE_MEDIA_TIMEOUT/);
});
test('image animation finishing is observed without forced styles or sleeps',async()=>{
  const fake=domPage({image:{animating:true,animationUntil:2}}),result=await serialized()(fake.page,{timeoutMs:160});
  assert.equal(result.samples,5);assert.equal(result.media[0].animating,false);
});
test('invalid deadline is refused before page evaluation',async()=>{
  for(const timeoutMs of [0,-1,1.5,30001,NaN]){const fake=domPage();await assert.rejects(collectVisibleMedia(fake.page,{timeoutMs}),/VISIBLE_MEDIA_TIMEOUT_INVALID/);assert.equal(fake.state.evaluations,0);}
});
