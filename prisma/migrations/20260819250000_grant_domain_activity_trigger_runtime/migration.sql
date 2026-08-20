-- Keep PUBLIC excluded while allowing the runtime application role to execute
-- the trigger function attached to the domain activity-log tables. The
-- function remains SECURITY DEFINER, owned by the NOLOGIN policy role, and has
-- a fixed search_path; the application cannot call it with arbitrary input
-- because trigger functions receive their row exclusively from PostgreSQL.

REVOKE ALL ON FUNCTION public.ruwang_arsip_mirror_domain_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ruwang_arsip_mirror_domain_activity()
  TO ruwang_arsip_app;
