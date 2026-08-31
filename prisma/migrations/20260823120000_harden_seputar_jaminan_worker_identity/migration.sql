-- Worker access must only be granted to a dedicated least-privilege login.
-- PostgreSQL superusers are implicitly treated as members of every role by
-- pg_has_role(), so membership alone is not a safe worker identity check.
CREATE OR REPLACE FUNCTION public.ruwang_arsip_sj_is_worker()
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles caller
    WHERE caller.rolname = session_user
      AND NOT caller.rolsuper
      AND NOT caller.rolbypassrls
      AND pg_has_role(caller.rolname, 'ruwang_sj_worker', 'member')
  )
$$;
