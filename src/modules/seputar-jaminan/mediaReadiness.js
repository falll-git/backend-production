// This projects the stored media state, not a public-page observation.
exports.isMediaReady = row => Boolean(row && row.state === 'READY' && row.central_media_id && !row.revoked_at);

// MediaService.createUploadSession returns newly allocated central IDs, not the
// bank source ID. Validate this response before persisting IDs or reading bytes.
exports.validateUploadSession = (value, sizeBytes, now = Date.now()) => {
  const keys = ['request_id','media_id','upload_session_id','upload_url','method','headers','expires_at','max_bytes'];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const invalid = () => {
    const error = new Error('Sesi upload gambar dari pusat belum valid.');
    error.code = 'CENTRAL_MEDIA_SESSION_INVALID';
    throw error;
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value,key))
    || typeof value.request_id !== 'string' || !value.request_id.trim()
    || !uuid.test(value.media_id) || !uuid.test(value.upload_session_id) || value.method !== 'PUT'
    || !Number.isSafeInteger(value.max_bytes) || value.max_bytes < 1
    || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || value.max_bytes < sizeBytes
    || typeof value.expires_at !== 'string' || !Number.isFinite(Date.parse(value.expires_at)) || Date.parse(value.expires_at) <= now
    || !value.headers || typeof value.headers !== 'object' || Array.isArray(value.headers)
    || Object.entries(value.headers).some(([key,header]) => !/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(key) || typeof header !== 'string' || /[\r\n\0]/.test(header))) invalid();
  let url;
  try { url = new URL(value.upload_url); } catch { invalid(); }
  if (typeof value.upload_url !== 'string' || !['https:','http:'].includes(url.protocol) || url.username || url.password || url.hash) invalid();
  return value;
};

// Existing media-service.ts DTO. Its checked_at concerns media only, not the
// availability/version of a publication or profile page.
exports.validateMediaStatus = (value, mediaId) => {
  const keys=['request_id','media_id','status','rejection_code','checked_at'];
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(k=>!keys.includes(k))
    ||value.media_id!==mediaId||!mediaId||typeof value.request_id!=='string'||!value.request_id
    ||!['AWAITING_UPLOAD','UPLOADED','PROCESSING','READY','REJECTED','REVOKED','QUARANTINED','EXPIRED'].includes(value.status)
    ||!(value.rejection_code===null||typeof value.rejection_code==='string')
    ||typeof value.checked_at!=='string'||!Number.isFinite(Date.parse(value.checked_at))){
    const error=new Error('Status gambar dari pusat belum valid.');error.code='CENTRAL_MEDIA_STATUS_INVALID';throw error;
  }
  return value;
};
