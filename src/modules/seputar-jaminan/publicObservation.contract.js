// Identity-bound public API evidence, never proof of rendered pages or ongoing availability.
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=v=>typeof v==='string'&&v.trim().length>0;
const url=v=>{try{const u=new URL(v);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
const image=v=>record(v)&&url(v.url)&&Number.isInteger(v.width)&&v.width>0&&Number.isInteger(v.height)&&v.height>0;
function validatePublicResponse(kind,body,expected){
  if(!record(body))return false;
  const institution=kind==='PUBLICATION'?body.institution:body;
  if(!record(institution)||institution.public_slug!==expected.slug||!text(institution.public_name)||!url(institution.public_mark_url))return false;
  // A bank-owned, centrally acknowledged logo binds the public institution to
  // this bank without disclosing internal tenant IDs through the public API.
  const logoPath=new URL(institution.public_mark_url).pathname.split('/').filter(Boolean).at(-1);
  if(!expected.logoIds.includes(logoPath))return false;
  if(kind==='PROFILE')return text(body.short_description)&&text(body.office_city_regency)&&text(body.office_province)
    &&Number.isSafeInteger(body.published_asset_count)&&body.published_asset_count>=0
    &&(body.public_profile_version===undefined||(Number.isSafeInteger(body.public_profile_version)&&body.public_profile_version>0))
    &&(body.public_page_url==null||validProfilePage(body.public_page_url,expected));
  return body.reference_code===expected.identity&&text(body.title)&&text(body.description)
    &&['TANAH','BANGUNAN','MESIN_PERALATAN','KENDARAAN'].includes(body.category)
    &&body.availability==='AVAILABLE'&&record(body.location)&&text(body.location.city_regency)&&text(body.location.province)
    &&image(body.cover)&&Array.isArray(body.media)&&body.media.length>0&&body.media.length<=10&&body.media.every(image)
    &&Number.isSafeInteger(body.photo_count)&&body.photo_count===body.media.length&&validAttributes(body.category,body.attributes)
    &&(body.public_asset_version===undefined||(Number.isSafeInteger(body.public_asset_version)&&body.public_asset_version>0&&body.public_asset_version<=2147483647))
    &&(body.public_page_url==null||validAssetPage(body.public_page_url,expected))
    &&typeof body.public_updated_at==='string'&&Number.isFinite(Date.parse(body.public_updated_at))
    &&typeof body.whatsapp_url==='string'&&/^https:\/\/wa\.me\/[1-9]\d{7,14}\?text=/.test(body.whatsapp_url);
}
function isNotFound(kind,body){return record(body)&&body.code===(kind==='PUBLICATION'?'ASSET_NOT_FOUND':'INSTITUTION_NOT_FOUND')
  &&text(body.request_id)&&text(body.message)&&body.retryable===false;}
function origin(value,mode=process.env.NODE_ENV){
  const u=new URL(value);
  if(u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname))throw Error('OBSERVATION_CONFIGURATION_INVALID');
  if(u.protocol!=='https:'&&!(mode!=='production'&&u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw Error('OBSERVATION_CONFIGURATION_INVALID');
  return u.origin;
}
function validProfilePage(value,expected){
  try {
    const u=new URL(value);
    // A site origin is an independent, explicitly configured trust boundary.
    return !!expected.websiteOrigin&&u.origin===expected.websiteOrigin&&!u.username&&!u.password&&!u.search&&!u.hash
      &&u.pathname===`/bprs/${encodeURIComponent(expected.slug)}`;
  }catch{return false;}
}
function profileSnapshot(body){
  return {public_name:body.public_name,short_description:body.short_description,office_city_regency:body.office_city_regency,
    office_province:body.office_province,published_asset_count:body.published_asset_count,public_page_url:body.public_page_url??null};
}
const attributeKeys={
  TANAH:['land_area_m2','contour','road_access'],
  BANGUNAN:['land_area_m2','building_area_m2','floor_count','public_usage'],
  MESIN_PERALATAN:['brand_or_manufacturer','model_or_type','manufacture_year','public_capacity','public_condition'],
  KENDARAAN:['brand','model_or_type','manufacture_year','transmission','fuel_type','mileage_km','public_condition'],
};
const numericKeys=new Set(['land_area_m2','building_area_m2','floor_count','manufacture_year','mileage_km']);
function validAttributes(category,attributes){
  return record(attributes)&&!!attributeKeys[category]&&Object.entries(attributes).every(([key,value])=>
    attributeKeys[category].includes(key)&&(numericKeys.has(key)?typeof value==='number'&&Number.isFinite(value)&&value>=0:text(value)));
}
function validAssetPage(value,expected){
  try{const u=new URL(value);return !!expected.websiteOrigin&&u.origin===expected.websiteOrigin&&!u.username&&!u.password&&!u.search&&!u.hash
    &&u.pathname===`/aset/${encodeURIComponent(expected.identity)}`;}catch{return false;}
}
function publicationSnapshot(body){
  return {title:body.title,description:body.description,category:body.category,city_regency:body.location.city_regency,
    province:body.location.province,attributes:{...body.attributes},photo_count:body.photo_count,
    public_updated_at:body.public_updated_at,public_page_url:body.public_page_url??null};
}
module.exports={validatePublicResponse,isNotFound,origin,profileSnapshot,validProfilePage,publicationSnapshot,validAssetPage};
