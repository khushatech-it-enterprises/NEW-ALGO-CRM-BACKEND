const AssetType = require('../models/assetType.model');

const DEFAULT_ASSET_TYPES = [
  { assetTypeName: "Truck", description: "Truck vehicle asset" },
  { assetTypeName: "Refer", description: "Refer vehicle asset" },
  { assetTypeName: "Equipment", description: "Heavy or specialized equipment" },
  { assetTypeName: "Cold Storage", description: "Cold storage facility / unit" },
  { assetTypeName: "Visicooler", description: "Visicooler refrigeration unit" },
  { assetTypeName: "ConcretePump", description: "Concrete pump asset" },
];

function normalizeString(name) {
  return name.trim().replace(/\s+/g, ' ');
}

// Ensure default asset types exist if collection is empty
const ensureDefaultAssetTypes = async () => {
  const count = await AssetType.countDocuments();
  if (count === 0) {
    await AssetType.insertMany(DEFAULT_ASSET_TYPES);
    console.log("Default asset types seeded successfully");
  }
};

// Get all active asset types (for dropdowns / multi-select options)
exports.getAllAssetTypes = async (req, res) => {
  try {
    await ensureDefaultAssetTypes();
    const assetTypes = await AssetType.find({ isActive: { $ne: false } }).sort({ assetTypeName: 1 });
    return res.status(200).json({
      success: true,
      message: 'Asset types fetched successfully',
      data: assetTypes,
    });
  } catch (err) {
    console.error("Error fetching asset types:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Get all asset types for table display (with pagination and search)
exports.getAllAssetTypesForTableShow = async (req, res) => {
  try {
    await ensureDefaultAssetTypes();
    const { page = 1, limit = 10, search = '' } = req.query;
    const skip = (page - 1) * limit;

    const searchQuery = search
      ? {
          assetTypeName: {
            $regex: normalizeString(search),
            $options: 'i',
          },
        }
      : {};

    const total = await AssetType.countDocuments(searchQuery);
    const assetTypes = await AssetType.find(searchQuery)
      .populate('createdBy', 'firstName lastName name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    return res.status(200).json({
      success: true,
      message: 'Asset types fetched successfully',
      data: assetTypes,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("Error fetching asset types for table:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Create a new asset type
exports.createAssetType = async (req, res) => {
  try {
    const { assetTypeName, description } = req.body;

    if (!assetTypeName || !assetTypeName.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Asset type name is required',
      });
    }

    const trimmedName = normalizeString(assetTypeName);

    const existing = await AssetType.findOne({
      assetTypeName: { $regex: new RegExp(`^${trimmedName}$`, 'i') },
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'An asset type with this name already exists',
      });
    }

    const newAssetType = new AssetType({
      assetTypeName: trimmedName,
      description: description ? description.trim() : '',
      createdBy: req.user?._id,
    });

    await newAssetType.save();

    return res.status(201).json({
      success: true,
      message: 'Asset type created successfully',
      data: newAssetType,
    });
  } catch (err) {
    console.error("Error creating asset type:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Update an existing asset type
exports.updateAssetType = async (req, res) => {
  try {
    const { id } = req.params;
    const { assetTypeName, description, isActive } = req.body;

    const assetType = await AssetType.findById(id);
    if (!assetType) {
      return res.status(404).json({
        success: false,
        message: 'Asset type not found',
      });
    }

    if (assetTypeName && assetTypeName.trim()) {
      const trimmedName = normalizeString(assetTypeName);
      const duplicate = await AssetType.findOne({
        _id: { $ne: id },
        assetTypeName: { $regex: new RegExp(`^${trimmedName}$`, 'i') },
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Another asset type with this name already exists',
        });
      }
      assetType.assetTypeName = trimmedName;
    }

    if (description !== undefined) {
      assetType.description = description;
    }

    if (isActive !== undefined) {
      assetType.isActive = isActive;
    }

    await assetType.save();

    return res.status(200).json({
      success: true,
      message: 'Asset type updated successfully',
      data: assetType,
    });
  } catch (err) {
    console.error("Error updating asset type:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Delete an asset type (supports deleting by _id or by assetTypeName)
exports.deleteAssetType = async (req, res) => {
  try {
    const { id } = req.params;
    const mongoose = require('mongoose');
    let deleted = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      deleted = await AssetType.findByIdAndDelete(id);
    }
    if (!deleted) {
      deleted = await AssetType.findOneAndDelete({
        assetTypeName: { $regex: new RegExp(`^${id}$`, 'i') },
      });
    }

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Asset type not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Asset type deleted successfully',
      data: deleted,
    });
  } catch (err) {
    console.error("Error deleting asset type:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Seed default asset types explicitly
exports.seedDefaultAssetTypes = async (req, res) => {
  try {
    for (const def of DEFAULT_ASSET_TYPES) {
      await AssetType.updateOne(
        { assetTypeName: def.assetTypeName },
        { $setOnInsert: def },
        { upsert: true }
      );
    }

    const all = await AssetType.find().sort({ assetTypeName: 1 });
    return res.status(200).json({
      success: true,
      message: 'Default asset types seeded / verified successfully',
      data: all,
    });
  } catch (err) {
    console.error("Error seeding default asset types:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};
