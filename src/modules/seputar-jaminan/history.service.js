const prisma=require('../../config/prisma');
const {AppError}=require('../../utils/errors');
const cursor=require('./readCursor');

// Read-only, explicitly scoped histories. No payload_json, actor subjects,
// credentials, storage paths or inferred public visibility are returned.
exports.read=async(kind,id,query)=>{
  const parent=kind==='publication'?await prisma.sj_publications.findUnique({where:{id},select:{id:true,current_version_id:true,published_version_id:true}})
    :kind==='contact'?await prisma.sj_whatsapp_contacts.findUnique({where:{id},select:{id:true,current_version_id:true}})
      :await prisma.sj_public_profiles.findFirst({select:{id:true,current_version_id:true}});
  if(!parent)throw new AppError('Data tidak ditemukan.',404);
  const scope={kind,id:parent.id,stream:query.stream},position=cursor.decode(query.cursor,scope);
  if(query.stream==='reviews'){
    if(kind!=='publication')throw new AppError('Riwayat pemeriksaan ini hanya tersedia untuk katalog.',422);
    const rows=await prisma.sj_publication_reviews.findMany({where:{AND:[{publication_id:parent.id},...(position?[position]:[])]},
      orderBy:[{created_at:'desc'},{id:'desc'}],take:query.limit+1,
      select:{id:true,publication_version_id:true,action:true,reason:true,created_at:true}});
    return cursor.page(rows,query.limit,scope,row=>({...row,kind:'REVIEW'}));
  }
  const contact=kind==='contact',model=kind==='publication'?'sj_publication_versions':contact?'sj_whatsapp_contact_versions':'sj_public_profile_versions';
  const parentKey=kind==='publication'?'publication_id':contact?'contact_id':'profile_id';
  const rows=await prisma[model].findMany({where:{AND:[{[parentKey]:parent.id},...(position?[position]:[])]},orderBy:[{created_at:'desc'},{id:'desc'}],take:query.limit+1,
    select:{id:true,version_number:true,state:true,created_at:true,submitted_at:true,rejection_reason:true,[contact?'verified_at':'approved_at']:true,[contact?'checksum':'payload_checksum']:true}});
  return cursor.page(rows,query.limit,scope,row=>({id:row.id,kind:'VERSION',version_number:row.version_number,state:row.state,
    created_at:row.created_at,submitted_at:row.submitted_at,approved_at:contact?row.verified_at:row.approved_at,
    rejection_reason:row.rejection_reason,checksum:contact?row.checksum:row.payload_checksum,
    bank_working_version:kind==='publication'?row.id===parent.current_version_id:null,
    bank_approved_version:row.id===(kind==='publication'?parent.published_version_id:parent.current_version_id),
    public_version_evidence:'UNAVAILABLE'}));
};
