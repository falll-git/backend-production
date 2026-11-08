// Invoked only inside the ownership-verified workflow harness.
const assert=require('node:assert/strict');
exports.run=async({http,server,prefix,tokens,actors,created,cycle,scope,checks,origin})=>{
  const request=require('supertest'),sharp=require('sharp');
  const bytes=await sharp({create:{width:320,height:240,channels:3,background:'#CBD6BF'}}).png().toBuffer();
  const upload=async purpose=>{
    const r=await request(server).post(prefix+'/media').set('Authorization','Bearer '+tokens.maker)
      .field('purpose',purpose).attach('image',bytes,{filename:'owned-guard-test.png',contentType:'image/png'});
    assert.equal(r.status,201,`Owned media upload: ${r.body.message||r.status}`);return r.body.data;
  };
  const remove=id=>http('maker','delete','/media/'+id,{reason_code:'OWNER_REQUEST'},409);
  let asset=await http('maker','get','/publications/'+created[0]);
  const original=asset.published_version.media[0].id;
  const replacement=await upload('PUBLICATION_IMAGE');await cycle();
  asset=await http('maker','patch',`/publications/${asset.id}/draft`,{expected_version:asset.lock_version,
    media:[{media_asset_id:replacement.id,sort_order:0,is_cover:true,alt_text:'Foto pengganti tes'}]});
  assert.notEqual(asset.current_version.id,asset.published_version.id);
  await remove(original);
  await assert.rejects(scope(actors.maker.id,tx=>tx.sj_media_assets.update({where:{id:original},data:{state:'REVOKED',revoked_at:new Date()}})));
  assert.equal((await http('maker','get','/media/'+original+'/status')).state,'READY');
  asset=await http('checker','post',`/publications/${asset.id}/unpublish`,{expected_version:asset.lock_version,reason_code:'OWNER_REQUEST'});
  asset=await http('checker','post',`/publications/${asset.id}/archive`,{expected_version:asset.lock_version});
  await remove(original); // Outstanding outbox still owns the reference.
  for(let n=0;n<8;n++)await cycle();
  const released=await request(server).delete(prefix+'/media/'+original).set('Authorization','Bearer '+tokens.maker).send({reason_code:'OWNER_REQUEST'});
  assert.equal(released.status,200,`Media release after ACK: ${released.body.message||released.status}`);
  assert.equal(released.body.data.state,'REVOKED');
  checks.push({check:'approved photo survives replacement draft; raw revoke denied; queued archive retains reference until actual worker ACK',pass:true,url:origin});

  let pending=await http('maker','get','/publications/'+created[2]);
  pending=await http('checker','post',`/publications/${pending.id}/request-revision`,{expected_version:pending.lock_version,reason:'Perbaiki foto untuk uji balapan pencabutan.'});
  const candidate=await upload('PUBLICATION_IMAGE');
  const [bind,revoke]=await Promise.all([
    request(server).patch(prefix+`/publications/${pending.id}/draft`).set('Authorization','Bearer '+tokens.maker)
      .send({expected_version:pending.lock_version,media:[{media_asset_id:candidate.id,sort_order:0,is_cover:true,alt_text:'Foto uji bersamaan'}]}),
    request(server).delete(prefix+'/media/'+candidate.id).set('Authorization','Bearer '+tokens.maker).send({reason_code:'OWNER_REQUEST'}),
  ]);
  assert.ok((bind.status===200&&revoke.status===409)||(bind.status===422&&revoke.status===200),`Media race ${bind.status}/${revoke.status}`);
  const read=await http('maker','get','/publications/'+pending.id);
  const status=await http('maker','get','/media/'+candidate.id+'/status');
  assert.ok(!(read.current_version.media.some(m=>m.id===candidate.id)&&status.state==='REVOKED'));
  checks.push({check:'real concurrent media binding versus revoke has one winner; no revoked media becomes draft dependency',pass:true,url:origin});
  // Check the old approved logo independently of the editable profile row.
  let profile=await http('maker','get','/profile');
  assert.equal(profile.state,'VERIFIED','media fixture begins with a verified profile');
  const oldLogo=profile.logo_media_id,logo=await upload('BPRS_PUBLIC_MARK');await cycle();
  profile=await http('maker','patch','/profile/draft',{expected_version:profile.lock_version,display_name:profile.display_name,
    public_slug:profile.public_slug,city_regency:profile.city_regency,province:profile.province,
    short_description:profile.short_description,website_url:profile.website_url,logo_media_id:logo.id});
  await remove(oldLogo);
  await assert.rejects(scope(actors.outsider.id,tx=>tx.$queryRaw`SELECT public.ruwang_arsip_sj_media_referenced(${original}::text)`));
  await assert.rejects(scope(actors.denied.id,tx=>tx.$queryRaw`SELECT public.ruwang_arsip_sj_media_referenced(${logo.id}::text)`));
  checks.push({check:'old approved profile logo protected after new draft; unrelated division and denied callers cannot inspect reference boolean',pass:true,url:origin});
  profile=await http('maker','post','/profile/submit',{expected_version:profile.lock_version});
  await http('checker','post','/profile/verify',{expected_version:profile.lock_version});
  await cycle();
};
