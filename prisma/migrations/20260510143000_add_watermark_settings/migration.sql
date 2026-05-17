CREATE TABLE "watermark_settings" (
    "id" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "target_modules" TEXT[] NOT NULL DEFAULT ARRAY['digital_archive', 'incoming_mail', 'outgoing_mail', 'memorandum']::TEXT[],
    "watermark_type" TEXT NOT NULL DEFAULT 'TEXT',
    "text_template" TEXT,
    "text_color" TEXT NOT NULL DEFAULT '#1F2937',
    "text_opacity" DOUBLE PRECISION NOT NULL DEFAULT 0.16,
    "font_family" TEXT NOT NULL DEFAULT 'Arial',
    "font_size" INTEGER NOT NULL DEFAULT 42,
    "image_path" TEXT,
    "image_original_name" TEXT,
    "image_mime_type" TEXT,
    "image_size_bytes" INTEGER,
    "image_opacity" DOUBLE PRECISION NOT NULL DEFAULT 0.16,
    "image_scale" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "position" TEXT NOT NULL DEFAULT 'CENTER',
    "repeat_pattern" BOOLEAN NOT NULL DEFAULT true,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT -35,
    "spacing_x" INTEGER NOT NULL DEFAULT 280,
    "spacing_y" INTEGER NOT NULL DEFAULT 180,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watermark_settings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "watermark_settings_is_enabled_idx" ON "watermark_settings"("is_enabled");

INSERT INTO "watermark_settings" (
    "id",
    "is_enabled",
    "target_modules",
    "watermark_type",
    "text_template",
    "text_color",
    "text_opacity",
    "font_family",
    "font_size",
    "image_opacity",
    "image_scale",
    "position",
    "repeat_pattern",
    "rotation",
    "spacing_x",
    "spacing_y"
)
VALUES (
    'watermark-settings-default',
    false,
    ARRAY['digital_archive', 'incoming_mail', 'outgoing_mail', 'memorandum']::TEXT[],
    'TEXT',
    '{document_name} - {username} - {date}',
    '#1F2937',
    0.16,
    'Arial',
    42,
    0.16,
    0.35,
    'CENTER',
    true,
    -35,
    280,
    180
);
