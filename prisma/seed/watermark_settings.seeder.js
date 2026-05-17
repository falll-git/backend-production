const prisma = require("../../src/config/prisma");

const DEFAULT_WATERMARK_SETTINGS = {
  is_enabled: false,
  target_modules: [
    "digital_archive",
    "incoming_mail",
    "outgoing_mail",
    "memorandum",
  ],
  watermark_type: "TEXT",
  text_template: "{document_name} - {username} - {date}",
  text_color: "#1F2937",
  text_opacity: 0.16,
  font_family: "Arial",
  font_size: 42,
  image_opacity: 0.16,
  image_scale: 0.35,
  position: "CENTER",
  repeat_pattern: true,
  rotation: -35,
  spacing_x: 280,
  spacing_y: 180,
};

async function seedWatermarkSettings() {
  console.log("Seeding watermark settings...");

  const existing = await prisma.watermark_settings.findFirst();
  if (existing) {
    console.log("Watermark settings already exists.");
    return;
  }

  await prisma.watermark_settings.create({
    data: DEFAULT_WATERMARK_SETTINGS,
  });

  console.log("Watermark settings seeded!");
}

module.exports = { seedWatermarkSettings };
