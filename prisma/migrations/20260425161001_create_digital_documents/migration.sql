-- CreateTable
CREATE TABLE "digital_documents" (
    "id" TEXT NOT NULL,
    "storage_id" TEXT NOT NULL,
    "is_restricted" BOOLEAN NOT NULL DEFAULT false,
    "document_type_id" TEXT NOT NULL,
    "document_number" TEXT NOT NULL,
    "document_name" TEXT NOT NULL,
    "description" TEXT,
    "file" TEXT,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,
    "deleted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "digital_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "digital_documents_document_number_key" ON "digital_documents"("document_number");

-- AddForeignKey
ALTER TABLE "digital_documents" ADD CONSTRAINT "digital_documents_storage_id_fkey" FOREIGN KEY ("storage_id") REFERENCES "storages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_documents" ADD CONSTRAINT "digital_documents_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_documents" ADD CONSTRAINT "digital_documents_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_documents" ADD CONSTRAINT "digital_documents_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_documents" ADD CONSTRAINT "digital_documents_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
