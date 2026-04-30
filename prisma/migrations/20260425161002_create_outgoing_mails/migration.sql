-- CreateTable
CREATE TABLE "outgoing_mails" (
    "id" TEXT NOT NULL,
    "letter_prioritie_id" TEXT NOT NULL,
    "delivery_media" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "send_date" TIMESTAMP(3) NOT NULL,
    "address" TEXT NOT NULL,
    "mail_number" TEXT NOT NULL,
    "file" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "updated_by" TEXT,
    "deleted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "outgoing_mails_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "outgoing_mails" ADD CONSTRAINT "outgoing_mails_letter_prioritie_id_fkey" FOREIGN KEY ("letter_prioritie_id") REFERENCES "letter_priorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_mails" ADD CONSTRAINT "outgoing_mails_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_mails" ADD CONSTRAINT "outgoing_mails_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outgoing_mails" ADD CONSTRAINT "outgoing_mails_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
