ALTER TABLE "users"
ADD COLUMN "deactivated_at" TIMESTAMP(3),
ADD COLUMN "deactivated_by" TEXT,
ADD COLUMN "deactivation_reason" TEXT,
ADD COLUMN "reactivated_at" TIMESTAMP(3),
ADD COLUMN "reactivated_by" TEXT,
ADD COLUMN "reactivation_reason" TEXT;

ALTER TABLE "users"
ADD CONSTRAINT "users_deactivated_by_fkey"
FOREIGN KEY ("deactivated_by") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users"
ADD CONSTRAINT "users_reactivated_by_fkey"
FOREIGN KEY ("reactivated_by") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "users_deactivated_by_idx" ON "users"("deactivated_by");
CREATE INDEX "users_reactivated_by_idx" ON "users"("reactivated_by");
