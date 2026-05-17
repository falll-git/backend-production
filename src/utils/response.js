exports.successResponse = (res, data, message = "Berhasil") => {
  res.status(200).json({
    status: true,
    success: true,
    message,
    data,
  });
};

exports.paginatedResponse = (res, data, meta) => {
  res.status(200).json({
    status: true,
    success: true,
    meta,
    ...meta,
    data,
  });
};
