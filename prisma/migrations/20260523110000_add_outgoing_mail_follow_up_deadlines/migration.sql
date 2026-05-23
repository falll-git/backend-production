ALTER TABLE "outgoing_mails"
  ADD COLUMN IF NOT EXISTS "send_due_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "response_due_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "follow_up_note" TEXT;

CREATE INDEX IF NOT EXISTS "outgoing_mails_send_due_date_idx"
  ON "outgoing_mails"("send_due_date");

CREATE INDEX IF NOT EXISTS "outgoing_mails_response_due_date_idx"
  ON "outgoing_mails"("response_due_date");
