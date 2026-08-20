-- The NOLOGIN policy role owns the guarded soft-delete function. Grant only
-- the three columns that function is allowed to change; it receives no broad
-- table-write privilege.
GRANT UPDATE (deleted_by, deleted_at, updated_at)
  ON public.digital_documents
  TO ruwang_arsip_policy;
