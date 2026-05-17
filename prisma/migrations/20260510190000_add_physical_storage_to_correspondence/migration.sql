ALTER TABLE "incoming_mails" ADD COLUMN "storage_id" TEXT NOT NULL;
ALTER TABLE "outgoing_mails" ADD COLUMN "storage_id" TEXT NOT NULL;
ALTER TABLE "memorandums" ADD COLUMN "storage_id" TEXT NOT NULL;

ALTER TABLE "incoming_mails"
  ADD CONSTRAINT "incoming_mails_storage_id_fkey"
  FOREIGN KEY ("storage_id") REFERENCES "storages"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "outgoing_mails"
  ADD CONSTRAINT "outgoing_mails_storage_id_fkey"
  FOREIGN KEY ("storage_id") REFERENCES "storages"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "memorandums"
  ADD CONSTRAINT "memorandums_storage_id_fkey"
  FOREIGN KEY ("storage_id") REFERENCES "storages"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "incoming_mails_storage_id_idx" ON "incoming_mails"("storage_id");
CREATE INDEX "outgoing_mails_storage_id_idx" ON "outgoing_mails"("storage_id");
CREATE INDEX "memorandums_storage_id_idx" ON "memorandums"("storage_id");
