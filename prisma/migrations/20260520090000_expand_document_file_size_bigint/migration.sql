ALTER TABLE "incoming_mails"
  ALTER COLUMN "file_size_bytes" TYPE BIGINT USING "file_size_bytes"::BIGINT,
  ALTER COLUMN "watermark_file_size_bytes" TYPE BIGINT USING "watermark_file_size_bytes"::BIGINT;

ALTER TABLE "digital_documents"
  ALTER COLUMN "watermark_file_size_bytes" TYPE BIGINT USING "watermark_file_size_bytes"::BIGINT;

ALTER TABLE "document_files"
  ALTER COLUMN "size_bytes" TYPE BIGINT USING "size_bytes"::BIGINT;

ALTER TABLE "outgoing_mails"
  ALTER COLUMN "file_size_bytes" TYPE BIGINT USING "file_size_bytes"::BIGINT,
  ALTER COLUMN "watermark_file_size_bytes" TYPE BIGINT USING "watermark_file_size_bytes"::BIGINT;

ALTER TABLE "memorandums"
  ALTER COLUMN "file_size_bytes" TYPE BIGINT USING "file_size_bytes"::BIGINT,
  ALTER COLUMN "watermark_file_size_bytes" TYPE BIGINT USING "watermark_file_size_bytes"::BIGINT;
