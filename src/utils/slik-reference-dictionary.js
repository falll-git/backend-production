const SOURCE = "SEOJK No. 11/SEOJK.01/2024";
const UNMAPPED_LABEL = "Belum dipetakan";
const {
  CITY_CODE_ROWS,
  DEBTOR_GROUP_CODE_ROWS,
  ECONOMIC_SECTOR_CODE_ROWS,
} = require("./slik-reference-large-dictionaries");

function normalizeCode(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().replace(/\s+/g, " ");
  return normalized || null;
}

function lookupKey(value) {
  const normalized = normalizeCode(value);
  return normalized ? normalized.toUpperCase() : null;
}

function buildDictionary(category, sourceRef, rows) {
  return Object.freeze(
    Object.fromEntries(
      rows.map(([code, label]) => [
        lookupKey(code),
        Object.freeze({
          category,
          code: normalizeCode(code),
          label,
          source: SOURCE,
          source_ref: sourceRef,
        }),
      ]),
    ),
  );
}

const DICTIONARIES = Object.freeze({
  identity_type_code: buildDictionary(
    "identity_type_code",
    "Lampiran I D01 angka 3, PDF page 36",
    [
      ["1", "Kartu Tanda Penduduk (KTP)"],
      ["2", "Paspor"],
    ],
  ),

  education_degree_code: buildDictionary(
    "education_degree_code",
    "Lampiran I D01 angka 7, PDF page 37",
    [
      ["00", "Tanpa Gelar"],
      ["01", "Diploma 1"],
      ["02", "Diploma 2"],
      ["03", "Diploma 3"],
      ["04", "S-1"],
      ["05", "S-2"],
      ["06", "S-3"],
      ["99", "Lainnya"],
    ],
  ),

  gender: buildDictionary("gender", "Lampiran I D01 angka 8, PDF page 38", [
    ["L", "Laki-laki"],
    ["P", "Perempuan"],
  ]),

  marital_status_code: buildDictionary(
    "marital_status_code",
    "Lampiran I D01 angka 30, PDF page 45",
    [
      ["1", "Kawin"],
      ["2", "Belum Kawin"],
      ["3", "Cerai"],
    ],
  ),

  separate_assets_agreement: buildDictionary(
    "separate_assets_agreement",
    "Lampiran I D01 angka 34, PDF pages 46-47",
    [
      ["Y", "Terdapat perjanjian pisah harta"],
      ["T", "Tidak terdapat perjanjian pisah harta"],
    ],
  ),

  bmpk_violation_status: buildDictionary(
    "bmpk_violation_status",
    "Lampiran I D01 angka 35, PDF page 47",
    [
      ["Y", "Melanggar BMPK/BMPD/BMPP"],
      ["T", "Tidak melanggar BMPK/BMPD/BMPP"],
      ["N", "Tidak relevan"],
    ],
  ),

  bmpk_exceed_status: buildDictionary(
    "bmpk_exceed_status",
    "Lampiran I D01 angka 36, PDF page 47",
    [
      ["Y", "Melampaui BMPK/BMPD/BMPP"],
      ["T", "Tidak melampaui BMPK/BMPD/BMPP"],
      ["N", "Tidak relevan"],
    ],
  ),

  go_public_status: buildDictionary(
    "go_public_status",
    "Lampiran I D02 angka 24, PDF pages 55-56",
    [
      ["Y", "Go Public"],
      ["T", "Tidak Go Public"],
    ],
  ),

  income_source_code: buildDictionary(
    "income_source_code",
    "Lampiran I D01 angka 26, PDF page 43",
    [
      ["1", "Gaji"],
      ["2", "Usaha"],
      ["3", "Lainnya"],
    ],
  ),

  relationship_with_reporter_code: buildDictionary(
    "relationship_with_reporter_code",
    "Lampiran I D01 angka 28 dan D02 angka 21, PDF pages 44 and 54-55",
    [
      ["T1", "Terkait - Perusahaan Induk"],
      ["T2", "Terkait - Perusahaan Anak"],
      ["T3", "Terkait - Perusahaan Asosiasi"],
      ["T4", "Terkait - Sister company"],
      ["T9", "Terkait Lainnya"],
      ["N", "Tidak terkait dengan Pelapor"],
    ],
  ),

  debtor_group_code: buildDictionary(
    "debtor_group_code",
    "BAB VIII Daftar Kode Golongan Pihak Ketiga, PDF pages 247-250",
    DEBTOR_GROUP_CODE_ROWS,
  ),

  legal_form_code: buildDictionary(
    "legal_form_code",
    "Lampiran I D02 angka 5, PDF page 50",
    [
      ["01", "Badan Usaha Milik Desa (BUMDes)"],
      ["02", "Commanditer Venotschap (CV)"],
      ["03", "Debitur Kelompok"],
      ["04", "Ekspedisi Muatan Kapal Laut (EMKL)"],
      ["05", "Firma"],
      ["06", "Gabungan Koperasi"],
      ["07", "Induk Koperasi"],
      ["08", "Koperasi"],
      ["09", "Koperasi Unit Desa"],
      ["10", "Limited"],
      ["11", "Maskapai Andil Indonesia"],
      ["12", "Namloose Venotschaap"],
      ["13", "Perusahaan Daerah"],
      ["14", "Persero"],
      ["15", "Persekutuan Perdata"],
      ["16", "Perusahaan Umum"],
      ["17", "Primer Koperasi"],
      ["18", "Perseroan Terbatas"],
      ["19", "Pusat Koperasi"],
      ["20", "Pusat Koperasi Unit Desa"],
      ["21", "Usaha Dagang"],
      ["22", "Unit Dagang Kredit Pedesaan"],
      ["23", "Yayasan"],
      ["24", "Perusahaan Perseroan Daerah"],
      ["25", "Perusahaan Umum Daerah"],
      ["26", "Perseroan Perorangan"],
      ["99", "Lainnya"],
    ],
  ),

  rating_agency_code: buildDictionary(
    "rating_agency_code",
    "Lampiran I D02 angka 27 dan A01 angka 9, PDF pages 56 and 143",
    [
      ["MIS", "Moody's Investor Service"],
      ["SNP", "Standard And Poor's"],
      ["FIN", "Fitch Rating Internasional"],
      ["PEF", "Pemeringkat Efek Indonesia (Pefindo)"],
      ["FID", "Fitch Rating Indonesia"],
    ],
  ),

  occupation_code: buildDictionary(
    "occupation_code",
    "Lampiran I D01 angka 21, PDF pages 41-42",
    [
      ["001", "Accounting/finance officer"],
      ["002", "Customer service"],
      ["003", "Engineering"],
      ["004", "Eksekutif"],
      ["005", "Administrasi umum"],
      ["006", "Teknologi informasi"],
      ["007", "Konsultan/Analis"],
      ["008", "Marketing"],
      ["009", "Pengajar (Guru, Dosen)"],
      ["010", "Militer"],
      ["011", "Pensiunan"],
      ["012", "Pelajar/Mahasiswa"],
      ["013", "Wiraswasta"],
      ["014", "Polisi"],
      ["015", "Petani"],
      ["016", "Nelayan"],
      ["017", "Peternak"],
      ["018", "Dokter"],
      ["019", "Tenaga Medis (Perawat, Bidan, dan sebagainya)"],
      ["020", "Hukum (Pengacara, Notaris)"],
      ["021", "Perhotelan & restoran"],
      ["022", "Peneliti"],
      ["023", "Desainer"],
      ["024", "Arsitek"],
      ["025", "Pekerja seni"],
      ["026", "Pengamanan"],
      ["027", "Pialang/Broker"],
      ["028", "Distributor"],
      ["029", "Transportasi udara"],
      ["030", "Transportasi laut"],
      ["031", "Transportasi darat"],
      ["032", "Buruh"],
      ["033", "Pertukangan dan pengrajin"],
      ["034", "Ibu rumah tangga"],
      ["035", "Pekerja informal"],
      ["036", "Pejabat negara/penyelenggara negara"],
      ["037", "Pegawai pemerintahan/lembaga negara"],
      ["099", "Lain-lain"],
    ],
  ),

  credit_nature_code: buildDictionary(
    "credit_nature_code",
    "Lampiran I F01 angka 4, PDF pages 59-60",
    [
      ["1", "Kredit atau Pembiayaan yang Direstrukturisasi"],
      ["2", "Pengambilalihan Kredit atau Pembiayaan"],
      ["3", "Kredit atau Pembiayaan Subordinasi"],
      ["4", "Pemindahan utang nasabah"],
      ["5", "Kredit atau pembiayaan yang direstrukturisasi dalam rangka kebijakan stimulus"],
      ["9", "Lainnya"],
    ],
  ),

  credit_type_code: buildDictionary(
    "credit_type_code",
    "Lampiran I F01 angka 5, PDF pages 60-63",
    [
      ["P01", "Kredit/Pembiayaan dalam rangka pembiayaan bersama (Sindikasi)"],
      ["P02", "Kredit/Pembiayaan kepada pihak ketiga melalui lembaga lain secara channeling"],
      ["P03", "Kredit/Pembiayaan kepada UMKM melalui lembaga lain secara executing"],
      ["P04", "Kredit/Pembiayaan kepada Non-UMKM melalui lembaga lain secara executing"],
      ["P05", "Kartu Kredit atau Kartu Pembiayaan Syariah"],
      ["P06", "Surat berharga dengan Note Purchase Agreement (NPA)"],
      ["P07", "Dalam Rangka Kepemilikan Emas"],
      ["P08", "Gadai"],
      ["P09", "Talangan Haji"],
      ["P10", "Buy Now Pay Later (BNPL)"],
      ["P11", "Dana Tunai"],
      ["P99", "Lainnya"],
      ["Q01", "Buy Now Pay Later (BNPL) - LPBBTI"],
      ["Q99", "Lainnya - LPBBTI"],
      ["N01", "Giro Bersaldo Debet"],
      ["N02", "Tagihan atas Transaksi Perdagangan"],
      ["N99", "Lainnya"],
    ],
  ),

  financing_scheme_code: buildDictionary(
    "financing_scheme_code",
    "Lampiran I F01 angka 6, PDF pages 63-65",
    [
      ["000", "Konvensional"],
      ["020", "Mudharabah"],
      ["025", "Mudharabah Muqayyadah"],
      ["030", "Musyarakah"],
      ["035", "Musyarakah Mutanaqisah"],
      ["040", "Ijarah"],
      ["045", "Ijarah Muntahiya Bittamlik"],
      ["061", "Multijasa - Pendidikan"],
      ["062", "Multijasa - Ibadah"],
      ["063", "Multijasa - Kesehatan"],
      ["064", "Multijasa - Pernikahan"],
      ["069", "Multijasa - Lainnya"],
      ["070", "Piutang Murabahah"],
      ["080", "Piutang Istishna"],
      ["100", "Qardh"],
      ["119", "Pembiayaan Bagi Hasil Lainnya"],
      ["999", "Lainnya"],
    ],
  ),

  debtor_category_code: buildDictionary(
    "debtor_category_code",
    "Lampiran I F01 angka 15, PDF pages 68-69",
    [
      ["UM", "Debitur Usaha Mikro, Kecil, dan Menengah - Mikro"],
      ["UK", "Debitur Usaha Mikro, Kecil, dan Menengah - Kecil"],
      ["UT", "Debitur Usaha Mikro, Kecil, dan Menengah - Menengah"],
      ["NU", "Bukan Debitur Usaha Mikro, Kecil, dan Menengah"],
    ],
  ),

  usage_type_code: buildDictionary(
    "usage_type_code",
    "Lampiran I F01 angka 16, PDF page 70",
    [
      ["1", "Modal Kerja"],
      ["2", "Investasi"],
      ["3", "Konsumsi"],
    ],
  ),

  usage_orientation_code: buildDictionary(
    "usage_orientation_code",
    "Lampiran I F01 angka 17, PDF pages 70-71",
    [
      ["1", "Ekspor"],
      ["2", "Impor"],
      ["3", "Lainnya"],
    ],
  ),

  currency_code: buildDictionary("currency_code", "Lampiran I F01 angka 21, PDF page 72", [
    ["IDR", "Rupiah"],
    ["USD", "US Dollar"],
    ["SGD", "Singapore Dollar"],
  ]),

  interest_type_code: buildDictionary(
    "interest_type_code",
    "Lampiran I F01 angka 23, PDF page 73",
    [
      ["1", "Suku Bunga Fixed"],
      ["2", "Suku Bunga Floating"],
      ["3", "Margin"],
      ["4", "Bagi Hasil"],
      ["5", "Ujrah"],
      ["9", "Lainnya"],
      ["0", "Tidak Ada"],
    ],
  ),

  government_program_code: buildDictionary(
    "government_program_code",
    "Lampiran I F01 angka 24, PDF page 73",
    [
      ["10", "Bukan kredit atau pembiayaan program pemerintah"],
      ["21", "Kredit Usaha Rakyat - Mikro"],
      ["22", "Kredit Usaha Rakyat - Kecil"],
      ["23", "Kredit Usaha Rakyat - Penempatan Pekerja Migran Indonesia"],
      ["24", "Kredit Usaha Rakyat - KUR Khusus"],
      ["25", "Kredit Usaha Rakyat - Super Mikro"],
      ["30", "Kredit Pemilikan Rumah Bersubsidi"],
      ["90", "Kredit atau Pembiayaan Program Pemerintah Lainnya"],
    ],
  ),

  collectibility_code: buildDictionary(
    "collectibility_code",
    "Lampiran I F01 angka 33, PDF page 77",
    [
      ["1", "Lancar"],
      ["2", "Dalam Perhatian Khusus"],
      ["3", "Kurang Lancar"],
      ["4", "Diragukan"],
      ["5", "Macet"],
    ],
  ),

  default_reason_code: buildDictionary(
    "default_reason_code",
    "Lampiran I F01 angka 35, PDF page 78",
    [
      ["01", "Kesulitan Pemasaran"],
      ["02", "Kesulitan Manajemen dan Permasalahan Tenaga Kerja"],
      ["03", "Perusahaan Grup atau Afiliasi yang Sangat Merugikan Debitur"],
      ["04", "Permasalahan Terkait Pengelolaan Lingkungan Hidup"],
      ["05", "Penggunaan Dana Tidak Sesuai dengan Perjanjian Kredit atau Pembiayaan"],
      ["06", "Kelemahan Dalam Analisa Kredit atau Pembiayaan"],
      ["07", "Fluktuasi Nilai Tukar"],
      ["08", "Itikad Tidak Baik"],
      ["09", "Keadaan Kahar (Force Majeur)"],
      ["10", "Pailit"],
      ["11", "Uniform Classification"],
      ["99", "Lainnya"],
    ],
  ),

  restructuring_method_code: buildDictionary(
    "restructuring_method_code",
    "Lampiran I F01 angka 43, PDF page 81",
    [
      ["01", "Penurunan suku bunga kredit"],
      ["02", "Perpanjangan jangka waktu kredit"],
      ["03", "Pengurangan tunggakan pokok kredit"],
      ["04", "Pengurangan tunggakan bunga kredit"],
      ["05", "Penambahan fasilitas kredit"],
      ["06", "Konversi kredit menjadi penyertaan modal sementara"],
      ["07", "Penambahan fasilitas kredit dan pengurangan tunggakan bunga kredit"],
      ["08", "Penambahan fasilitas kredit dan perpanjangan jangka waktu kredit"],
      ["09", "Penambahan fasilitas kredit dan penurunan suku bunga kredit"],
      ["10", "Penambahan fasilitas kredit, pengurangan tunggakan bunga kredit dan penurunan suku bunga kredit"],
      ["11", "Penambahan fasilitas kredit, pengurangan tunggakan bunga kredit dan perpanjangan jangka waktu kredit"],
      ["12", "Penjadwalan Kembali (Syariah)"],
      ["13", "Perubahan jadwal pembayaran (Syariah)"],
      ["14", "Perubahan jumlah angsuran (Syariah)"],
      ["15", "Perubahan jangka waktu (Syariah)"],
      ["16", "Perubahan nisbah dalam pembiayaan Mudharabah atau Pembiayaan Musyarakah (Syariah)"],
      ["17", "Perubahan Porsi Bagi Hasil (PBH) dalam pembiayaan Mudharabah atau Pembiayaan Musyarakah (Syariah)"],
      ["18", "Pemberian potongan (Syariah)"],
      ["19", "Penambahan dana fasilitas pembiayaan bank (Syariah)"],
      ["20", "Konversi akad pembiayaan (Syariah)"],
      ["21", "Konversi pembiayaan menjadi penyertaan modal pada perusahaan nasabah (Syariah)"],
      ["99", "Lainnya"],
    ],
  ),

  condition_code: buildDictionary(
    "condition_code",
    "Lampiran I F01 angka 44, PDF page 82",
    [
      ["00", "Fasilitas Aktif"],
      ["01", "Dibatalkan"],
      ["02", "Lunas"],
      ["03", "Dihapusbukukan"],
      ["04", "Hapus Tagih"],
      ["05", "Lunas karena Pengambilalihan Agunan"],
      ["06", "Lunas karena Diselesaikan Melalui Pengadilan"],
      ["07", "Dialihkan atau Dijual ke Pelapor lain"],
      ["08", "Dialihkan ke Fasilitas lain"],
      ["09", "Dialihkan atau dijual kepada pihak lain non-Pelapor"],
      ["10", "Disekuritisasi (Kreditur Asal sebagai Servicer)"],
      ["11", "Disekuritisasi (Kreditur Asal tidak sebagai Servicer)"],
      ["12", "Lunas Dengan Diskon"],
      ["13", "Diblokir Sementara"],
      ["14", "Berhenti dari Keanggotaan Kredit Joint Account"],
      ["15", "Transaksi Partisipasi Risiko"],
      ["16", "Kredit atau Pembiayaan Alihan dengan Pengelolaan Penagihan"],
      ["17", "Lunas Sesuai Kebijakan Pemerintah"],
    ],
  ),

  facility_segment_code: buildDictionary(
    "facility_segment_code",
    "Lampiran I A01 angka 5, PDF page 141",
    [
      ["F01", "Kredit atau Pembiayaan"],
      ["F02", "Kredit atau Pembiayaan Joint Account"],
      ["F03", "Surat Berharga"],
      ["F04", "Irrevocable L/C"],
      ["F05", "Garansi yang Diberikan"],
      ["F06", "Fasilitas Lain"],
    ],
  ),

  collateral_status_code: buildDictionary(
    "collateral_status_code",
    "Lampiran I A01 angka 6, PDF pages 141-142",
    [
      ["1", "Tersedia"],
      ["2", "Indent"],
    ],
  ),

  collateral_type: buildDictionary(
    "collateral_type",
    "Lampiran I A01 angka 7, PDF pages 142-143",
    [
      ["F0401", "Sertifikat Bank Indonesia (SBI)"],
      ["F0402", "Sertifikat Bank Indonesia Syariah (SBIS)"],
      ["F0403", "Sertifikat Deposito Bank Indonesia (SDBI)"],
      ["F0404", "Surat Berharga Bank Indonesia (SBBI) dalam Valuta Asing"],
      ["F040501", "Surat Perbendaharaan Negara (SPN)"],
      ["F040502", "Surat Perbendaharaan Negara Syariah"],
      ["F041401", "Reksadana"],
      ["F041402", "Sertifikat Reksadana Syariah"],
      ["F041403", "Reksadana Dana Pendapatan Tetap"],
      ["F04150102", "Obligasi Negara (ON)"],
      ["F04150103", "Obligasi Ritel Indonesia (ORI)"],
      ["F04150106", "Obligasi Daerah"],
      ["F04150201", "Sukuk Bank Indonesia"],
      ["F04150203", "Sukuk Negara"],
      ["F04150204", "Sukuk Ritel"],
      ["F04150205", "Ijarah Fixed Rate"],
      ["F04150208", "Sukuk Valas Bank Indonesia (SUVBI)"],
      ["F04150299", "Sukuk Lainnya"],
      ["F0418", "Resi Gudang"],
      ["F0419", "Saham"],
      ["F0420", "Asuransi Kredit/Pembiayaan"],
      ["F0499", "Surat Berharga Lainnya"],
      ["F0422", "Sekuritas Rupiah Bank Indonesia (SRBI)"],
      ["F0423", "Sekuritas Valas Bank Indonesia (SVBI)"],
      ["F09", "Giro"],
      ["F10", "Tabungan"],
      ["F11", "Deposito"],
      ["F15", "Setoran Jaminan"],
      ["F16", "Invoice"],
      ["F2001", "Emas dan mata uang emas"],
      ["F2099", "Aset Keuangan Lainnya"],
      ["F4101", "L/C"],
      ["F4102", "SKBDN"],
      ["F42", "Garansi"],
      ["F4205", "Standby L/C"],
      ["AN020101", "Tanah"],
      ["AN02010201", "Gedung/Ruang kantor"],
      ["AN02010202", "Gudang"],
      ["AN02010203", "Rumah Toko/Rumah Kantor"],
      ["AN02010204", "Hotel"],
      ["AN02010299", "Properti Komersial Lainnya"],
      ["AN02010301", "Rumah"],
      ["AN02010302", "Apartemen/Rumah Susun"],
      ["AN020202", "Mesin"],
      ["AN020203", "Kendaraan"],
      ["AN020299", "Aset Tetap dan Inventaris Lainnya"],
      ["AN0205", "Pesawat Udara"],
      ["AN0206", "Kapal Laut/Transportasi Air"],
      ["AN0299", "Aset non Keuangan Lainnya"],
      ["AN999901", "Persediaan"],
    ],
  ),

  binding_type_code: buildDictionary(
    "binding_type_code",
    "Lampiran I A01 angka 10, PDF page 144",
    [
      ["01", "Hak Tanggungan"],
      ["02", "Gadai"],
      ["03", "Fidusia"],
      ["04", "Surat Kuasa Membebankan Hak Tanggungan (SKMHT)"],
      ["05", "Cessie"],
      ["06", "Belum Diikat"],
      ["99", "Lainnya"],
    ],
  ),

  paripasu_status: buildDictionary("paripasu_status", "Lampiran I A01 angka 22, PDF page 148", [
    ["Y", "Agunan paripasu"],
    ["T", "Bukan agunan paripasu"],
  ]),

  joint_credit_status: buildDictionary(
    "joint_credit_status",
    "Lampiran I A01 angka 24, PDF page 148",
    [
      ["Y", "Agunan dari fasilitas Joint Account"],
      ["T", "Bukan agunan dari fasilitas Joint Account"],
    ],
  ),

  insured_status: buildDictionary("insured_status", "Lampiran I A01 angka 25, PDF page 148", [
    ["Y", "Agunan diasuransikan"],
    ["T", "Agunan tidak diasuransikan"],
  ]),

  operation_code: buildDictionary(
    "operation_code",
    "Lampiran I D01 angka 39 dan A01 angka 28, PDF pages 48 and 149",
    [
      ["C", "Create"],
      ["U", "Update"],
      ["D", "Delete"],
      ["N", "Not change"],
    ],
  ),

  country_code: buildDictionary("country_code", "Lampiran I D01 angka 20, PDF page 41", [
    ["ID", "Indonesia"],
    ["MY", "Malaysia"],
    ["KR", "Korea Selatan"],
  ]),

  city_code: buildDictionary(
    "city_code",
    "BAB IX Daftar Kode Kabupaten atau Kota, PDF pages 253-263",
    CITY_CODE_ROWS,
  ),
  economic_sector_code: buildDictionary(
    "economic_sector_code",
    "BAB V Daftar Kode Sektor Ekonomi, PDF pages 183-235",
    ECONOMIC_SECTOR_CODE_ROWS,
  ),
  business_field_code: buildDictionary(
    "business_field_code",
    "BAB V Daftar Kode Sektor Ekonomi, PDF pages 183-235",
    ECONOMIC_SECTOR_CODE_ROWS,
  ),
});

const SLIK_REFERENCE_FIELD_MAPPINGS = Object.freeze({
  debtor: Object.freeze({
    slik_operation_code: "operation_code",
  }),
  individualProfile: Object.freeze({
    identity_type_code: "identity_type_code",
    education_degree_code: "education_degree_code",
    gender: "gender",
    city_code: "city_code",
    domicile_country_code: "country_code",
    occupation_code: "occupation_code",
    workplace_business_field_code: "business_field_code",
    income_source_code: "income_source_code",
    relationship_with_reporter_code: "relationship_with_reporter_code",
    debtor_group_code: "debtor_group_code",
    marital_status_code: "marital_status_code",
    separate_assets_agreement: "separate_assets_agreement",
    violates_bmpk: "bmpk_violation_status",
    exceeds_bmpk: "bmpk_exceed_status",
    operation_code: "operation_code",
  }),
  legalEntityProfile: Object.freeze({
    legal_form_code: "legal_form_code",
    city_code: "city_code",
    domicile_country_code: "country_code",
    business_field_code: "business_field_code",
    relationship_with_reporter_code: "relationship_with_reporter_code",
    violates_bmpk: "bmpk_violation_status",
    exceeds_bmpk: "bmpk_exceed_status",
    go_public: "go_public_status",
    debtor_group_code: "debtor_group_code",
    rating_agency: "rating_agency_code",
    operation_code: "operation_code",
  }),
  contractSnapshot: Object.freeze({
    credit_nature_code: "credit_nature_code",
    credit_type_code: "credit_type_code",
    financing_scheme_code: "financing_scheme_code",
    debtor_category_code: "debtor_category_code",
    usage_type_code: "usage_type_code",
    usage_orientation_code: "usage_orientation_code",
    economic_sector_code: "economic_sector_code",
    project_location_city_code: "city_code",
    currency_code: "currency_code",
    interest_type_code: "interest_type_code",
    government_program_code: "government_program_code",
    collectibility_code: "collectibility_code",
    default_reason_code: "default_reason_code",
    restructuring_method_code: "restructuring_method_code",
    condition_code: "condition_code",
    operation_code: "operation_code",
  }),
  collateral: Object.freeze({
    facility_segment_code: "facility_segment_code",
    collateral_status_code: "collateral_status_code",
    collateral_type: "collateral_type",
    rating_agency_code: "rating_agency_code",
    binding_type_code: "binding_type_code",
    location_city_code: "city_code",
    paripasu_status: "paripasu_status",
    joint_credit_status: "joint_credit_status",
    insured_status: "insured_status",
    operation_code: "operation_code",
  }),
});

const SEGMENT_REFERENCE_FIELD_MAPPINGS = Object.freeze({
  D01: Object.freeze({
    "profile.identity_type_code": "identity_type_code",
    "profile.education_degree_code": "education_degree_code",
    "profile.gender": "gender",
    "profile.city_code": "city_code",
    "profile.domicile_country_code": "country_code",
    "profile.occupation_code": "occupation_code",
    "profile.workplace_business_field_code": "business_field_code",
    "profile.income_source_code": "income_source_code",
    "profile.relationship_with_reporter_code": "relationship_with_reporter_code",
    "profile.debtor_group_code": "debtor_group_code",
    "profile.marital_status_code": "marital_status_code",
    "profile.separate_assets_agreement": "separate_assets_agreement",
    "profile.violates_bmpk": "bmpk_violation_status",
    "profile.exceeds_bmpk": "bmpk_exceed_status",
    "profile.operation_code": "operation_code",
  }),
  D02: Object.freeze({
    "profile.legal_form_code": "legal_form_code",
    "profile.city_code": "city_code",
    "profile.domicile_country_code": "country_code",
    "profile.business_field_code": "business_field_code",
    "profile.relationship_with_reporter_code": "relationship_with_reporter_code",
    "profile.violates_bmpk": "bmpk_violation_status",
    "profile.exceeds_bmpk": "bmpk_exceed_status",
    "profile.go_public": "go_public_status",
    "profile.debtor_group_code": "debtor_group_code",
    "profile.rating_agency": "rating_agency_code",
    "profile.operation_code": "operation_code",
  }),
  F01: SLIK_REFERENCE_FIELD_MAPPINGS.contractSnapshot,
  A01: SLIK_REFERENCE_FIELD_MAPPINGS.collateral,
});

function referenceOutputName(field) {
  return field.endsWith("_code") ? field.slice(0, -"_code".length) : field;
}

function resolveSlikReference(category, value) {
  const code = normalizeCode(value);
  if (!code) return null;

  const dictionary = DICTIONARIES[category] || {};
  const entry = dictionary[lookupKey(code)];
  if (!entry) {
    return {
      category,
      code,
      label: null,
      display: `${code} - ${UNMAPPED_LABEL}`,
      source: null,
      source_ref: null,
      is_mapped: false,
    };
  }

  return {
    ...entry,
    code,
    display: `${code} - ${entry.label}`,
    is_mapped: true,
  };
}

function withSlikReferenceFields(record, fieldMappings) {
  if (!record) return record;

  const output = { ...record };
  for (const [field, category] of Object.entries(fieldMappings || {})) {
    const reference = resolveSlikReference(category, record[field]);
    const outputName = referenceOutputName(field);
    output[`${outputName}_label`] = reference?.label ?? null;
    output[`${outputName}_display`] = reference?.display ?? null;
  }
  return output;
}

function readPath(source, path) {
  return path.split(".").reduce((current, key) => current?.[key], source);
}

function collectUnmappedSlikReferences(segment, summary) {
  const mappings = SEGMENT_REFERENCE_FIELD_MAPPINGS[segment] || {};
  const unmapped = [];

  for (const [fieldPath, category] of Object.entries(mappings)) {
    const reference = resolveSlikReference(category, readPath(summary, fieldPath));
    if (!reference || reference.is_mapped) continue;
    unmapped.push({
      segment,
      field: fieldPath,
      category,
      code: reference.code,
      count: 1,
    });
  }

  return unmapped;
}

function mergeUnmappedSlikReferences(existing = [], incoming = [], limit = 200) {
  const merged = new Map();

  for (const item of [...existing, ...incoming]) {
    if (!item?.segment || !item?.field || !item?.category || !item?.code) continue;
    const key = `${item.segment}::${item.field}::${item.category}::${item.code}`;
    const previous = merged.get(key);
    merged.set(key, {
      segment: item.segment,
      field: item.field,
      category: item.category,
      code: item.code,
      count: (previous?.count || 0) + Number(item.count || 1),
    });
  }

  return [...merged.values()]
    .sort((a, b) => b.count - a.count || a.segment.localeCompare(b.segment) || a.field.localeCompare(b.field))
    .slice(0, limit);
}

module.exports = {
  DICTIONARIES,
  SOURCE,
  SLIK_REFERENCE_FIELD_MAPPINGS,
  UNMAPPED_LABEL,
  collectUnmappedSlikReferences,
  mergeUnmappedSlikReferences,
  resolveSlikReference,
  withSlikReferenceFields,
};
