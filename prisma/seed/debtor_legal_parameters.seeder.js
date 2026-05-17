const crypto = require("crypto");
const prisma = require("../../src/config/prisma");

async function createMissing(model, rows) {
  const now = new Date();

  for (const row of rows) {
    const existing = await prisma[model].findUnique({
      where: {
        code: row.code,
      },
    });

    if (existing) continue;

    await prisma[model].create({
      data: {
        id: crypto.randomUUID(),
        ...row,
        created_at: now,
        updated_at: now,
      },
    });
  }
}

async function seedDebtorLegalParameters() {
  console.log("Seeding debtor/legal parameters...");

  await createMissing("financing_products", [
    { code: "MODAL_KERJA", name: "Pembiayaan Modal Kerja", is_active: true },
    { code: "INVESTASI", name: "Pembiayaan Investasi", is_active: true },
    { code: "KONSUMTIF", name: "Pembiayaan Konsumtif", is_active: true },
  ]);

  await createMissing("collectibility_levels", [
    { code: "KOL_1", level: 1, name: "Lancar", is_npf: false, is_active: true },
    {
      code: "KOL_2",
      level: 2,
      name: "Dalam Perhatian Khusus",
      is_npf: false,
      is_active: true,
    },
    {
      code: "KOL_3",
      level: 3,
      name: "Kurang Lancar",
      is_npf: true,
      is_active: true,
    },
    { code: "KOL_4", level: 4, name: "Diragukan", is_npf: true, is_active: true },
    { code: "KOL_5", level: 5, name: "Macet", is_npf: true, is_active: true },
  ]);

  await createMissing("contract_types", [
    { code: "MURABAHAH", name: "Murabahah", is_active: true },
    { code: "IJARAH", name: "Ijarah", is_active: true },
    { code: "MUSYARAKAH", name: "Musyarakah", is_active: true },
    { code: "MUDHARABAH", name: "Mudharabah", is_active: true },
    { code: "QARDH", name: "Qardh", is_active: true },
  ]);

  await createMissing("document_checklists", [
    {
      code: "KTP",
      name: "KTP",
      category: "AWAL",
      document_type: "IDENTITAS",
      is_required: true,
      is_active: true,
    },
    {
      code: "KK",
      name: "Kartu Keluarga",
      category: "AWAL",
      document_type: "IDENTITAS",
      is_required: true,
      is_active: true,
    },
    {
      code: "NPWP",
      name: "NPWP",
      category: "AWAL",
      document_type: "IDENTITAS",
      is_required: false,
      is_active: true,
    },
    {
      code: "AKAD",
      name: "Akad Pembiayaan",
      category: "AWAL",
      document_type: "LEGAL",
      is_required: true,
      is_active: true,
    },
    {
      code: "AGUNAN",
      name: "Dokumen Agunan",
      category: "AWAL",
      document_type: "AGUNAN",
      is_required: true,
      is_active: true,
    },
  ]);

  await createMissing("numbering_templates", [
    {
      code: "LEGAL_AKAD",
      name: "Penomoran Akad",
      module: "LEGAL",
      document_type: "AKAD",
      prefix_template: "AKAD/{YYYY}/{MM}/{SEQ}",
      sequence_padding: 4,
      reset_period: "MONTHLY",
      is_active: true,
    },
    {
      code: "LEGAL_HAFTSHEET",
      name: "Penomoran Haftsheet",
      module: "LEGAL",
      document_type: "HAFTSHEET",
      prefix_template: "HFS/{YYYY}/{MM}/{SEQ}",
      sequence_padding: 4,
      reset_period: "MONTHLY",
      is_active: true,
    },
    {
      code: "LEGAL_SP",
      name: "Penomoran Surat Peringatan",
      module: "LEGAL",
      document_type: "SURAT_PERINGATAN",
      prefix_template: "SP/{YYYY}/{MM}/{SEQ}",
      sequence_padding: 4,
      reset_period: "MONTHLY",
      is_active: true,
    },
    {
      code: "LEGAL_ASURANSI",
      name: "Penomoran Formulir Asuransi",
      module: "LEGAL",
      document_type: "FORMULIR_ASURANSI",
      prefix_template: "ASR/{YYYY}/{MM}/{SEQ}",
      sequence_padding: 4,
      reset_period: "MONTHLY",
      is_active: true,
    },
    {
      code: "LEGAL_SKL",
      name: "Penomoran SKL",
      module: "LEGAL",
      document_type: "SKL",
      prefix_template: "SKL/{YYYY}/{MM}/{SEQ}",
      sequence_padding: 4,
      reset_period: "MONTHLY",
      is_active: true,
    },
    {
      code: "LEGAL_SAMSAT",
      name: "Penomoran Samsat",
      module: "LEGAL",
      document_type: "SAMSAT",
      prefix_template: "SMS/{YYYY}/{MM}/{SEQ}",
      sequence_padding: 4,
      reset_period: "MONTHLY",
      is_active: true,
    },
  ]);

  await createMissing("sla_reminder_configs", [
    {
      code: "NOTARY_PROGRESS",
      name: "SLA Progress Notaris",
      module: "LEGAL",
      event_key: "NOTARY_PROGRESS",
      due_days: 14,
      reminder_days_before: 3,
      escalation_days: 2,
      is_active: true,
    },
    {
      code: "INSURANCE_PROGRESS",
      name: "SLA Progress Asuransi",
      module: "LEGAL",
      event_key: "INSURANCE_PROGRESS",
      due_days: 7,
      reminder_days_before: 2,
      escalation_days: 2,
      is_active: true,
    },
  ]);

  await createMissing("marketing_activity_types", [
    { code: "ACTION_PLAN", name: "Action Plan", category: "ACTION_PLAN", is_active: true },
    {
      code: "VISIT_RESULT",
      name: "Hasil Kunjungan",
      category: "VISIT_RESULT",
      is_active: true,
    },
    {
      code: "HANDLING_STEP",
      name: "Langkah Penanganan",
      category: "HANDLING_STEP",
      is_active: true,
    },
    {
      code: "WARNING_LETTER",
      name: "Surat Peringatan",
      category: "WARNING_LETTER",
      is_active: true,
    },
  ]);

  await createMissing("deposit_types", [
    { code: "NOTARIS", name: "Titipan Notaris", category: "NOTARIS", is_active: true },
    { code: "ASURANSI", name: "Titipan Asuransi", category: "ASURANSI", is_active: true },
    { code: "ANGSURAN", name: "Titipan Angsuran", category: "ANGSURAN", is_active: true },
  ]);

  console.log("Debtor/legal parameters seeded!");
}

module.exports = { seedDebtorLegalParameters };
