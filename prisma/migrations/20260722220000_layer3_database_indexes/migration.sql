-- Indexes selected from verified application filters and relation traversal.
CREATE INDEX "users_role_id_idx" ON "users"("role_id");
CREATE INDEX "users_division_id_idx" ON "users"("division_id");
CREATE INDEX "role_menus_menu_id_idx" ON "role_menus"("menu_id");

CREATE INDEX "incoming_mails_created_by_idx" ON "incoming_mails"("created_by");
CREATE INDEX "incoming_mail_dispositions_receiver_id_status_idx"
  ON "incoming_mail_dispositions"("receiver_id", "status");
CREATE INDEX "incoming_mail_dispositions_sender_id_idx"
  ON "incoming_mail_dispositions"("sender_id");

CREATE INDEX "memorandums_created_by_idx" ON "memorandums"("created_by");
CREATE INDEX "memorandum_dispositions_receiver_id_status_idx"
  ON "memorandum_dispositions"("receiver_id", "status");
CREATE INDEX "memorandum_dispositions_sender_id_idx"
  ON "memorandum_dispositions"("sender_id");

CREATE INDEX "outgoing_mails_created_by_idx" ON "outgoing_mails"("created_by");
CREATE INDEX "digital_document_access_requests_acted_by_idx"
  ON "digital_document_access_requests"("acted_by");
CREATE INDEX "digital_document_loans_approved_by_idx"
  ON "digital_document_loans"("approved_by");
CREATE INDEX "digital_document_loans_rejected_by_idx"
  ON "digital_document_loans"("rejected_by");
CREATE INDEX "digital_document_loans_handed_over_by_idx"
  ON "digital_document_loans"("handed_over_by");
CREATE INDEX "digital_document_loans_returned_by_idx"
  ON "digital_document_loans"("returned_by");

CREATE INDEX "debtor_external_records_import_job_id_idx"
  ON "debtor_external_records"("import_job_id");
