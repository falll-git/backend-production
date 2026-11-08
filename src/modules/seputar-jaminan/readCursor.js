const crypto=require('node:crypto');
const {AppError}=require('../../utils/errors');
const scope=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function decodeBy(value,filter,field='created_at'){
  if(!value)return null;
  try{
    if(typeof value!=='string'||value.length>1000||!/^[A-Za-z0-9_-]+$/.test(value))throw Error();
    const v=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
    if(Object.keys(v).sort().join(',')!=='field,id,scope,v,value'||v.v!==1||v.scope!==scope(filter)||v.field!==field
      ||typeof v.value!=='string'||new Date(v.value).toISOString()!==v.value
      ||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v.id)
      ||Buffer.from(JSON.stringify(v)).toString('base64url')!==value)throw Error();
    return {OR:[{[field]:{lt:new Date(v.value)}},{[field]:new Date(v.value),id:{lt:v.id}}]};
  }catch{throw new AppError('Posisi daftar tidak valid atau filternya berubah. Muat dari awal.',422);}
}
function decode(value,filter){
  if(!value)return null;
  try{
    if(typeof value!=='string'||value.length>1000||!/^[A-Za-z0-9_-]+$/.test(value))throw Error();
    const v=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
    if(Object.keys(v).sort().join(',')!=='created_at,id,scope,v'||v.v!==1||v.scope!==scope(filter)||typeof v.created_at!=='string'||new Date(v.created_at).toISOString()!==v.created_at||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v.id)||Buffer.from(JSON.stringify(v)).toString('base64url')!==value)throw Error();
    return {OR:[{created_at:{lt:new Date(v.created_at)}},{created_at:new Date(v.created_at),id:{lt:v.id}}]};
  }catch{throw new AppError('Posisi daftar tidak valid atau filternya berubah. Muat dari awal.',422);}
}
function pageBy(rows,limit,filter,serialize,field='created_at'){
  const hasMore=rows.length>limit,items=rows.slice(0,limit),last=items.at(-1);
  return {items:items.map(serialize),page_info:{limit,has_more:hasMore,next_cursor:hasMore?Buffer.from(JSON.stringify({v:1,scope:scope(filter),field,value:last[field].toISOString(),id:last.id})).toString('base64url'):null,
    count_scope:'CURRENT_PAGE',order:field==='created_at'?'CREATED_DESC_ID_DESC':`${field.toUpperCase()}_DESC_ID_DESC`}};
}
function page(rows,limit,filter,serialize){
  const hasMore=rows.length>limit,items=rows.slice(0,limit),last=items.at(-1);
  return {items:items.map(serialize),page_info:{limit,has_more:hasMore,next_cursor:hasMore?Buffer.from(JSON.stringify({v:1,scope:scope(filter),created_at:last.created_at.toISOString(),id:last.id})).toString('base64url'):null,count_scope:'CURRENT_PAGE',order:'CREATED_DESC_ID_DESC'}};
}
function decodeSubmission(value,filter,kind){
  if(!value)return null;
  try{
    if(typeof value!=='string'||value.length>1000||!/^[A-Za-z0-9_-]+$/.test(value))throw Error();
    const v=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
    const kinds=['CONTACT','PROFILE','PUBLICATION'];
    if(Object.keys(v).sort().join(',')!=='created_at,id,kind,scope,submitted_at,v'||v.v!==1||v.scope!==scope(filter)||!kinds.includes(v.kind)||!kinds.includes(kind)||typeof v.submitted_at!=='string'||typeof v.created_at!=='string'||new Date(v.submitted_at).toISOString()!==v.submitted_at||new Date(v.created_at).toISOString()!==v.created_at||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v.id)||Buffer.from(JSON.stringify(v)).toString('base64url')!==value)throw Error();
    const branches=[{submitted_at:{lt:new Date(v.submitted_at)}},{submitted_at:new Date(v.submitted_at),created_at:{lt:new Date(v.created_at)}},{submitted_at:new Date(v.submitted_at),created_at:new Date(v.created_at),id:{lt:v.id}}];
    // IDs belong to three independent tables. Equal timestamp/ID rows in a
    // later kind must not disappear at the page boundary (kind sorts ASC).
    if(kind>v.kind)branches.push({submitted_at:new Date(v.submitted_at),created_at:new Date(v.created_at),id:v.id});
    return {OR:branches};
  }catch{throw new AppError('Posisi daftar tidak valid atau filternya berubah. Muat dari awal.',422);}
}
function pageSubmission(rows,limit,filter,serialize){
  const hasMore=rows.length>limit,items=rows.slice(0,limit),last=items.at(-1),value=last?.version||last;
  return {items:items.map(serialize),page_info:{limit,has_more:hasMore,next_cursor:hasMore?Buffer.from(JSON.stringify({v:1,scope:scope(filter),submitted_at:value.submitted_at.toISOString(),created_at:value.created_at.toISOString(),id:value.id,kind:last.kind})).toString('base64url'):null,count_scope:'CURRENT_PAGE',order:'SUBMITTED_AT_DESC_CREATED_AT_DESC_ID_DESC_KIND_ASC'}};
}
module.exports={decode,decodeBy,page,pageBy,decodeSubmission,pageSubmission};
