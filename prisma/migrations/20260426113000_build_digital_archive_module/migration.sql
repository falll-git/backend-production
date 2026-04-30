-- CreateEnum
CREATE TYPE "digital_document_access_request_statuses" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "digital_document_loan_statuses" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'BORROWED', 'RETURNED');

-- CreateEnum
CREATE TYPE "digital_document_activity_actions" AS ENUM ('CREATED', 'UPDATED', 'STORAGE_MOVED', 'DELETED', 'ACCESS_REQUESTED', 'ACCESS_APPROVED', 'ACCESS_REJECTED', 'LOAN_REQUESTED', 'LOAN_APPROVED', 'LOAN_REJECTED', 'LOAN_HANDED_OVER', 'LOAN_RETURNED');

-- DropForeignKey
ALTER TABLE "digital_documents" DROP CONSTRAINT IF EXISTS "digital_documents_created_by_fkey";

-- AlterTable
ALTER TABLE "digital_documents" DROP COLUMN IF EXISTS "resrtice_document",
DROP COLUMN IF EXISTS "status",
ADD COLUMN IF NOT EXISTS "is_restricted" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "created_by" SET NOT NULL;

-- CreateTable
CREATE TABLE "digital_document_access_requests" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "status" "digital_document_access_request_statuses" NOT NULL DEFAULT 'PENDING',
    "request_reason" TEXT NOT NULL,
    "action_note" TEXT,
    "expires_at" TIMESTAMP(3),
    "acted_by" TEXT,
    "acted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digital_document_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_document_loans" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "borrower_id" TEXT NOT NULL,
    "status" "digital_document_loan_statuses" NOT NULL DEFAULT 'PENDING',
    "request_reason" TEXT NOT NULL,
    "requested_start_date" TIMESTAMP(3) NOT NULL,
    "requested_due_date" TIMESTAMP(3) NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "approval_note" TEXT,
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_note" TEXT,
    "handed_over_by" TEXT,
    "handover_at" TIMESTAMP(3),
    "handover_note" TEXT,
    "returned_by" TEXT,
    "returned_at" TIMESTAMP(3),
    "return_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digital_document_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_document_activity_logs" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" "digital_document_activity_actions" NOT NULL,
    "from_storage_id" TEXT,
    "to_storage_id" TEXT,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digital_document_activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "digital_document_access_requests_document_id_status_idx" ON "digital_document_access_requests"("document_id", "status");

-- CreateIndex
CREATE INDEX "digital_document_access_requests_requester_id_status_idx" ON "digital_document_access_requests"("requester_id", "status");

-- CreateIndex
CREATE INDEX "digital_document_access_requests_owner_id_status_idx" ON "digital_document_access_requests"("owner_id", "status");

-- CreateIndex
CREATE INDEX "digital_document_loans_document_id_status_idx" ON "digital_document_loans"("document_id", "status");

-- CreateIndex
CREATE INDEX "digital_document_loans_borrower_id_status_idx" ON "digital_document_loans"("borrower_id", "status");

-- CreateIndex
CREATE INDEX "digital_document_loans_status_requested_due_date_idx" ON "digital_document_loans"("status", "requested_due_date");

-- CreateIndex
CREATE INDEX "digital_document_activity_logs_document_id_created_at_idx" ON "digital_document_activity_logs"("document_id", "created_at");

-- CreateIndex
CREATE INDEX "digital_document_activity_logs_action_created_at_idx" ON "digital_document_activity_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "digital_document_activity_logs_from_storage_id_idx" ON "digital_document_activity_logs"("from_storage_id");

-- CreateIndex
CREATE INDEX "digital_document_activity_logs_to_storage_id_idx" ON "digital_document_activity_logs"("to_storage_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "digital_documents_document_number_key" ON "digital_documents"("document_number");

-- AddForeignKey
ALTER TABLE "digital_documents" ADD CONSTRAINT "digital_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_document_access_requests" ADD CONSTRAINT "digital_document_access_requests_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "digital_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_document_access_requests" ADD CONSTRAINT "digital_document_access_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_document_access_requests" ADD CONSTRAINT "digital_document_access_requests_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_document_access_requests" ADD CONSTRAINT "digital_document_access_requests_acted_by_fkey" FOREIGN KEY ("acted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_document_loans" ADD CONSTRAINT "digital_document_loans_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "digital_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_document_loans" ADD CONSTRAINT "digital_document_loans_borrower_id_fkey" FOREIGN KEY ("borrower_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_document_loans" ADD CONSTRAINT "digital_document_loans_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_document_loans" ADD CONSTRAINT "digital_document_loans_rejected_by_fkey" FOREIGN KEY ("rejected_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_document_loans" ADD CONSTRAINT "digital_document_loans_handed_over_by_fkey" FOREIGN KEY ("handed_over_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_document_loans" ADD CONSTRAINT "digital_document_loans_returned_by_fkey" FOREIGN KEY ("returned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_document_activity_logs" ADD CONSTRAINT "digital_document_activity_logs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "digital_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_document_activity_logs" ADD CONSTRAINT "digital_document_activity_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_document_activity_logs" ADD CONSTRAINT "digital_document_activity_logs_from_storage_id_fkey" FOREIGN KEY ("from_storage_id") REFERENCES "storages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_document_activity_logs" ADD CONSTRAINT "digital_document_activity_logs_to_storage_id_fkey" FOREIGN KEY ("to_storage_id") REFERENCES "storages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
