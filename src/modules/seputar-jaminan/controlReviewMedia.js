const { payloadDigest } = require('./controlReview.contract');

// Authorize immutable snapshot membership, never current aggregate membership.
// READY/revocation, current authority and immutable destination are checked by
// the caller in the same transaction before returning any storage bytes.
function snapshotContainsMedia(row, instanceId, snapshotId, mediaId) {
  const snapshot = row?.payload_json;
  if (row?.event_type !== 'CONTROL_REVIEW_SNAPSHOT' || row.aggregate_type !== 'CONTROL_REVIEW' ||
      row.aggregate_id !== snapshotId || snapshot?.snapshot_id !== snapshotId ||
      snapshot.instance_id !== instanceId || row.aggregate_version !== snapshot.source_version ||
      row.payload_checksum !== payloadDigest(snapshot)) return false;
  const detail = snapshot.detail;
  if (detail?.kind === 'profile') return detail.logo?.source_media_id === mediaId;
  if (detail?.kind === 'publication' || detail?.kind === 'change_request') {
    return Array.isArray(detail.media) && detail.media.some(media => media?.source_media_id === mediaId);
  }
  return false;
}

module.exports = { snapshotContainsMedia };
