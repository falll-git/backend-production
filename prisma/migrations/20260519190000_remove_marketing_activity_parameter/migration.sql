ALTER TABLE "debtor_marketing_activities"
  DROP CONSTRAINT IF EXISTS "debtor_marketing_activities_marketing_activity_type_id_fkey";

DROP INDEX IF EXISTS "debtor_marketing_activities_marketing_activity_type_id_idx";

ALTER TABLE "debtor_marketing_activities"
  DROP COLUMN IF EXISTS "marketing_activity_type_id";

DROP TABLE IF EXISTS "marketing_activity_types";
