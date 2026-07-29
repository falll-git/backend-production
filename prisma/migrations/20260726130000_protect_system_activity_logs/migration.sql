ALTER TABLE public.system_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_activity_logs FORCE ROW LEVEL SECURITY;

CREATE POLICY system_activity_logs_authorized_read
  ON public.system_activity_logs
  FOR SELECT
  USING (
    public.ruwang_arsip_has_menu_permission(
      ARRAY['/dashboard/activity-centre']::text[],
      'read'
    )
  );

-- Writes intentionally have no application-role policy. The activity recorder
-- uses the separately provisioned system role so request code cannot forge or
-- alter audit history through the ordinary database connection.
