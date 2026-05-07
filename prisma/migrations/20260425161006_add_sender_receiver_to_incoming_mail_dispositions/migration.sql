ALTER TABLE "incoming_mail_dispositions" ADD COLUMN "sender_id" TEXT;

ALTER TABLE "incoming_mail_dispositions" ADD COLUMN "receiver_id" TEXT NOT NULL DEFAULT '';

ALTER TABLE "incoming_mail_dispositions" DROP CONSTRAINT IF EXISTS "incoming_mail_dispositions_dispositions_id_fkey";

ALTER TABLE "incoming_mail_dispositions" DROP COLUMN IF EXISTS "dispositions_id";

ALTER TABLE "incoming_mail_dispositions" ADD CONSTRAINT "incoming_mail_dispositions_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "incoming_mail_dispositions" ADD CONSTRAINT "incoming_mail_dispositions_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
