const service = require("./controlReview.service");

exports.handleRecovery = async (req,res) => {
  res.setHeader('Cache-Control','private, no-store');
  try {
    const result=await service.handleRecovery(req);
    for(const [name,value] of Object.entries(result.headers))res.setHeader(name,value);
    return res.status(200).type('application/json').send(result.body);
  } catch(error) {
    return res.status(error.statusCode||500).json({success:false,
      message:error.statusCode?error.message:'Hasil pemulihan belum dapat dipastikan.'});
  }
};

exports.getCommandDelivery = async (req,res) => {
  res.setHeader('Cache-Control','private, no-store');
  try {
    const result=await service.getCommandDelivery(req);
    for(const [name,value] of Object.entries(result.headers))res.setHeader(name,value);
    return res.status(200).type('application/json').send(result.body);
  }catch(error){return res.status(error.statusCode||500).json({success:false,message:error.statusCode?error.message:'Bukti pengiriman belum dapat dimuat.'});}
};

exports.getCommandResult = async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  try {
    const result = await service.getCommandResult(req);
    for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
    return res.status(200).type("application/json").send(result.body);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false,
      message: error.statusCode ? error.message : "Hasil pemeriksaan belum dapat dimuat." });
  }
};

exports.createCommand = async (req, res) => {
  try {
    const result = await service.handleCommand(req);
    for (const [name, value] of Object.entries(result.headers)) {
      res.setHeader(name, value);
    }
    return res
      .status(200)
      .type("application/json")
      .send(result.body);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: false,
      success: false,
      message: error.statusCode
        ? error.message
        : "Perintah pemeriksaan belum dapat diproses.",
    });
  }
};

exports.getMedia = async (req, res) => {
  try {
    const result = await service.getReviewMedia(req, req.params.mediaId);
    for (const [name, value] of Object.entries(result.headers)) {
      res.setHeader(name, value);
    }
    res.setHeader("Content-Type", result.mime);
    res.setHeader("Content-Length", String(result.buffer.length));
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.status(200).end(result.buffer);
    return undefined;
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: false,
      success: false,
      message: error.statusCode ? error.message : "Media pemeriksaan belum dapat dimuat.",
    });
  }
};
