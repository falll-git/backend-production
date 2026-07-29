UPDATE "menus"
SET
  "name" = CASE "url"
    WHEN '/dashboard/arsip-digital/ruang-arsip/list-dokumen' THEN 'Daftar Dokumen'
    WHEN '/dashboard/arsip-digital/peminjaman/request' THEN 'Permintaan Peminjaman'
    WHEN '/dashboard/arsip-digital/peminjaman/accept' THEN 'Proses Peminjaman'
    WHEN '/dashboard/informasi-debitur' THEN 'Daftar Debitur'
    WHEN '/dashboard/legal/progress/klaim' THEN 'Klaim Asuransi'
    WHEN '/dashboard/users' THEN 'Manajemen Pengguna'
    WHEN '/dashboard/parameter/role' THEN 'Master Peran'
    WHEN '/dashboard/parameter/role-menu' THEN 'Akses Menu per Peran'
    WHEN '/dashboard/parameter/divisi' THEN 'Master Divisi'
    WHEN '/dashboard/parameter/cabang' THEN 'Master Cabang'
    WHEN '/dashboard/parameter/jenis-dokumen' THEN 'Master Jenis Dokumen'
    WHEN '/dashboard/parameter/tempat-penyimpanan' THEN 'Master Tempat Penyimpanan'
    WHEN '/dashboard/parameter/watermark-dokumen' THEN 'Pengaturan Watermark Dokumen'
    WHEN '/dashboard/parameter/prioritas-surat' THEN 'Master Prioritas Surat'
    WHEN '/dashboard/parameter/media-pengiriman-surat' THEN 'Master Media Pengiriman Surat'
    WHEN '/dashboard/parameter/produk-pembiayaan' THEN 'Master Produk Pembiayaan'
    WHEN '/dashboard/parameter/jenis-akad' THEN 'Master Jenis Akad'
    WHEN '/dashboard/parameter/checklist-dokumen' THEN 'Master Checklist Dokumen'
    WHEN '/dashboard/parameter/jenis-agunan' THEN 'Master Jenis Agunan'
    WHEN '/dashboard/parameter/pihak-ketiga/notaris' THEN 'Master Notaris'
    WHEN '/dashboard/parameter/pihak-ketiga/perusahaan-asuransi' THEN 'Master Perusahaan Asuransi'
    WHEN '/dashboard/parameter/pihak-ketiga/kjpp' THEN 'Master KJPP'
    WHEN '/dashboard/parameter/jenis-proses-legal' THEN 'Master Jenis Proses Legal'
    WHEN '/dashboard/parameter/jenis-titipan' THEN 'Master Jenis Titipan'
    ELSE "name"
  END,
  "updated_at" = NOW()
WHERE "url" IN (
  '/dashboard/arsip-digital/ruang-arsip/list-dokumen',
  '/dashboard/arsip-digital/peminjaman/request',
  '/dashboard/arsip-digital/peminjaman/accept',
  '/dashboard/informasi-debitur',
  '/dashboard/legal/progress/klaim',
  '/dashboard/users',
  '/dashboard/parameter/role',
  '/dashboard/parameter/role-menu',
  '/dashboard/parameter/divisi',
  '/dashboard/parameter/cabang',
  '/dashboard/parameter/jenis-dokumen',
  '/dashboard/parameter/tempat-penyimpanan',
  '/dashboard/parameter/watermark-dokumen',
  '/dashboard/parameter/prioritas-surat',
  '/dashboard/parameter/media-pengiriman-surat',
  '/dashboard/parameter/produk-pembiayaan',
  '/dashboard/parameter/jenis-akad',
  '/dashboard/parameter/checklist-dokumen',
  '/dashboard/parameter/jenis-agunan',
  '/dashboard/parameter/pihak-ketiga/notaris',
  '/dashboard/parameter/pihak-ketiga/perusahaan-asuransi',
  '/dashboard/parameter/pihak-ketiga/kjpp',
  '/dashboard/parameter/jenis-proses-legal',
  '/dashboard/parameter/jenis-titipan'
);
