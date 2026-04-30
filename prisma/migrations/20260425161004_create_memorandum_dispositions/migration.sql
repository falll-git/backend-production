-- CreateEnum
CREATE TYPE "disposition_statuses" AS ENUM ('NEW', 'IN_PROGRESS', 'COMPLETED', 'FORWARDED');

-- CreateTable
CREATE TABLE "memorandum_dispositions" (
    "id" TEXT NOT NULL,
    "memorandums_id" TEXT NOT NULL,
    "sender_id" TEXT,
    "receiver_id" TEXT NOT NULL,
    "parent_disposition_id" TEXT,
    "note" TEXT,
    "start_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "status" "disposition_statuses" NOT NULL DEFAULT 'NEW',
    "is_complete" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "disposed_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memorandum_dispositions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memorandum_dispositions_memorandums_id_status_idx" ON "memorandum_dispositions"("memorandums_id", "status");

-- CreateIndex
CREATE INDEX "memorandum_dispositions_parent_disposition_id_idx" ON "memorandum_dispositions"("parent_disposition_id");

-- AddForeignKey
ALTER TABLE "memorandum_dispositions" ADD CONSTRAINT "memorandum_dispositions_memorandums_id_fkey" FOREIGN KEY ("memorandums_id") REFERENCES "memorandums"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memorandum_dispositions" ADD CONSTRAINT "memorandum_dispositions_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memorandum_dispositions" ADD CONSTRAINT "memorandum_dispositions_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memorandum_dispositions" ADD CONSTRAINT "memorandum_dispositions_parent_disposition_id_fkey" FOREIGN KEY ("parent_disposition_id") REFERENCES "memorandum_dispositions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
