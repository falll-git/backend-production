// A queued snapshot belongs to the installation that created it. Never relabel
// its immutable payload or send it with another installation's transport keys.
function controlSnapshotTargetBlock(row, settings) {
  if (row.event_type !== 'CONTROL_REVIEW_SNAPSHOT') return null;
  const expected = settings?.installation_id;
  const actual = row.payload_json?.instance_id;
  if (typeof expected !== 'string' || !expected || typeof actual !== 'string' || !actual) {
    return { code: 'CONTROL_SNAPSHOT_INSTANCE_MISSING', reason: 'Identitas pengiriman belum lengkap. Minta pengelola memeriksa konfigurasi.' };
  }
  if (actual !== expected) {
    return { code: 'CONTROL_SNAPSHOT_INSTANCE_MISMATCH', reason: 'Pengiriman ini berasal dari instalasi lain atau konfigurasi lama. Tidak bisa dikirim ulang dengan koneksi sekarang; riwayatnya tetap disimpan.' };
  }
  return null;
}

module.exports = { controlSnapshotTargetBlock };
