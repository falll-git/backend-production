// Bank UI read semantics only. This is not a public observation or a DB enum.
exports.versionSemantics = Object.freeze({current_version:'WORKING_VERSION',published_version:'BANK_APPROVED_VERSION',public_version:'UNOBSERVED'});
// Lists do not load per-resource evidence. Absence here is not a failed check.
exports.publicObservation = Object.freeze({state:'NOT_LOADED',reason:'OBSERVATION_AVAILABLE_IN_DETAIL'});
exports.pagination = (page,limit,total) => ({page,limit,total,total_pages:Math.ceil(total/limit),total_scope:'ACCESSIBLE_FILTERED_RECORDS'});
exports.compareSubmissions = (a,b) => {
  for(const key of ['submitted_at','created_at']){const delta=new Date(b.version[key]).getTime()-new Date(a.version[key]).getTime();if(delta)return delta;}
  return b.version.id.localeCompare(a.version.id)||a.kind.localeCompare(b.kind);
};
const scalar=v=>v===null||['string','number','boolean'].includes(typeof v);
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value&&Object.hasOwn(value,k)&&scalar(value[k])).map(k=>[k,value[k]]));
const attributes='land_area_m2 contour road_access building_area_m2 floor_count public_usage brand_or_manufacturer brand model_or_type manufacture_year public_capacity transmission fuel_type mileage_km public_condition'.split(' ');
exports.profilePayload=value=>pick(value,'institution_id public_name public_mark short_description office_city_regency office_province profile_updated_at public_slug logo_media_id website_url'.split(' '));
exports.publicationPayload=value=>({
  ...pick(value,'publication_id reference_code institution_id taxonomy_version category subcategory title description availability whatsapp_contact_id published_at public_updated_at availability_confirmed_at next_confirmation_at'.split(' ')),
  ...(value?.location?{location:pick(value.location,['city_regency','province'])}:{}),
  ...(value?.attributes?{attributes:pick(value.attributes,attributes)}:{}),
  ...(Array.isArray(value?.media)?{media:value.media.map(m=>pick(m,['media_id','checksum','position','is_cover','alt_text']))}:{}),
});
exports.impact=value=>({
  ...pick(value,'target_label current_state expected_public_visibility affected_publications affected_media central_synced reference_code public_slug'.split(' ')),
  blockers:Array.isArray(value?.blockers)?value.blockers.filter(v=>typeof v==='string'):[],
});
