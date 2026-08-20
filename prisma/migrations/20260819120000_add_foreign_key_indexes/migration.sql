-- Add leading indexes for foreign-key columns that are used for relation joins
-- or parent-row integrity checks. These indexes are additive and do not alter data.
CREATE INDEX "notifications_created_by_idx" ON "notifications"("created_by");

CREATE INDEX "incoming_mails_updated_by_idx" ON "incoming_mails"("updated_by");
CREATE INDEX "incoming_mails_deleted_by_idx" ON "incoming_mails"("deleted_by");

CREATE INDEX "digital_documents_updated_by_idx" ON "digital_documents"("updated_by");
CREATE INDEX "digital_documents_deleted_by_idx" ON "digital_documents"("deleted_by");

CREATE INDEX "storage_activity_logs_actor_id_idx" ON "storage_activity_logs"("actor_id");

CREATE INDEX "outgoing_mails_updated_by_idx" ON "outgoing_mails"("updated_by");
CREATE INDEX "outgoing_mails_deleted_by_idx" ON "outgoing_mails"("deleted_by");

CREATE INDEX "memorandums_updated_by_idx" ON "memorandums"("updated_by");
CREATE INDEX "memorandums_deleted_by_idx" ON "memorandums"("deleted_by");

CREATE INDEX "legal_print_histories_template_id_idx" ON "legal_print_histories"("template_id");
CREATE INDEX "legal_print_histories_numbering_template_id_idx" ON "legal_print_histories"("numbering_template_id");
