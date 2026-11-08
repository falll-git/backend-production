const {createBasePrismaClient}=require('../../config/prisma-client-factory');
const {AppError}=require('../../utils/errors');
let client;

async function getReviewDatabase() {
  const url=String(process.env.SJ_REVIEW_DATABASE_URL || '').trim();
  if(!url) throw new AppError('Koneksi penerima keputusan pusat belum disiapkan.',503);
  if(!client) client=createBasePrismaClient({connectionString:url,applicationName:'ruwang-sj-review',maxKey:'DB_SYSTEM_POOL_MAX'});
  // Verify on every request so revoking a role cannot leave a cached bypass.
  const [role]=await client.$queryRaw`
    SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,
      pg_has_role(current_user,'ruwang_sj_review','member') reviewer,
      EXISTS(SELECT 1 FROM pg_roles p WHERE p.rolname<>current_user
        AND (p.rolsuper OR p.rolbypassrls OR p.rolname IN ('ruwang_arsip_app','ruwang_sj_worker'))
        AND pg_has_role(current_user,p.oid,'member')) unsafe_membership,
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) owns_tables
    FROM pg_roles WHERE rolname=current_user`;
  if(!role || !role.reviewer || role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole || role.unsafe_membership || role.owns_tables) {
    throw new AppError('Hak akses penerima keputusan pusat belum sesuai.',503);
  }
  return client;
}
async function disconnect(){if(client){await client.$disconnect();client=null;}}
module.exports={getReviewDatabase,disconnect};
