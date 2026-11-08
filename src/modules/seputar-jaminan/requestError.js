const { logErrorOnce } = require('../../system/error-observability');

// Do not log SQL, command envelopes, payloads or raw driver messages. The shared
// logger attaches the request ID; bounded error class/code support diagnosis.
function requestError(res, error, log = logErrorOnce) {
  const status = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599
    ? error.statusCode : 500;
  if (status >= 500) {
    const safe = new Error('Permintaan Seputar Jaminan gagal diproses.');
    safe.name = /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(error?.name) ? error.name : 'Error';
    const code = /^[A-Z0-9_]{1,40}$/.test(error?.code) ? error.code : 'UNEXPECTED_ERROR';
    log(safe, {event:'sj_request_failed', message:'Seputar Jaminan request failed', fields:{code,status}});
  }
  return res.status(status).json({status:false,success:false,
    message:status>=500 ? 'Permintaan belum dapat diproses.' : error.message});
}
module.exports={requestError};
