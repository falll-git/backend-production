ALTER TABLE "incoming_mails"
ADD COLUMN "division_id" TEXT;

UPDATE "incoming_mails" AS im
SET "division_id" = seeded."division_id"
FROM (
  SELECT DISTINCT ON (imd."incoming_mails_id")
    imd."incoming_mails_id",
    u."division_id"
  FROM "incoming_mail_dispositions" AS imd
  INNER JOIN "users" AS u
    ON u."id" = imd."receiver_id"
  WHERE u."division_id" IS NOT NULL
  ORDER BY imd."incoming_mails_id", imd."disposed_at" ASC, imd."id" ASC
) AS seeded
WHERE im."id" = seeded."incoming_mails_id";

ALTER TABLE "incoming_mails"
ALTER COLUMN "division_id" SET NOT NULL;

ALTER TABLE "incoming_mails"
ADD CONSTRAINT "incoming_mails_division_id_fkey"
FOREIGN KEY ("division_id") REFERENCES "divisions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "incoming_mails_division_id_idx"
ON "incoming_mails"("division_id");
