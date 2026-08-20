# Arsitektur Ruwang Arsip

Dokumen ini menjelaskan arsitektur yang dapat dibuktikan dari source code Ruwang Arsip pada kandidat rilis Agustus 2026. Dokumen ini tidak menyatakan kondisi suatu VPS telah diverifikasi.

## 1. Batas sistem dan deployment

Ruwang Arsip terdiri dari dua repository dan empat proses aplikasi:

| Komponen | Teknologi | Proses production |
| --- | --- | --- |
| Frontend | Next.js 16, React 19, TypeScript | `npm start` |
| API | Express 5, Prisma 7 | `npm start` dengan `RUNTIME_ROLE=api` |
| Worker import SLIK | BullMQ, Redis, Prisma | `npm run worker:slik-import` |
| Worker watermark | Node.js, Prisma | `npm run worker:watermark` |

Dependency wajibnya adalah PostgreSQL, Redis, persistent file storage, dan reverse proxy HTTPS. Nginx, process manager, DNS, sertifikat, firewall, serta backup berada di luar kedua repository dan harus diverifikasi per VPS.

Ruwang Arsip dirancang sebagai satu instalasi dan satu database terpisah per BPRS. Isolasi antar-BPRS tidak bergantung pada kolom tenant dalam satu shared database. Di dalam satu instalasi, akses tetap dibatasi dengan user, role, menu, divisi, ownership record, authorization API, dan RLS PostgreSQL.

```text
Browser
  -> HTTPS / reverse proxy
      -> Next.js frontend
      -> Express API /api/v1
          -> PostgreSQL (application role + RLS)
          -> PostgreSQL (system role, jalur internal terbatas)
          -> Redis (rate limit, cache, queue, heartbeat)
          -> persistent UPLOAD_DIR (file privat)
      -> SLIK import worker
      -> watermark worker
```

## 2. Frontend

### Struktur route

App Router membagi halaman menjadi autentikasi dan dashboard. Area dashboard mencakup Arsip Digital, Informasi Debitur, Manajemen Surat, Legal, Pusat Log Aktivitas, Penggunaan Storage, Pengguna, dan Parameter. Build kandidat menghasilkan 67 route.

### Autentikasi dan sesi

- `AuthProvider` menjadi pemilik state autentikasi dan RBAC runtime.
- Access token digunakan oleh client API; refresh token dikirim sebagai cookie HttpOnly oleh backend.
- Refresh bersamaan dikoordinasikan dan dideduplikasi. Respons 429/transient refresh tidak langsung dianggap sesi tidak sah.
- Refresh token dirotasi di backend dan terikat pada sesi database. Pemulihan rotasi singkat menangani reload browser yang tumpang tindih tanpa menghidupkan kembali token kedaluwarsa secara umum.
- Penyimpanan browser hanya mempertahankan state pengguna yang diperlukan untuk pengalaman sesi. Token refresh lama tidak disimpan sebagai credential JavaScript.

### RBAC, menu, dan data fetching

- Menu dan izin aksi berasal dari `menus` dan `role_menus` backend, lalu dihitung kembali di frontend untuk navigasi dan affordance UI.
- Backend tetap menjadi boundary otorisasi; menyembunyikan tombol di frontend bukan kontrol keamanan tunggal.
- Data layout global menggunakan koordinasi in-flight, TTL, cooldown, dan refresh eksplisit agar navigasi tidak mengulang permintaan menu/role-menu secara berlebihan.
- Workflow Arsip Digital mempunyai provider tersendiri yang menggabungkan refresh bersamaan dan mengabaikan respons lama.

### Upload, download, dan preview

- Form mengirim multipart hanya ke endpoint berizin.
- File privat tidak dibuka dari path disk. Browser memperoleh URL/token akses dari backend.
- Preview dokumen memakai dialog terpusat dengan focus trap, Escape, focus return, serta pembatasan nested modal.
- Validasi signature, MIME, ekstensi, ukuran, dan scope akses dilakukan kembali di backend.

### Environment dan build

- Frontend dibangun per instance karena URL API, public origin, dan branding dapat berbeda.
- Nilai production hanya berasal dari environment VPS; `.env` production tidak masuk Git.
- Alur reproducible: `npm ci`, lint, typecheck, unit/coverage, production build, CSP test, lalu Playwright production server.

## 3. Backend

### Entrypoint dan API

- `src/server.js` memvalidasi environment, storage, database role, RLS, Redis rate-limit store, lalu membuka listener.
- `src/app.js` memasang security header, request ID, telemetry hook, request context/logging, CORS allowlist, body limit, audit middleware, private file guard, versioning, dan error sanitizer.
- API utama berada pada `/api/v1`; legacy `/api` melewati middleware versioning yang sama.
- OpenAPI tersedia melalui modul dokumentasi backend.
- `/health` adalah liveness. `/ready` memeriksa dependency yang diperlukan untuk melayani request.

### Modul domain

| Area | Modul utama |
| --- | --- |
| Identitas dan akses | auth, user, role, menus, role-menus, division, notifications |
| Arsip Digital | digital-documents, digital-archives, access-requests, loans, storage, storage-usage |
| Persuratan | incoming-mail, outgoing-mails, memorandum, correspondence, priority, numbering, delivery media |
| Debitur | debtors, contracts, collectibility, collateral, imports, iDeb, marketing, warning letters, reports |
| Legal | notaris, asuransi, KJPP, klaim, dana titipan, pihak ketiga, tipe proses dan template |
| Sistem | activity-centre, client-errors, watermark-settings, health/readiness, storage/database reports |

### Middleware dan kontrol keamanan

- Joi memvalidasi payload dan parameter sebelum service.
- `auth` memverifikasi JWT sekaligus sesi aktif di database.
- `authorize` memeriksa izin menu/aksi; service/repository menerapkan ownership/division scope yang relevan.
- Limiter terpisah tersedia untuk autentikasi, API umum, upload/import/export, file access, dan download. Production mensyaratkan store Redis bersama.
- CORS allowlist, CSP/security headers, MIME protection, anti-frame, HSTS production, error sanitization, upload signature validation, serta private-file authorization diterapkan di source.
- Request ID menghubungkan respons, structured log, dan error event tanpa menampilkan detail internal ke pengguna.

### Error handling dan observability

- Error 5xx dicatat sebagai structured JSON dan respons pengguna disanitasi.
- Field credential dan data sensitif disaring dari system activity log serta log aplikasi.
- OpenTelemetry bersifat opsional. `OTEL_ENABLED` harus tetap `false` sampai collector dan endpoint OTLP production benar-benar tersedia serta diuji.
- Log stdout API dan kedua worker harus dikumpulkan, dirotasi, dan dipantau oleh tooling VPS.

## 4. Database

### Domain model

Prisma schema mencakup user/role/menu/division; action token dan refresh session; notifikasi; storage; persuratan dan disposisi; dokumen digital, file, akses, peminjaman, serta activity log; debitur, profil, kontrak, kolektibilitas, snapshot SLIK, agunan, import, dokumen, marketing, surat peringatan, dan iDeb; legal notaris/asuransi/KJPP/klaim/dana titipan; watermark; serta system activity log.

### Role database dan RLS

- Jalur request bisnis memakai application role non-superuser, tanpa `BYPASSRLS`, `CREATEDB`, atau `CREATEROLE`.
- Tabel bisnis yang dilindungi menggunakan RLS dan `FORCE ROW LEVEL SECURITY`.
- Policy memanfaatkan context user/role/division yang dipasang untuk transaksi request.
- System role terpisah boleh `BYPASSRLS` hanya untuk worker, recovery, maintenance, dan audit sistem yang sudah dibatasi. System role tidak boleh dipakai sebagai default koneksi request bisnis.
- Runtime startup menolak konfigurasi role/grant yang tidak memenuhi kontrak keamanan.

### Migration

- Source kebenaran perubahan schema adalah direktori `prisma/migrations` yang immutable setelah diterapkan.
- Production memakai `prisma migrate deploy`, bukan `db push` dan bukan reset.
- Kandidat rilis diuji pada database kosong dan jalur upgrade database lama disposable.
- Database CI kosong memprovisikan role aplikasi `NOLOGIN` least-privilege sebelum `migrate deploy`, sehingga migration yang memberi grant ke role runtime dapat diuji tanpa credential production.
- Pemeriksaan release mencakup migration status, schema diff, checksum/status, RLS, public grants, serta transaction rollback.

## 5. Aliran data utama

### Login dan refresh sesi

1. Browser mengirim credential ke endpoint login yang dilimit.
2. Backend memverifikasi password, role aktif, dan kebijakan single-session.
3. Backend membuat refresh session database, access token pendek, dan cookie refresh HttpOnly.
4. Request API membawa access token; middleware juga memastikan session masih aktif.
5. Refresh merotasi token dan mencabut token lama. Logout/revocation membuat access token yang masih belum habis tidak dapat dipakai tanpa sesi aktif.

### Pembacaan data berdasarkan role

1. Frontend memperoleh user, menu, dan role-menu.
2. Navigasi hanya menampilkan route yang relevan.
3. API memeriksa token dan action permission.
4. Repository berjalan dalam context RLS dan menambahkan scope ownership/division bila domain memerlukannya.

### Import SLIK dan agunan

1. Pengguna mengunggah file ke area temporary tervalidasi.
2. API membuat import job dan mengantrekannya ke Redis/BullMQ.
3. Worker mengambil job, mem-parsing record, melakukan transaksi database, dan mencatat status/error yang aman.
4. Data operasional manual agunan—termasuk pengaturan tanggal expired—dipertahankan saat A01/TXT diimpor ulang.
5. File sementara dibersihkan berdasarkan TTL setelah tidak dipakai job aktif.

### Upload dan akses file

1. Upload divalidasi sebelum dipindahkan ke persistent storage.
2. Record database dan file dikoordinasikan agar kegagalan transaksi tidak meninggalkan referensi rusak.
3. File lama baru dibersihkan setelah update database berhasil.
4. Download melewati autentikasi, authorization, token/file scope, limiter, dan header private/no-store.
5. Reconciliation membandingkan database dan disk tanpa menghapus kandidat orphan secara otomatis.

### Watermark

1. Perubahan pengaturan atau dokumen menjadwalkan pekerjaan watermark.
2. Worker watermark memproses antrean/batch dan memperbarui status secara idempoten.
3. Heartbeat Redis digunakan readiness untuk mendeteksi worker wajib yang tidak aktif.

### Audit event

1. Middleware menangkap aktivitas request yang layak diaudit.
2. Modul domain menambahkan perubahan bisnis yang tidak cukup dijelaskan oleh request generik.
3. Field sensitif disaring sebelum masuk structured log atau `system_activity_logs`.
4. Pusat Log Aktivitas menyajikan istilah bisnis dan metadata yang relevan bagi pengguna, bukan identifier teknis internal.

## 6. Isolasi BPRS dan integrasi Seputar Jaminan

Setiap BPRS harus mempunyai origin, environment, database, Redis namespace/database, persistent storage, secret, process, dan backup sendiri. ID record hanya bermakna di dalam instalasi asal kecuali ada kontrak integrasi eksplisit.

Belum ada kontrak integrasi Ruwang Arsip–Seputar Jaminan yang terbukti di source ini. Jika integrasi dibuat:

- Jangan membuka database Ruwang Arsip atau private file path secara langsung.
- Publikasikan hanya data yang telah disetujui melalui API/outbox khusus dengan allowlist field.
- Identitas BPRS harus memakai identifier integrasi stabil, bukan UUID record lokal atau nama tampilan.
- Media publik harus disalin ke storage publik terpisah; dokumen nasabah dan arsip privat tidak boleh diteruskan.
- Sinkronisasi harus idempoten, mempunyai retry/dead-letter, audit, dan reconciliation.
- WhatsApp harus melalui provider/credential milik instance dan hanya menerima payload yang sudah disetujui; token tidak boleh berada di browser atau source.
- Credential antarserver harus terpisah per BPRS, dapat dirotasi, dibatasi origin/network, dan mempunyai scope minimum.

## 7. Storage, Redis, dan failure mode

- `UPLOAD_DIR` production wajib absolut, writable oleh proses aplikasi, persisten, dan berada di luar folder source/release.
- Subdirectory dipisahkan menurut domain file; file privat tetap disajikan oleh backend.
- Redis menyimpan distributed rate limit, application cache, BullMQ, dan worker heartbeat. Prefix dan queue name harus memuat `APP_INSTANCE_KEY` agar empat instance pada satu VPS tidak bertabrakan.
- Production tidak boleh memakai local SLIK fallback bila worker diwajibkan. Kegagalan Redis/worker harus membuat readiness gagal, bukan diam-diam memindahkan pekerjaan berat ke API.
- Cleanup temporary file dan retention data bersifat terukur. Retention destructive tetap menunggu kebijakan umur data.

## 8. Release dan rollback

Urutan release manual yang dikontrak source:

1. Freeze SHA frontend dan backend; pastikan quality gate SHA tersebut hijau.
2. `npm ci` pada masing-masing repository.
3. Jalankan release contract backend.
4. Bangun frontend dengan environment instance tujuan.
5. Jalankan `prisma generate` dan `prisma migrate deploy` menggunakan migration role.
6. Jalankan production preflight untuk environment, RLS, storage, Redis, queue, cache, worker, serta build.
7. Restart tepat empat proses instance melalui process manager.
8. Uji konfigurasi/reload reverse proxy bila berubah.
9. Jalankan `/health`, `/ready`, frontend HTTPS, dan post-deploy verifier.
10. Simpan process topology dan bukti SHA yang berjalan.

Rollback source harus memakai commit/build terdahulu secara non-destruktif. Migration database tidak boleh dihapus atau di-rollback manual tanpa migration korektif dan prosedur restore yang telah diuji. Karena backup/restore masih deferred, kemampuan rollback data belum boleh diklaim production-ready.

## 9. Risiko dan pekerjaan terbuka

- Backup database, backup file, off-VPS copy, jadwal, enkripsi, retention, dan restore drill belum menjadi kemampuan terverifikasi.
- RPO/RTO dan otoritas restore belum diputuskan.
- Collector log/trace, dashboard, alert, serta OpenTelemetry production belum tersedia sebagai bukti lokal.
- `pg_stat_statements` dan konfigurasi PostgreSQL host memerlukan administrator.
- Retention destructive masih menunggu keputusan bisnis.
- Load smoke lokal bukan load/soak/failover test production.
- PDF iDeb dapat dibaca, tetapi belum merupakan tagged PDF aksesibel.
- Email delivery nyata, GPS perangkat fisik, printer/scanner, dan reverse proxy security hanya dapat ditutup di environment tujuan.
