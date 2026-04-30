/*
  Warnings:

  - Added the required column `letter_prioritie_id` to the `incoming_mails` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "incoming_mails" ADD COLUMN     "letter_prioritie_id" TEXT NOT NULL,
ADD COLUMN     "regarding" TEXT;

-- AddForeignKey
ALTER TABLE "incoming_mails" ADD CONSTRAINT "incoming_mails_letter_prioritie_id_fkey" FOREIGN KEY ("letter_prioritie_id") REFERENCES "letter_priorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
