-- Session metadata supports single-session enforcement, token revocation,
-- and security auditing. It is not exposed as account device management.
ALTER TABLE "refresh_tokens"
ADD COLUMN "ip_address" TEXT,
ADD COLUMN "user_agent" TEXT,
ADD COLUMN "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "refresh_tokens_user_id_last_used_at_idx"
ON "refresh_tokens"("user_id", "last_used_at");

-- PUBLIC must not inherit access to current or future application objects.
-- Runtime and migration roles receive explicit grants during VPS provisioning.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;
