const {AppError} = require('../../utils/errors');
exports.CONTACT_USED_MESSAGE = 'Kontak masih dipakai draf atau versi yang disetujui, atau pengirimannya belum selesai. Ganti kontak publikasi atau arsipkan publikasinya terlebih dahulu.';
exports.hasContactReferences = async (client, id) => {
  const rows = await client.$queryRaw`SELECT public.ruwang_arsip_sj_contact_referenced(${id}::text) AS used`;
  if (rows.length !== 1 || typeof rows[0].used !== 'boolean') {
    throw new AppError('Penggunaan kontak belum bisa diperiksa. Coba lagi.', 503);
  }
  return rows[0].used;
};
