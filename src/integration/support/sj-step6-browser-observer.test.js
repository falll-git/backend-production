const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {installBrowserObserver,readBrowserObserver}=require('./sj-step6-browser-observer');
function fixture(){const context=new EventEmitter(),page=new EventEmitter();page.context=()=>context;page.url=()=> 'http://127.0.0.1:3111/owned';context.pages=()=>[page];return {context,page};}
test('actual observer callbacks preserve network failures without payloads/headers/queries',async()=>{
 const {page}=fixture();await installBrowserObserver(page);
 const request={url:()=> 'http://127.0.0.1:3111/api/private?password=never-record',method:()=> 'GET',resourceType:()=> 'fetch',failure:()=>({errorText:'net::ERR_ABORTED'})};
 page.emit('request',request);page.emit('requestfailed',request);
 const result=await readBrowserObserver(page);assert.equal(result.pending.length,0);assert.equal(result.events[0].error,'net::ERR_ABORTED');assert(!JSON.stringify(result).includes('never-record'));
});
test('observer preserves HTTP500 and pageerror rather than calling them healthy',async()=>{
 const {page}=fixture();await installBrowserObserver(page);
 page.emit('response',{status:()=>500,url:()=>page.url(),request:()=>({method:()=> 'POST'})});page.emit('pageerror',new TypeError('private secret never exported'));
 const result=await readBrowserObserver(page);assert.equal(result.events[0].status,500);assert.equal(result.events[1].name,'TypeError');assert(!JSON.stringify(result).includes('private secret'));
});
test('future pages are observed and duplicate attachment is refused',async()=>{
 const {context,page}=fixture();await installBrowserObserver(page);await assert.rejects(installBrowserObserver(page),/ALREADY/);
 const other=new EventEmitter();other.url=page.url;context.emit('page',other);
 other.emit('console',{type:()=> 'error',location:()=>({url:page.url()})});assert.equal((await readBrowserObserver(page)).events[0].type,'console-error');
});
