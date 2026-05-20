function toSizeBytesNumber(value) {
  if (value === undefined || value === null || value === "") return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function toSizeBytesBigInt(value) {
  const normalized = toSizeBytesNumber(value);
  return normalized === null ? null : BigInt(normalized);
}

module.exports = {
  toSizeBytesBigInt,
  toSizeBytesNumber,
};
