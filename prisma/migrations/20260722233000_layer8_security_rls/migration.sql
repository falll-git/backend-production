DROP POLICY IF EXISTS "refresh_tokens_owner_isolation" ON "refresh_tokens";
DROP POLICY IF EXISTS "auth_action_tokens_owner_isolation" ON "auth_action_tokens";
DROP POLICY IF EXISTS "notifications_recipient_isolation" ON "notifications";
DROP FUNCTION IF EXISTS public.ruwang_arsip_current_user_id();

CREATE FUNCTION public.ruwang_arsip_current_user_id()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN current_setting('app.current_user_id', true) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN current_setting('app.current_user_id', true)
    ELSE NULL
  END
$$;

ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "refresh_tokens_owner_isolation" ON "refresh_tokens";
CREATE POLICY "refresh_tokens_owner_isolation"
  ON "refresh_tokens"
  USING ("user_id" = public.ruwang_arsip_current_user_id())
  WITH CHECK ("user_id" = public.ruwang_arsip_current_user_id());

ALTER TABLE "auth_action_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_action_tokens" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_action_tokens_owner_isolation" ON "auth_action_tokens";
CREATE POLICY "auth_action_tokens_owner_isolation"
  ON "auth_action_tokens"
  USING ("user_id" = public.ruwang_arsip_current_user_id())
  WITH CHECK ("user_id" = public.ruwang_arsip_current_user_id());

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_recipient_isolation" ON "notifications";
CREATE POLICY "notifications_recipient_isolation"
  ON "notifications"
  USING ("recipient_id" = public.ruwang_arsip_current_user_id())
  WITH CHECK ("recipient_id" = public.ruwang_arsip_current_user_id());
