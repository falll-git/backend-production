'use strict';

// Serialize this exact function into the owned browser. No scrolling, focusing,
// URL/body/header export, CSS changes, mocked response or image-forcing action.
async function collectVisibleMedia(page,{timeoutMs=20000}={}){
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw Error('VISIBLE_MEDIA_TIMEOUT_INVALID');
  return page.evaluate(async({timeoutMs})=>{
    const deadline=performance.now()+timeoutMs,ids=new WeakMap();let sequence=0,previous='',stable=0,samples=0,last;
    const identity=element=>{if(!ids.has(element))ids.set(element,++sequence);return ids.get(element);};
    const sourceKind=element=>{
      const source=element.currentSrc||element.getAttribute('src')||'';
      return !source?'empty':source.startsWith('blob:')?'blob':source.startsWith('data:')?'data':/^https?:/.test(source)?'http':'other';
    };
    const rectangle=element=>{
      const b=element.getBoundingClientRect();
      return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height};
    };
    const inspect=(element,hitTest=true)=>{
      const rect=rectangle(element),values=Object.values(rect);
      if(!values.every(Number.isFinite)||rect.width<=0||rect.height<=0)return {reason:'no-geometry',rect};
      let visible={left:Math.max(0,rect.left),right:Math.min(innerWidth,rect.right),top:Math.max(0,rect.top),bottom:Math.min(innerHeight,rect.bottom)};
      if(visible.right<=visible.left||visible.bottom<=visible.top)return {reason:'offscreen',rect};
      let opaque=true,animating=false;
      for(let node=element;node&&node!==document;node=node.parentElement){
        const style=getComputedStyle(node);
        if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse')return {reason:'hidden',rect};
        const opacity=Number(style.opacity);if(Number.isFinite(opacity)&&opacity<0.99)opaque=false;
        if(node.getAnimations?.().some(animation=>['running','pending'].includes(animation.playState)))animating=true;
        if(node!==element){
          const b=node.getBoundingClientRect();
          if(/^(?:hidden|clip|scroll|auto)$/.test(style.overflowX)){visible.left=Math.max(visible.left,b.left);visible.right=Math.min(visible.right,b.right);}
          if(/^(?:hidden|clip|scroll|auto)$/.test(style.overflowY)){visible.top=Math.max(visible.top,b.top);visible.bottom=Math.min(visible.bottom,b.bottom);}
        }
      }
      if(visible.right<=visible.left||visible.bottom<=visible.top)return {reason:'ancestor-clipped',rect};
      if(hitTest){
        const w=visible.right-visible.left,h=visible.bottom-visible.top;
        const points=[[0.5,0.5],[0.2,0.2],[0.8,0.2],[0.2,0.8],[0.8,0.8]];
        const exposed=points.some(([x,y])=>{
          const hit=document.elementFromPoint(visible.left+w*x,visible.top+h*y);
          return hit&&(hit===element||element.contains(hit)||(getComputedStyle(element).pointerEvents==='none'&&hit.contains(element)));
        });
        if(!exposed)return {reason:'occluded',rect};
      }
      return {reason:null,rect,intersection:visible,opaque,animating};
    };
    for(;;){
      samples++;
      const dialogs=[...document.querySelectorAll('[role="dialog"],dialog[open]')].filter(element=>!inspect(element,false).reason);
      const root=dialogs.at(-1)||document,rootView=root===document?null:inspect(root,false);
      const scope={kind:root===document?'document':'dialog',node:root===document?0:identity(root),...(rootView?{rect:rootView.rect}:{})};
      const images=[...document.querySelectorAll('img')],states=[...document.querySelectorAll('[role="status"][aria-label^="Memuat pratinjau "],button[aria-label^="Muat ulang pratinjau "]')];
      if(images.length+states.length>2000)throw Error('VISIBLE_MEDIA_NODE_BOUND');
      const media=[],excluded=[],pending=[],signature=[scope.kind,scope.node,scope.rect];let excludedCount=0;
      if(rootView&&(!rootView.opaque||rootView.animating))pending.push({kind:'dialog',node:scope.node,opaque:rootView.opaque,animating:rootView.animating});
      const exclude=(element,kind,reason,rect)=>{excludedCount++;if(excluded.length<200)excluded.push({kind,node:identity(element),reason,rect,...(kind==='image'?{sourceKind:sourceKind(element)}:{})});};
      for(const image of images){
        if(root!==document&&!root.contains(image)){exclude(image,'image','outside-active-dialog',rectangle(image));continue;}
        const view=inspect(image);
        if(view.reason){exclude(image,'image',view.reason,view.rect);continue;}
        const loaded=Boolean(image.complete&&image.naturalWidth>0&&image.naturalHeight>0),node=identity(image);
        media.push({node,loaded,width:image.naturalWidth,height:image.naturalHeight,sourceKind:sourceKind(image),rect:view.rect,intersection:view.intersection,opaque:view.opaque,animating:view.animating});
        signature.push([node,image.currentSrc||image.getAttribute('src')||'',view.rect,image.naturalWidth,image.naturalHeight,loaded,view.opaque,view.animating]);
        if(!loaded||!view.opaque||view.animating)pending.push({kind:'image',node,loaded,opaque:view.opaque,animating:view.animating});
      }
      for(const state of states){
        if(root!==document&&!root.contains(state)){exclude(state,'preview','outside-active-dialog',rectangle(state));continue;}
        const view=inspect(state);
        if(view.reason){exclude(state,'preview',view.reason,view.rect);continue;}
        const kind=state.getAttribute('role')==='status'?'loading-preview':'retry-preview',node=identity(state);
        pending.push({kind,node,rect:view.rect});signature.push([kind,node,view.rect]);
      }
      const encoded=JSON.stringify(signature),ready=pending.length===0;
      stable=ready?(encoded===previous?stable+1:1):0;previous=encoded;
      last={media,scope,excluded,excludedCount,pending,samples,stableFrames:stable};
      if(ready&&stable>=3)return {...last,settled:true};
      if(performance.now()>=deadline){
        const error=Error('VISIBLE_MEDIA_TIMEOUT '+JSON.stringify({scope,pending:pending.slice(0,8),media:media.slice(0,8),excludedCount,samples}));
        error.code='VISIBLE_MEDIA_TIMEOUT';throw error;
      }
      let timer;
      try{await Promise.race([new Promise(resolve=>requestAnimationFrame(resolve)),new Promise(resolve=>{timer=setTimeout(resolve,Math.max(1,deadline-performance.now()));})]);}
      finally{clearTimeout(timer);}
    }
  },{timeoutMs});
}
module.exports={collectVisibleMedia};
