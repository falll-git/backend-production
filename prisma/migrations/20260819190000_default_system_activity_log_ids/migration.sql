ALTER TABLE public.system_activity_logs
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
