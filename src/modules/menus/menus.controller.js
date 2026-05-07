const service = require("./menus.service");

function resolveStatusCode(error, fallback = 400) {
  return error.statusCode || fallback;
}

exports.getAll = async (req, res) => {
  try {
    const result = await service.getAllMenus(req.user);
    return res.status(200).json({
      status: true,
      data: result,
      message: "Menu berhasil dimuat",
    });
  } catch (error) {
    return res
      .status(resolveStatusCode(error, 400))
      .json({ status: false, message: error.message });
  }
};

exports.getAllForManagement = async (req, res) => {
  try {
    const result = await service.getAllMenusForManagement();
    return res.status(200).json({
      status: true,
      data: result,
      message: "Menu berhasil dimuat",
    });
  } catch (error) {
    return res
      .status(resolveStatusCode(error, 400))
      .json({ status: false, message: error.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const result = await service.getMenuById(req.params.id, req.user);
    return res.status(200).json({ status: true, data: result });
  } catch (error) {
    return res
      .status(resolveStatusCode(error, 400))
      .json({ status: false, message: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const result = await service.createMenu(req.body);
    return res.status(201).json({
      status: true,
      data: result,
      message: "Menu berhasil dibuat",
    });
  } catch (error) {
    return res
      .status(resolveStatusCode(error, 400))
      .json({ status: false, message: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const result = await service.updateMenu(req.params.id, req.body);
    return res.status(200).json({
      status: true,
      message: "Menu berhasil diperbarui",
      data: result,
    });
  } catch (error) {
    return res
      .status(resolveStatusCode(error, 400))
      .json({ status: false, message: error.message });
  }
};

exports.delete = async (req, res) => {
  try {
    await service.deleteMenu(req.params.id);
    return res
      .status(200)
      .json({ status: true, message: "Menu berhasil dihapus", data: null });
  } catch (error) {
    return res
      .status(resolveStatusCode(error, 400))
      .json({ status: false, message: error.message });
  }
};
