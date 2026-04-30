-- AlterTable
ALTER TABLE "incoming_mail_dispositions" RENAME COLUMN "incoiming_mails_id" TO "incoming_mails_id";

-- Drop the old unique index with the typo
DROP INDEX IF EXISTS "incoming_mail_dispositions_incoiming_mails_id_dispositions__key";

-- Drop the old foreign key with the typo
ALTER TABLE "incoming_mail_dispositions" DROP CONSTRAINT IF EXISTS "incoming_mail_dispositions_incoiming_mails_id_fkey";

-- Add the correct foreign key
ALTER TABLE "incoming_mail_dispositions" ADD CONSTRAINT "incoming_mail_dispositions_incoming_mails_id_fkey" FOREIGN KEY ("incoming_mails_id") REFERENCES "incoming_mails"("id") ON DELETE CASCADE ON UPDATE CASCADE;
