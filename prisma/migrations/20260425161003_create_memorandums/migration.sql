-- CreateTable
CREATE TABLE "memorandums" (
    "id" TEXT NOT NULL,
    "division_id" TEXT NOT NULL,
    "memo_number" TEXT NOT NULL,
    "memo_date" TIMESTAMP(3) NOT NULL,
    "received_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3),
    "regarding" TEXT,
    "description" TEXT,
    "file" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "updated_by" TEXT,
    "deleted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "memorandums_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "memorandums" ADD CONSTRAINT "memorandums_division_id_fkey" FOREIGN KEY ("division_id") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memorandums" ADD CONSTRAINT "memorandums_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memorandums" ADD CONSTRAINT "memorandums_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memorandums" ADD CONSTRAINT "memorandums_deleted_by_fkey" FOREIGN KEY ("deleted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
