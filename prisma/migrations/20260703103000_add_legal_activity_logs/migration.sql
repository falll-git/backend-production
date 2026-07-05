CREATE TABLE "legal_activity_logs" (
  "id" TEXT NOT NULL,
  "actor_id" TEXT,
  "action" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "debtor_id" TEXT,
  "contract_id" TEXT,
  "collateral_id" TEXT,
  "third_party_id" TEXT,
  "deposit_id" TEXT,
  "deposit_transaction_id" TEXT,
  "title" TEXT,
  "before_data" JSONB,
  "after_data" JSONB,
  "metadata" JSONB,
  "request_ip" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "legal_activity_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "legal_activity_logs_actor_id_created_at_idx" ON "legal_activity_logs"("actor_id", "created_at");
CREATE INDEX "legal_activity_logs_action_created_at_idx" ON "legal_activity_logs"("action", "created_at");
CREATE INDEX "legal_activity_logs_source_created_at_idx" ON "legal_activity_logs"("source", "created_at");
CREATE INDEX "legal_activity_logs_entity_type_entity_id_idx" ON "legal_activity_logs"("entity_type", "entity_id");
CREATE INDEX "legal_activity_logs_debtor_id_created_at_idx" ON "legal_activity_logs"("debtor_id", "created_at");
CREATE INDEX "legal_activity_logs_contract_id_created_at_idx" ON "legal_activity_logs"("contract_id", "created_at");
CREATE INDEX "legal_activity_logs_collateral_id_created_at_idx" ON "legal_activity_logs"("collateral_id", "created_at");
CREATE INDEX "legal_activity_logs_third_party_id_created_at_idx" ON "legal_activity_logs"("third_party_id", "created_at");
CREATE INDEX "legal_activity_logs_deposit_id_created_at_idx" ON "legal_activity_logs"("deposit_id", "created_at");
CREATE INDEX "legal_activity_logs_deposit_transaction_id_created_at_idx" ON "legal_activity_logs"("deposit_transaction_id", "created_at");

ALTER TABLE "legal_activity_logs"
  ADD CONSTRAINT "legal_activity_logs_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "legal_activity_logs"
  ADD CONSTRAINT "legal_activity_logs_debtor_id_fkey"
  FOREIGN KEY ("debtor_id") REFERENCES "digital_debtors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "legal_activity_logs"
  ADD CONSTRAINT "legal_activity_logs_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "debtor_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "legal_activity_logs"
  ADD CONSTRAINT "legal_activity_logs_collateral_id_fkey"
  FOREIGN KEY ("collateral_id") REFERENCES "debtor_collaterals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "legal_activity_logs"
  ADD CONSTRAINT "legal_activity_logs_third_party_id_fkey"
  FOREIGN KEY ("third_party_id") REFERENCES "third_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "legal_activity_logs"
  ADD CONSTRAINT "legal_activity_logs_deposit_id_fkey"
  FOREIGN KEY ("deposit_id") REFERENCES "legal_deposits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "legal_activity_logs"
  ADD CONSTRAINT "legal_activity_logs_deposit_transaction_id_fkey"
  FOREIGN KEY ("deposit_transaction_id") REFERENCES "legal_deposit_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
