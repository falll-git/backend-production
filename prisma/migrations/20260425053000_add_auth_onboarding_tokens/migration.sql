CREATE TYPE "auth_action_token_types" AS ENUM ('INVITE', 'RESET_PASSWORD');

ALTER TABLE "users"
ADD COLUMN "email_verified_at" TIMESTAMP(3),
ADD COLUMN "password_set_at" TIMESTAMP(3);

UPDATE "users"
SET
  "email_verified_at" = COALESCE("email_verified_at", "created_at"),
  "password_set_at" = COALESCE("password_set_at", "created_at");

CREATE TABLE "auth_action_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "auth_action_token_types" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_action_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_action_tokens_token_hash_key" ON "auth_action_tokens"("token_hash");

CREATE INDEX "auth_action_tokens_user_id_type_idx" ON "auth_action_tokens"("user_id", "type");

CREATE INDEX "auth_action_tokens_expires_at_idx" ON "auth_action_tokens"("expires_at");

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

ALTER TABLE "auth_action_tokens"
ADD CONSTRAINT "auth_action_tokens_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
