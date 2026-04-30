const service = require("./menus.service");

exports.getAll = async (req, res) => {
  try {
    const result = await service.getAllMenus();
    return res.status(200).json({
      status: true,
      data: result,
      message: "Success",
    });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

exports.getById = async (req, res) => {
  try {
    const result = await service.getMenuById(req.params.id);
    return res.status(200).json({ status: true, data: result });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const result = await service.createMenu(req.body);
    return res.status(201).json({
      status: true,
      data: result,
      message: "Menu created successfully",
    });
  } catch (err) {
    return res.status(400).json({ status: false, message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const result = await service.updateMenu(req.params.id, req.body);
    return res.status(200).json({
      status: true,
      message: "Menu updated successfully",
      data: result,
    });
  } catch (err) {
    return res.status(400).json({ status: false, message: err.message });
  }
};

exports.delete = async (req, res) => {
  try {
    await service.deleteMenu(req.params.id);
    return res
      .status(200)
      .json({ status: true, message: "Menu deleted successfully", data: null });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
};
