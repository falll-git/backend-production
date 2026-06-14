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

  await createMissing("mail_delivery_media", [
    { code: "EMAIL", name: "Email", is_active: true },
    { code: "POS", name: "Pos", is_active: true },
    { code: "KURIR", name: "Kurir", is_active: true },
    { code: "LANGSUNG", name: "Langsung", is_active: true },
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

  await createMissing("collateral_types", [
    { code: "RUMAH_TINGGAL", name: "Rumah Tinggal", is_active: true },
    { code: "TANAH", name: "Tanah", is_active: true },
    { code: "KENDARAAN", name: "Kendaraan", is_active: true },
    { code: "DEPOSITO", name: "Deposito", is_active: true },
    { code: "LAINNYA", name: "Lainnya", is_active: true },
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
      code: "LEGAL_SURAT_PENGANTAR",
      name: "Penomoran Surat Pengantar",
      module: "LEGAL",
      document_type: "SURAT_PENGANTAR",
      prefix_template: "SPG/{YYYY}/{MM}/{SEQ}",
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
    {
      code: "LEGAL_DOKUMEN_LAINNYA",
      name: "Penomoran Dokumen Lainnya",
      module: "LEGAL",
      document_type: "DOKUMEN_LAINNYA",
      prefix_template: "DOK/{YYYY}/{MM}/{SEQ}",
      sequence_padding: 4,
      reset_period: "MONTHLY",
      is_active: true,
    },
  ]);

  await createMissing("deposit_types", [
    { code: "NOTARIS", name: "Titipan Notaris", category: "NOTARIS", is_active: true },
    { code: "ASURANSI", name: "Titipan Asuransi", category: "ASURANSI", is_active: true },
    { code: "ANGSURAN", name: "Titipan Angsuran", category: "ANGSURAN", is_active: true },
    { code: "LAINNYA", name: "Titipan Lainnya", category: "LAINNYA", is_active: true },
  ]);

  await createMissing("legal_process_types", [
    { code: "AKAD", name: "Akad", category: "NOTARY_DEED", is_active: true },
    { code: "APHT", name: "APHT", category: "NOTARY_DEED", is_active: true },
    { code: "SKMHT", name: "SKMHT", category: "NOTARY_DEED", is_active: true },
    { code: "ROYA", name: "Roya", category: "NOTARY_DEED", is_active: true },
    { code: "COVERNOTE", name: "Covernote", category: "NOTARY_DEED", is_active: true },
    { code: "JIWA", name: "Asuransi Jiwa", category: "INSURANCE_TYPE", is_active: true },
    {
      code: "KEBAKARAN",
      name: "Asuransi Kebakaran",
      category: "INSURANCE_TYPE",
      is_active: true,
    },
    {
      code: "KENDARAAN",
      name: "Asuransi Kendaraan",
      category: "INSURANCE_TYPE",
      is_active: true,
    },
    { code: "AGUNAN", name: "Asuransi Agunan", category: "INSURANCE_TYPE", is_active: true },
    {
      code: "APPRAISAL_AWAL",
      name: "Appraisal Awal",
      category: "KJPP_APPRAISAL",
      is_active: true,
    },
    {
      code: "REVIEW_APPRAISAL",
      name: "Review Appraisal",
      category: "KJPP_APPRAISAL",
      is_active: true,
    },
    {
      code: "REAPPRAISAL",
      name: "Re-appraisal",
      category: "KJPP_APPRAISAL",
      is_active: true,
    },
    {
      code: "MENINGGAL_DUNIA",
      name: "Meninggal Dunia",
      category: "INSURANCE_CLAIM",
      is_active: true,
    },
    {
      code: "KLAIM_KEBAKARAN",
      name: "Kebakaran",
      category: "INSURANCE_CLAIM",
      is_active: true,
    },
    {
      code: "KLAIM_KEHILANGAN",
      name: "Kehilangan",
      category: "INSURANCE_CLAIM",
      is_active: true,
    },
    {
      code: "KLAIM_KECELAKAAN",
      name: "Kecelakaan",
      category: "INSURANCE_CLAIM",
      is_active: true,
    },
  ]);

  console.log("Debtor/legal parameters seeded!");
}

module.exports = { seedDebtorLegalParameters };
