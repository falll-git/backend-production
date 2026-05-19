ALTER TABLE "debtor_marketing_activities"
  ADD COLUMN IF NOT EXISTS "timeline_group_id" TEXT,
  ADD COLUMN IF NOT EXISTS "related_activity_id" TEXT;

CREATE INDEX IF NOT EXISTS "debtor_marketing_activities_timeline_group_id_idx"
  ON "debtor_marketing_activities"("timeline_group_id");

CREATE INDEX IF NOT EXISTS "debtor_marketing_activities_related_activity_id_idx"
  ON "debtor_marketing_activities"("related_activity_id");
