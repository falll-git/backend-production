CREATE TABLE "mail_delivery_media" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "deleted_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_delivery_media_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collateral_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "deleted_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collateral_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "restructuring_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "deleted_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restructuring_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_process_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "deleted_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_process_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mail_delivery_media_code_key" ON "mail_delivery_media"("code");
CREATE UNIQUE INDEX "mail_delivery_media_name_key" ON "mail_delivery_media"("name");
CREATE INDEX "mail_delivery_media_is_active_idx" ON "mail_delivery_media"("is_active");
CREATE INDEX "mail_delivery_media_deleted_at_idx" ON "mail_delivery_media"("deleted_at");

CREATE UNIQUE INDEX "collateral_types_code_key" ON "collateral_types"("code");
CREATE UNIQUE INDEX "collateral_types_name_key" ON "collateral_types"("name");
CREATE INDEX "collateral_types_is_active_idx" ON "collateral_types"("is_active");
CREATE INDEX "collateral_types_deleted_at_idx" ON "collateral_types"("deleted_at");

CREATE UNIQUE INDEX "restructuring_types_code_key" ON "restructuring_types"("code");
CREATE UNIQUE INDEX "restructuring_types_name_key" ON "restructuring_types"("name");
CREATE INDEX "restructuring_types_is_active_idx" ON "restructuring_types"("is_active");
CREATE INDEX "restructuring_types_deleted_at_idx" ON "restructuring_types"("deleted_at");

CREATE UNIQUE INDEX "legal_process_types_code_key" ON "legal_process_types"("code");
CREATE UNIQUE INDEX "legal_process_types_category_name_key" ON "legal_process_types"("category", "name");
CREATE INDEX "legal_process_types_category_idx" ON "legal_process_types"("category");
CREATE INDEX "legal_process_types_is_active_idx" ON "legal_process_types"("is_active");
CREATE INDEX "legal_process_types_deleted_at_idx" ON "legal_process_types"("deleted_at");
