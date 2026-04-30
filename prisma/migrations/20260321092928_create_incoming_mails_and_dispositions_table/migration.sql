-- CreateTable
CREATE TABLE "incoming_mails" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "receive_date" TIMESTAMP(3) NOT NULL,
    "address" TEXT NOT NULL,
    "mail_number" TEXT NOT NULL,
    "file" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incoming_mails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispositions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispositions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incoming_mail_dispositions" (
    "id" TEXT NOT NULL,
    "incoiming_mails_id" TEXT NOT NULL,
    "dispositions_id" TEXT NOT NULL,
    "note" TEXT,
    "start_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "is_complete" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "disposed_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incoming_mail_dispositions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "incoming_mail_dispositions_incoiming_mails_id_dispositions__key" ON "incoming_mail_dispositions"("incoiming_mails_id", "dispositions_id");

-- AddForeignKey
ALTER TABLE "incoming_mail_dispositions" ADD CONSTRAINT "incoming_mail_dispositions_incoiming_mails_id_fkey" FOREIGN KEY ("incoiming_mails_id") REFERENCES "incoming_mails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_mail_dispositions" ADD CONSTRAINT "incoming_mail_dispositions_dispositions_id_fkey" FOREIGN KEY ("dispositions_id") REFERENCES "dispositions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
