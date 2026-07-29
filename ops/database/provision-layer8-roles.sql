\set ON_ERROR_STOP on

\if :{?database_name}
\else
  \echo 'Gunakan -v database_name=...'
  \quit 2
\endif
\if :{?app_password}
\else
  \echo 'Gunakan -v app_password=...'
  \quit 2
\endif
\if :{?system_password}
\else
  \echo 'Gunakan -v system_password=...'
  \quit 2
\endif
\if :{?migration_role}
\else
  \echo 'Gunakan -v migration_role=...'
  \quit 2
\endif

SELECT format(
  'CREATE ROLE ruwang_arsip_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_app')
\gexec

SELECT format(
  'CREATE ROLE ruwang_arsip_system LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS',
  :'system_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_system')
\gexec

SELECT 'CREATE ROLE ruwang_arsip_policy NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ruwang_arsip_policy')
\gexec

ALTER ROLE ruwang_arsip_app
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
  PASSWORD :'app_password';
ALTER ROLE ruwang_arsip_system
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS
  PASSWORD :'system_password';
ALTER ROLE ruwang_arsip_policy
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;

SELECT format('GRANT ruwang_arsip_policy TO %I', :'migration_role')
\gexec

GRANT CONNECT ON DATABASE :"database_name" TO ruwang_arsip_app, ruwang_arsip_system;
GRANT USAGE ON SCHEMA public TO ruwang_arsip_app, ruwang_arsip_system;
GRANT USAGE, CREATE ON SCHEMA public TO ruwang_arsip_policy;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO ruwang_arsip_app, ruwang_arsip_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO ruwang_arsip_app, ruwang_arsip_system;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ruwang_arsip_policy;
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
  TO ruwang_arsip_app, ruwang_arsip_system;
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES
  TO ruwang_arsip_app, ruwang_arsip_system;
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public
  GRANT SELECT ON TABLES TO ruwang_arsip_policy;

SELECT format(
  'GRANT EXECUTE ON FUNCTION %s TO ruwang_arsip_app, ruwang_arsip_policy',
  function_data.oid::regprocedure
)
FROM pg_proc function_data
JOIN pg_namespace namespace_data ON namespace_data.oid = function_data.pronamespace
WHERE namespace_data.nspname = 'public'
  AND function_data.proname LIKE 'ruwang_arsip_%'
\gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
