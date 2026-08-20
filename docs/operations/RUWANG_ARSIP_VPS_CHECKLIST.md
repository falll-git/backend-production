# Checklist Verifikasi VPS Ruwang Arsip

Dokumen ini adalah checklist operasi, bukan bukti bahwa VPS telah lulus. Jangan menandai item sebagai lulus tanpa output command, timestamp, instance, dan SHA yang diperiksa.

## Legenda bukti

- **VERIFIED LOCALLY**: terbukti pada source/database disposable/local quality gate kandidat.
- **SOURCE-DERIVED**: diwajibkan atau dideskripsikan oleh source, tetapi belum dibuktikan pada VPS.
- **UNVERIFIED**: memerlukan pemeriksaan langsung pada VPS/layanan eksternal.
- **ADMIN REQUIRED**: memerlukan hak administrator host/database/network.
- **BUSINESS DECISION**: memerlukan kebijakan pemilik sistem/konseptor.

## 1. Inventaris instance historis yang wajib diverifikasi ulang

Nilai di bawah berasal dari riwayat konfigurasi proyek, bukan live check. Nama database, process, path, dan port harus dibaca kembali dari environment, PM2, Nginx, listener, serta PostgreSQL sebelum release.

| Instance | Domain historis | Root historis | FE/API | Redis DB | Status |
| --- | --- | --- | --- | --- | --- |
| Demo | `demo.ruwangarsip.com` | `/var/www/ruwang-arsip-demo` | 3000 / 7111 | 0 | UNVERIFIED |
| Artha Madani | `arthamadani.ruwangarsip.com` | `/var/www/ruwang-arsip-arthamadani` | rencana 3001 / 7112 | rencana 1 | UNVERIFIED |
| Bogor Tegar Beriman | `bogortegarberiman.ruwangarsip.com` | `/var/www/ruwang-arsip-bogortegarberiman` | 3002 / 7113 | 2 | UNVERIFIED |
| Riyal Risyadi | `riyalrisyadi.ruwangarsip.com` | `/var/www/ruwang-arsip-riyalrisyadi` | 3003 / 7114 | 3 | UNVERIFIED |

Untuk setiap instance, rekam:

- [ ] domain, DNS A/AAAA, public IP, dan tanggal pemeriksaan — UNVERIFIED
- [ ] root frontend/backend aktual dan owner/group — UNVERIFIED
- [ ] SHA frontend dan backend yang sedang berjalan — UNVERIFIED
- [ ] nama database, runtime role, system role, migration role — UNVERIFIED
- [ ] nama proses frontend/API/SLIK/watermark — UNVERIFIED
- [ ] port listener internal dan port yang benar-benar exposed — UNVERIFIED
- [ ] Redis URL/database, key prefix, queue name, heartbeat prefix — UNVERIFIED
- [ ] `UPLOAD_DIR`/temporary directory dan permission — UNVERIFIED
- [ ] branding dan origin frontend instance — UNVERIFIED

Jangan menyalin secret ke laporan. Untuk URL database tampilkan hanya host, database, dan user; password selalu disamarkan.

## 2. Preflight host

- [ ] OS, kernel, timezone, NTP, uptime — ADMIN REQUIRED
- [ ] kapasitas filesystem, inode, LVM, mount persistent storage — ADMIN REQUIRED
- [ ] versi Node sesuai `^22.12 || 24.x`, npm, PM2/process manager — SOURCE-DERIVED
- [ ] service Nginx, PostgreSQL, Redis aktif dan enabled — ADMIN REQUIRED
- [ ] listener hanya pada interface yang diperlukan — ADMIN REQUIRED
- [ ] firewall menutup port PostgreSQL, Redis, dan API internal dari publik — ADMIN REQUIRED
- [ ] rotasi credential yang pernah terekspos — ADMIN REQUIRED
- [ ] tidak ada `.env`, backup, upload, log sensitif, atau key di Git — SOURCE-DERIVED

## 3. Source dan release boundary per instance

- [ ] remote Git dan branch benar; working tree bersih sebelum pull — UNVERIFIED
- [ ] origin SHA sama dengan release SHA yang disetujui — UNVERIFIED
- [ ] file environment dan persistent storage tetap di luar operasi Git — SOURCE-DERIVED
- [ ] `node_modules` dibentuk dengan `npm ci`, bukan disalin dari mesin lain — SOURCE-DERIVED
- [ ] frontend dibangun memakai environment/origin/branding instance tersebut — SOURCE-DERIVED
- [ ] tidak ada auto-deploy; release dilakukan manual sesuai persetujuan — SOURCE-DERIVED
- [ ] release contract, production preflight, dan post-deploy verifier disimpan hasilnya — SOURCE-DERIVED

## 4. Database dan RLS per instance

- [ ] PostgreSQL dapat diakses hanya dari host/network yang diizinkan — ADMIN REQUIRED
- [ ] application role bukan superuser, bukan `BYPASSRLS`, bukan `CREATEDB/CREATEROLE` — SOURCE-DERIVED
- [ ] system role terpisah dan hanya dipakai worker/system action yang disetujui — SOURCE-DERIVED
- [ ] migration role terpisah dari runtime role — SOURCE-DERIVED
- [ ] `prisma migrate status` up to date — UNVERIFIED
- [ ] `prisma migrate deploy` dijalankan sekali pada release — SOURCE-DERIVED
- [ ] schema diff setelah deploy kosong — UNVERIFIED
- [ ] seluruh tabel yang diwajibkan memakai RLS dan FORCE RLS — SOURCE-DERIVED
- [ ] policy count, public grants, helper function, dan runtime isolation lulus — UNVERIFIED
- [ ] invalid index, dead tuple, ukuran tabel/index, slow query tersedia pada laporan — SOURCE-DERIVED
- [ ] `pg_stat_statements` dipasang/configure dan hasilnya dipantau — ADMIN REQUIRED
- [ ] 12 kandidat foreign-key index yang masih relevan direview terhadap query production — ADMIN REQUIRED

## 5. Redis, cache, limiter, dan worker

- [ ] Redis mempunyai auth/network restriction dan persistence yang sesuai — ADMIN REQUIRED
- [ ] Redis DB atau namespace terisolasi untuk setiap BPRS — SOURCE-DERIVED
- [ ] `RATE_LIMIT_KEY_PREFIX`, `APP_CACHE_KEY_PREFIX`, queue name, dan heartbeat prefix memuat `APP_INSTANCE_KEY` — SOURCE-DERIVED
- [ ] production memakai Redis rate-limit store, bukan memory map — SOURCE-DERIVED
- [ ] SLIK queue aktif, local fallback nonaktif, worker diwajibkan — SOURCE-DERIVED
- [ ] worker SLIK hidup, startup recovery selesai, heartbeat sehat — UNVERIFIED
- [ ] worker watermark hidup, startup recovery selesai, heartbeat sehat — UNVERIFIED
- [ ] failure Redis/worker membuat readiness gagal dan memicu alert — UNVERIFIED
- [ ] retry, dead-letter/failed job, dan cleanup job dipantau — UNVERIFIED

## 6. Persistent storage

- [ ] `UPLOAD_DIR` absolut, writable, dan berada di luar source/release — SOURCE-DERIVED
- [ ] `UPLOAD_TEMP_DIR` terpisah dan TTL cleanup terkonfigurasi — SOURCE-DERIVED
- [ ] semua file privat hanya diakses melalui backend berizin — SOURCE-DERIVED
- [ ] kapasitas dan inode threshold sesuai disk instance — UNVERIFIED
- [ ] reconciliation database-versus-disk: missing, orphan, duplicate, checksum — UNVERIFIED
- [ ] dry-run cleanup temporary tidak menyentuh job aktif — SOURCE-DERIVED
- [ ] file lama hanya dihapus setelah transaksi database berhasil — VERIFIED LOCALLY
- [ ] upload baru dibersihkan bila transaksi database gagal — VERIFIED LOCALLY

## 7. Nginx, HTTPS, DNS, dan network

- [ ] `server_name` tepat untuk instance — UNVERIFIED
- [ ] proxy frontend dan `/api` menunjuk port instance yang benar — UNVERIFIED
- [ ] WebSocket/stream header hanya bila dibutuhkan — UNVERIFIED
- [ ] request/body/upload timeout dan size sesuai kontrak aplikasi — UNVERIFIED
- [ ] TLS certificate valid, chain lengkap, renewal Certbot teruji — UNVERIFIED
- [ ] HTTP redirect ke HTTPS; HSTS, CSP, anti-frame, MIME protection tampak pada respons publik — UNVERIFIED
- [ ] cookie Secure/SameSite/Domain benar pada domain publik — UNVERIFIED
- [ ] CORS hanya mengizinkan origin instance — UNVERIFIED
- [ ] WAF/CDN bila dipakai hanya untuk aset publik; dokumen privat tidak masuk CDN publik — BUSINESS DECISION

## 8. Process manager dan health

Empat proses wajib per instance:

- [ ] frontend — UNVERIFIED
- [ ] API (`RUNTIME_ROLE=api`) — UNVERIFIED
- [ ] SLIK import worker — UNVERIFIED
- [ ] watermark worker — UNVERIFIED

Pemeriksaan:

- [ ] environment tiap proses berasal dari instance yang benar — UNVERIFIED
- [ ] restart policy, startup service, memory limit, dan log path — UNVERIFIED
- [ ] `pm2 save`/startup topology sesuai — UNVERIFIED
- [ ] API `/health` 200 — UNVERIFIED
- [ ] API `/ready` 200 dan dependency detail tidak membocorkan secret — UNVERIFIED
- [ ] frontend HTTPS 200 dan memakai API origin yang sama/diizinkan — UNVERIFIED
- [ ] SLIK dan watermark heartbeat sehat — UNVERIFIED
- [ ] graceful shutdown dan startup recovery diuji — UNVERIFIED
- [ ] restart/failure Redis, worker, API, dan frontend tidak merusak job/data — UNVERIFIED

## 9. Log, monitoring, dan observability

- [ ] API, SLIK worker, watermark worker menulis structured JSON stdout — SOURCE-DERIVED
- [ ] Nginx, Redis, PostgreSQL, host, dan process manager dikumpulkan — UNVERIFIED
- [ ] log rotation, disk quota, permission, dan retention — ADMIN REQUIRED
- [ ] central collector dan credential collector — ADMIN REQUIRED
- [ ] dashboard error rate, latency, 429, queue lag, worker heartbeat, DB, Redis, disk/inode — UNVERIFIED
- [ ] alert otomatis dengan penerima dan escalation path — BUSINESS DECISION
- [ ] OTLP collector/endpoint diuji sebelum `OTEL_ENABLED=true` — ADMIN REQUIRED
- [ ] request ID dapat dikorelasikan frontend, Nginx, API, worker, dan error event — UNVERIFIED
- [ ] `system_activity_logs` retention tetap report-only sampai umur data diputuskan — BUSINESS DECISION

## 10. Backup, recovery, dan availability

Bagian ini adalah blocker production yang belum boleh dianggap selesai:

- [ ] RPO: kehilangan data maksimum yang dapat diterima — BUSINESS DECISION
- [ ] RTO: waktu pemulihan maksimum — BUSINESS DECISION
- [ ] jadwal backup PostgreSQL — BUSINESS DECISION
- [ ] jadwal/snapshot file upload — BUSINESS DECISION
- [ ] retention dan kapasitas backup — BUSINESS DECISION
- [ ] salinan terenkripsi off-VPS — ADMIN REQUIRED
- [ ] owner yang boleh menjalankan restore — BUSINESS DECISION
- [ ] restore database dan file ke environment disposable — UNVERIFIED
- [ ] verifikasi konsistensi database-file setelah restore — UNVERIFIED
- [ ] jadwal restore drill dan bukti hasil — BUSINESS DECISION
- [ ] monitoring backup gagal/terlambat — UNVERIFIED
- [ ] storage replication/failover bila diperlukan — BUSINESS DECISION
- [ ] disaster-recovery runbook yang disetujui — BUSINESS DECISION

Backup tidak otomatis ditambahkan oleh repository kandidat ini. Jangan menyebut sistem siap recovery sebelum backup dan restore drill benar-benar dibuktikan.

## 11. Pemeriksaan fungsional eksternal

- [ ] email forgot/reset/set password benar-benar diterima dan link sekali pakai — UNVERIFIED
- [ ] domain pengirim, SPF, DKIM, DMARC, bounce/complaint — UNVERIFIED
- [ ] GPS perangkat fisik dan browser permission — UNVERIFIED
- [ ] printer/scanner dan hasil cetak fisik — UNVERIFIED
- [ ] Chromium, Firefox, dan WebKit pada environment publik — VERIFIED LOCALLY untuk browser automation; UNVERIFIED pada perangkat pengguna
- [ ] load/soak/concurrency dengan kapasitas production — UNVERIFIED
- [ ] failover database/Redis/storage/network — UNVERIFIED
- [ ] tagged PDF aksesibel untuk iDeb — UNVERIFIED / belum diimplementasikan

## 12. Post-deploy evidence per instance

Simpan tanpa secret:

- [ ] timestamp dan operator
- [ ] SHA frontend/backend
- [ ] migration status dan schema diff
- [ ] database security/RLS report
- [ ] storage/reconciliation report
- [ ] Redis/worker heartbeat
- [ ] process list dan restart count
- [ ] Nginx test dan certificate expiry
- [ ] internal health/readiness
- [ ] public HTTPS smoke untuk route dan role kritis
- [ ] upload/download privat
- [ ] import queue dan watermark job
- [ ] logout/single-session/refresh
- [ ] error/log correlation dengan request ID
- [ ] rollback decision dan hasil observasi sesudah release

## 13. Status lokal kandidat

Kandidat sebelum commit telah dibuktikan secara lokal melalui database kosong, upgrade disposable, application-role RLS, unit/integration, production build, browser desktop/tablet/HP, Chromium/Firefox/WebKit, full-stack UI–API–PostgreSQL, dependency audit, dan load smoke. Bukti final tetap harus dijalankan ulang terhadap SHA commit final dan tidak menggantikan seluruh item UNVERIFIED di atas.
