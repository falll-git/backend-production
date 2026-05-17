UPDATE "users"
SET "refresh_token" = NULL,
    "refresh_token_expires_at" = NULL
WHERE "refresh_token" IS NOT NULL
   OR "refresh_token_expires_at" IS NOT NULL;

ALTER TABLE "users" DROP COLUMN IF EXISTS "refresh_token";
ALTER TABLE "users" DROP COLUMN IF EXISTS "refresh_token_expires_at";
