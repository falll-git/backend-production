const test=require('node:test'),assert=require('node:assert/strict');
const {validatePublicResponse,isNotFound,origin}=require('./publicObservation.contract');
const expected={slug:'bank-uji',identity:'SJ-ABCDEFGH',logoIds:['logo-owned']};
const institution={public_slug:expected.slug,public_name:'Bank Uji',public_mark_url:'https://sj.example/v1/public/media/logo-owned'};
const photo={url:'https://sj.example/v1/public/media/photo',width:480,height:320};
const asset={reference_code:expected.identity,title:'Aset uji',description:'Deskripsi aset',category:'TANAH',availability:'AVAILABLE',institution,
  location:{province:'Jawa Barat',city_regency:'Bandung'},cover:photo,media:[photo],photo_count:1,attributes:{land_area_m2:0},
  public_updated_at:'2026-09-20T00:00:00.000Z',whatsapp_url:'https://wa.me/6281234567890?text=Halo'};
test('actual public DTO identity and owned logo required; zero attributes preserved',()=>{
  assert.equal(validatePublicResponse('PUBLICATION',asset,expected),true);
  for(const body of [{},null,{...asset,reference_code:'SJ-ZZZZZZZZ'},{...asset,institution:{...institution,public_slug:'other'}},
    {...asset,institution:{...institution,public_mark_url:'https://sj.example/other-logo'}},{...asset,media:[]},{...asset,photo_count:2},
    {...asset,whatsapp_url:'javascript:alert(1)'},{...asset,availability:'PUBLISHED'}])assert.equal(validatePublicResponse('PUBLICATION',body,expected),false);
});
test('profile availability does not imply all its assets are available',()=>{
  const profile={...institution,short_description:'Profil bank',office_city_regency:'Bandung',office_province:'Jawa Barat',published_asset_count:0};
  assert.equal(validatePublicResponse('PROFILE',profile,expected),true);
  assert.equal(validatePublicResponse('PROFILE',{...profile,published_asset_count:-1},expected),false);
});
test('generic or malformed 404 is not negative public proof',()=>{
  const error={request_id:'test-request',code:'ASSET_NOT_FOUND',message:'Tidak tersedia',retryable:false};
  assert.equal(isNotFound('PUBLICATION',error),true);
  for(const value of [{},{...error,code:'NOT_FOUND'},{...error,retryable:true}])assert.equal(isNotFound('PUBLICATION',value),false);
  assert.equal(isNotFound('PROFILE',error),false);
});
test('profile source version and independent website origin; snapshot allowlist',()=>{
  const {profileSnapshot}=require('./publicObservation.contract');
  const e={...expected,websiteOrigin:'https://catalog.example'};
  const p={...institution,short_description:'Publik',office_city_regency:'Bandung',office_province:'Jawa Barat',published_asset_count:0,
    public_profile_version:7,public_page_url:'https://catalog.example/bprs/bank-uji',private_key:'must not persist'};
  assert.equal(validatePublicResponse('PROFILE',p,e),true);
  assert.deepEqual(Object.keys(profileSnapshot(p)).sort(),['public_name','short_description','office_city_regency','office_province','published_asset_count','public_page_url'].sort());
  assert.equal(profileSnapshot(p).published_asset_count,0);
  for(const link of ['https://api.example/bprs/bank-uji','https://catalog.example/bprs/other','https://catalog.example/bprs/bank-uji?x=1','javascript:alert(1)','https://user@catalog.example/bprs/bank-uji'])assert.equal(validatePublicResponse('PROFILE',{...p,public_page_url:link},e),false);
  for(const version of [0,-1,1.5,'7',null])assert.equal(validatePublicResponse('PROFILE',{...p,public_profile_version:version},e),false);
  assert.equal(validatePublicResponse('PROFILE',p,expected),false);
  assert.equal(validatePublicResponse('PROFILE',{...p,public_page_url:null},expected),true);
});
test('trusted configured origin only, no credentials, redirects or arbitrary plain HTTP hosts',()=>{
  assert.equal(origin('https://sj.example/','production'),'https://sj.example');
  assert.equal(origin('http://127.0.0.1:4321','development'),'http://127.0.0.1:4321');
  for(const value of ['http://sj.example','https://user:secret@sj.example','https://sj.example/path','https://sj.example/?next=other','file:///x'])assert.throws(()=>origin(value,'production'));
  assert.throws(()=>origin('http://127.0.0.1:4321','production'));
});
test('publication snapshot binds applied event and website, retaining zero without private fields',()=>{
  const {publicationSnapshot}=require('./publicObservation.contract');
  const e={...expected,websiteOrigin:'https://catalog.example'};
  const body={...asset,public_asset_version:9,public_page_url:`https://catalog.example/aset/${expected.identity}`,private_key:'PRIVATE'};
  assert.equal(validatePublicResponse('PUBLICATION',body,e),true);
  const snapshot=publicationSnapshot(body);
  assert.equal(snapshot.attributes.land_area_m2,0);
  assert.deepEqual(Object.keys(snapshot).sort(),['title','description','category','city_regency','province','attributes','photo_count','public_updated_at','public_page_url'].sort());
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));assert.ok(!JSON.stringify(snapshot).includes('6281234567890'));
  for(const public_asset_version of [0,-1,1.2,'9',null,2147483648])assert.equal(validatePublicResponse('PUBLICATION',{...body,public_asset_version},e),false);
  for(const public_page_url of ['https://catalog.example/aset/SJ-ZZZZZZZZ','https://other.example/aset/'+expected.identity,body.public_page_url+'?next=x','https://user@catalog.example/aset/'+expected.identity])assert.equal(validatePublicResponse('PUBLICATION',{...body,public_page_url},e),false);
  for(const attributes of [{secret:'PRIVATE'},{land_area_m2:'0'},{land_area_m2:-1},{brand:'wrong category'},{land_area_m2:Infinity}])assert.equal(validatePublicResponse('PUBLICATION',{...body,attributes},e),false);
  assert.equal(validatePublicResponse('PUBLICATION',body,expected),false);
  assert.equal(validatePublicResponse('PUBLICATION',{...body,public_page_url:null},expected),true);
});
