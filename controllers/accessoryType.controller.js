const AccessoryType = require('../models/accessoryType.model');

const DEFAULT_ACCESSORY_TYPES = [
  { accessoryTypeName: "RFID", description: "RFID accessory" },
  { accessoryTypeName: "Fuel sensor - wired", description: "Wired fuel sensor accessory" },
  { accessoryTypeName: "Fuel sensor - wireless", description: "Wireless fuel sensor accessory" },
  { accessoryTypeName: "RelayTemperature sensor", description: "Relay temperature sensor accessory" },
  { accessoryTypeName: "Door sensor", description: "Door sensor accessory" },
  { accessoryTypeName: "Drum rotation sensor", description: "Drum rotation sensor accessory" },
  { accessoryTypeName: "SD card", description: "SD card accessory" },
  { accessoryTypeName: "4g router", description: "4G router accessory" },
  { accessoryTypeName: "wifi dongle", description: "WiFi dongle accessory" },
];

function normalizeString(name) {
  return name.trim().replace(/\s+/g, ' ');
}

// Ensure default accessory types exist if collection is empty
const ensureDefaultAccessoryTypes = async () => {
  const count = await AccessoryType.countDocuments();
  if (count === 0) {
    await AccessoryType.insertMany(DEFAULT_ACCESSORY_TYPES);
    console.log("Default accessory types seeded successfully");
  }
};

// Get all active accessory types (for dropdowns / multi-select options)
exports.getAllAccessoryTypes = async (req, res) => {
  try {
    await ensureDefaultAccessoryTypes();
    const accessoryTypes = await AccessoryType.find({ isActive: { $ne: false } }).sort({ accessoryTypeName: 1 });
    return res.status(200).json({
      success: true,
      message: 'Accessory types fetched successfully',
      data: accessoryTypes,
    });
  } catch (err) {
    console.error("Error fetching accessory types:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Get all accessory types for table display (with pagination and search)
exports.getAllAccessoryTypesForTableShow = async (req, res) => {
  try {
    await ensureDefaultAccessoryTypes();
    const { page = 1, limit = 10, search = '' } = req.query;
    const skip = (page - 1) * limit;

    const searchQuery = search
      ? {
          accessoryTypeName: {
            $regex: normalizeString(search),
            $options: 'i',
          },
        }
      : {};

    const total = await AccessoryType.countDocuments(searchQuery);
    const accessoryTypes = await AccessoryType.find(searchQuery)
      .populate('createdBy', 'firstName lastName name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    return res.status(200).json({
      success: true,
      message: 'Accessory types fetched successfully',
      data: accessoryTypes,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("Error fetching accessory types for table:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Create a new accessory type
exports.createAccessoryType = async (req, res) => {
  try {
    const { accessoryTypeName, description } = req.body;

    if (!accessoryTypeName || !accessoryTypeName.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Accessory type name is required',
      });
    }

    const trimmedName = normalizeString(accessoryTypeName);

    const existing = await AccessoryType.findOne({
      accessoryTypeName: { $regex: new RegExp(`^${trimmedName}$`, 'i') },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'An accessory type with this name already exists',
      });
    }

    const newAccessoryType = new AccessoryType({
      accessoryTypeName: trimmedName,
      description: description ? description.trim() : '',
      createdBy: req.user?._id,
    });

    await newAccessoryType.save();

    return res.status(201).json({
      success: true,
      message: 'Accessory type created successfully',
      data: newAccessoryType,
    });
  } catch (err) {
    console.error("Error creating accessory type:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Update an existing accessory type
exports.updateAccessoryType = async (req, res) => {
  try {
    const { id } = req.params;
    const { accessoryTypeName, description, isActive } = req.body;

    const accessoryType = await AccessoryType.findById(id);
    if (!accessoryType) {
      return res.status(404).json({
        success: false,
        message: 'Accessory type not found',
      });
    }

    if (accessoryTypeName && accessoryTypeName.trim()) {
      const trimmedName = normalizeString(accessoryTypeName);
      const duplicate = await AccessoryType.findOne({
        _id: { $ne: id },
        accessoryTypeName: { $regex: new RegExp(`^${trimmedName}$`, 'i') },
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Another accessory type with this name already exists',
        });
      }
      accessoryType.accessoryTypeName = trimmedName;
    }

    if (description !== undefined) {
      accessoryType.description = description;
    }

    if (isActive !== undefined) {
      accessoryType.isActive = isActive;
    }

    await accessoryType.save();

    return res.status(200).json({
      success: true,
      message: 'Accessory type updated successfully',
      data: accessoryType,
    });
  } catch (err) {
    console.error("Error updating accessory type:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Delete an accessory type (supports deleting by _id or by accessoryTypeName)
exports.deleteAccessoryType = async (req, res) => {
  try {
    const { id } = req.params;
    const mongoose = require('mongoose');
    let deleted = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      deleted = await AccessoryType.findByIdAndDelete(id);
    }
    if (!deleted) {
      deleted = await AccessoryType.findOneAndDelete({
        accessoryTypeName: { $regex: new RegExp(`^${id}$`, 'i') },
      });
    }

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Accessory type not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Accessory type deleted successfully',
      data: deleted,
    });
  } catch (err) {
    console.error("Error deleting accessory type:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Export accessory types
exports.exportAccessoryTypes = async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    let query = {};
    if (fromDate && toDate) {
      const dayjs = require('dayjs');
      const from = dayjs(fromDate).startOf("day").toDate();
      const to = dayjs(toDate).endOf("day").toDate();
      query.createdAt = { $gte: from, $lte: to };
    }
    const accessoryTypes = await AccessoryType.find(query)
      .populate('createdBy', 'name email firstName lastName')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: 'Accessory types exported successfully',
      data: accessoryTypes,
    });
  } catch (err) {
    console.error("Error exporting accessory types:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Seed default accessory types explicitly
exports.seedDefaultAccessoryTypes = async (req, res) => {
  try {
    for (const def of DEFAULT_ACCESSORY_TYPES) {
      await AccessoryType.updateOne(
        { accessoryTypeName: def.accessoryTypeName },
        { $setOnInsert: def },
        { upsert: true }
      );
    }

    const all = await AccessoryType.find().sort({ accessoryTypeName: 1 });
    return res.status(200).json({
      success: true,
      message: 'Default accessory types seeded / verified successfully',
      data: all,
    });
  } catch (err) {
    console.error("Error seeding default accessory types:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};
