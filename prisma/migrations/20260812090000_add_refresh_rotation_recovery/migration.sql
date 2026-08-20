ALTER TABLE "refresh_tokens"
ADD COLUMN "replaced_by_token_id" TEXT;

CREATE INDEX "refresh_tokens_replaced_by_token_id_idx"
ON "refresh_tokens"("replaced_by_token_id");
