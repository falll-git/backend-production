ALTER TABLE "incoming_mails" ADD COLUMN     "letter_prioritie_id" TEXT NOT NULL,
ADD COLUMN     "regarding" TEXT;

ALTER TABLE "incoming_mails" ADD CONSTRAINT "incoming_mails_letter_prioritie_id_fkey" FOREIGN KEY ("letter_prioritie_id") REFERENCES "letter_priorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
