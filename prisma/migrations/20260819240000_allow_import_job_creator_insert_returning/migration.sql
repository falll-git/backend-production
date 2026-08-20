-- Prisma creates import jobs with INSERT ... RETURNING. PostgreSQL also applies
-- the SELECT policy to the returned row, while the existing id-based helper
-- cannot reliably observe that same row during the INSERT statement.
-- The create policy already requires created_by to match the authenticated
-- runtime user and checks the import create permission. This direct creator
-- predicate only lets that authorized actor read the job it just created.

DROP POLICY IF EXISTS debtor_import_jobs_read ON public.debtor_import_jobs;
CREATE POLICY debtor_import_jobs_read ON public.debtor_import_jobs
  FOR SELECT USING (
    deleted_at IS NULL
    AND (
      created_by = public.ruwang_arsip_current_user_id()
      OR public.ruwang_arsip_can_read_import_job(id)
    )
  );
