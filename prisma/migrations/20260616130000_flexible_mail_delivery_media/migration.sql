ALTER TABLE "outgoing_mails"
  ALTER COLUMN "delivery_media" TYPE TEXT
  USING UPPER("delivery_media"::TEXT);

DROP TYPE IF EXISTS "outgoing_mail_delivery_media";
