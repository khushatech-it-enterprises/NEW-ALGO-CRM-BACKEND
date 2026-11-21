const SimType = require('../models/simType.model');

const DEFAULT_SIM_TYPES = [
  { simTypeName: "M2M", description: "Machine to Machine SIM" },
  { simTypeName: "Voice", description: "Voice SIM" },
];

function normalizeString(name) {
  return name.trim().replace(/\s+/g, ' ');
}

// Ensure default SIM types exist if collection is empty
const ensureDefaultSimTypes = async () => {
  const count = await SimType.countDocuments();
  if (count === 0) {
    await SimType.insertMany(DEFAULT_SIM_TYPES);
    console.log("Default SIM types seeded successfully");
  }
};

// Get all active SIM types (for dropdowns / multi-select options)
exports.getAllSimTypes = async (req, res) => {
  try {
    await ensureDefaultSimTypes();
    const simTypes = await SimType.find({ isActive: { $ne: false } }).sort({ simTypeName: 1 });
    return res.status(200).json({
      success: true,
      message: 'SIM types fetched successfully',
      data: simTypes,
    });
  } catch (err) {
    console.error("Error fetching SIM types:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Get all SIM types for table display (with pagination and search)
exports.getAllSimTypesForTableShow = async (req, res) => {
  try {
    await ensureDefaultSimTypes();
    const { page = 1, limit = 10, search = '' } = req.query;
    const skip = (page - 1) * limit;

    const searchQuery = search
      ? {
          simTypeName: {
            $regex: normalizeString(search),
            $options: 'i',
          },
        }
      : {};

    const total = await SimType.countDocuments(searchQuery);
    const simTypes = await SimType.find(searchQuery)
      .populate('createdBy', 'firstName lastName name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    return res.status(200).json({
      success: true,
      message: 'SIM types fetched successfully',
      data: simTypes,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("Error fetching SIM types for table:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Create a new SIM type
exports.createSimType = async (req, res) => {
  try {
    const { simTypeName, description } = req.body;

    if (!simTypeName || !simTypeName.trim()) {
      return res.status(400).json({
        success: false,
        message: 'SIM type name is required',
      });
    }

    const trimmedName = normalizeString(simTypeName);

    const existing = await SimType.findOne({
      simTypeName: { $regex: new RegExp(`^${trimmedName}$`, 'i') },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A SIM type with this name already exists',
      });
    }

    const newSimType = new SimType({
      simTypeName: trimmedName,
      description: description ? description.trim() : '',
      createdBy: req.user?._id,
    });

    await newSimType.save();

    return res.status(201).json({
      success: true,
      message: 'SIM type created successfully',
      data: newSimType,
    });
  } catch (err) {
    console.error("Error creating SIM type:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Update an existing SIM type
exports.updateSimType = async (req, res) => {
  try {
    const { id } = req.params;
    const { simTypeName, description, isActive } = req.body;

    const simType = await SimType.findById(id);
    if (!simType) {
      return res.status(404).json({
        success: false,
        message: 'SIM type not found',
      });
    }

    if (simTypeName && simTypeName.trim()) {
      const trimmedName = normalizeString(simTypeName);
      const duplicate = await SimType.findOne({
        _id: { $ne: id },
        simTypeName: { $regex: new RegExp(`^${trimmedName}$`, 'i') },
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Another SIM type with this name already exists',
        });
      }
      simType.simTypeName = trimmedName;
    }

    if (description !== undefined) {
      simType.description = description;
    }

    if (isActive !== undefined) {
      simType.isActive = isActive;
    }

    await simType.save();

    return res.status(200).json({
      success: true,
      message: 'SIM type updated successfully',
      data: simType,
    });
  } catch (err) {
    console.error("Error updating SIM type:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Delete a SIM type (supports deleting by _id or by simTypeName)
exports.deleteSimType = async (req, res) => {
  try {
    const { id } = req.params;
    const mongoose = require('mongoose');
    let deleted = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      deleted = await SimType.findByIdAndDelete(id);
    }
    if (!deleted) {
      deleted = await SimType.findOneAndDelete({
        simTypeName: { $regex: new RegExp(`^${id}$`, 'i') },
      });
    }

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'SIM type not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'SIM type deleted successfully',
      data: deleted,
    });
  } catch (err) {
    console.error("Error deleting SIM type:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Export SIM types
exports.exportSimTypes = async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    let query = {};
    if (fromDate && toDate) {
      const dayjs = require('dayjs');
      const from = dayjs(fromDate).startOf("day").toDate();
      const to = dayjs(toDate).endOf("day").toDate();
      query.createdAt = { $gte: from, $lte: to };
    }
    const simTypes = await SimType.find(query)
      .populate('createdBy', 'name email firstName lastName')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: 'SIM types exported successfully',
      data: simTypes,
    });
  } catch (err) {
    console.error("Error exporting SIM types:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Seed default SIM types explicitly
exports.seedDefaultSimTypes = async (req, res) => {
  try {
    for (const def of DEFAULT_SIM_TYPES) {
      await SimType.updateOne(
        { simTypeName: def.simTypeName },
        { $setOnInsert: def },
        { upsert: true }
      );
    }

    const all = await SimType.find().sort({ simTypeName: 1 });
    return res.status(200).json({
      success: true,
      message: 'Default SIM types seeded / verified successfully',
      data: all,
    });
  } catch (err) {
    console.error("Error seeding default SIM types:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};
