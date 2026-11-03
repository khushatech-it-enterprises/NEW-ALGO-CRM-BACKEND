const Server = require('../models/server.model');
const AssetType = require('../models/assetType.model');

const DEFAULT_SERVERS = [
  { serverName: "AlgoTrack", referType: "Yes", assetTypes: ["Truck", "Refer"] },
  { serverName: "AparTrack", referType: "No", assetTypes: ["Truck"] },
  { serverName: "DrumTrack", referType: "No", assetTypes: ["Truck"] },
  { serverName: "RMCTrack", referType: "No", assetTypes: ["Truck"] },
  { serverName: "SensorTrack", referType: "Yes", assetTypes: ["Refer"] },
  { serverName: "EVTrack", referType: "No", assetTypes: ["Truck"] },
  { serverName: "AlgoSenzTemp", referType: "Yes", assetTypes: ["Refer"] },
  { serverName: "AlgoTrackSchool", referType: "No", assetTypes: ["Truck"] },
  { serverName: "DistributorTrack", referType: "Yes", assetTypes: ["Refer"] },
  { serverName: "Uffizio", referType: "Yes", assetTypes: ["ConcretePump"] },
];

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

// Ensure default servers and asset types are seeded if collections are empty
const ensureDefaults = async () => {
  const serverCount = await Server.countDocuments();
  if (serverCount === 0) {
    await Server.insertMany(DEFAULT_SERVERS);
    console.log("Default servers seeded successfully");
  }

  const assetTypeCount = await AssetType.countDocuments();
  if (assetTypeCount === 0) {
    await AssetType.insertMany(DEFAULT_ASSET_TYPES);
    console.log("Default asset types seeded successfully");
  }
};

// Sync array of asset types to AssetType collection
const syncAssetTypesToDb = async (types, createdBy) => {
  if (!Array.isArray(types) || types.length === 0) return;
  for (const t of types) {
    const clean = t.trim();
    if (!clean) continue;
    await AssetType.updateOne(
      { assetTypeName: { $regex: new RegExp(`^${clean}$`, 'i') } },
      { $setOnInsert: { assetTypeName: clean, createdBy } },
      { upsert: true }
    );
  }
};

// Get all active servers (for dropdowns / form configuration)
exports.getAllServers = async (req, res) => {
  try {
    await ensureDefaults();
    const servers = await Server.find({ isActive: { $ne: false } }).sort({ serverName: 1 });
    return res.status(200).json({
      success: true,
      message: 'Servers fetched successfully',
      data: servers,
    });
  } catch (err) {
    console.error("Error fetching servers:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Get all servers for table display (with pagination and search)
exports.getAllServersForTableShow = async (req, res) => {
  try {
    await ensureDefaults();
    const { page = 1, limit = 10, search = '' } = req.query;
    const skip = (page - 1) * limit;

    const searchQuery = search
      ? {
          serverName: {
            $regex: normalizeString(search),
            $options: 'i',
          },
        }
      : {};

    const total = await Server.countDocuments(searchQuery);
    const servers = await Server.find(searchQuery)
      .populate('createdBy', 'firstName lastName name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    return res.status(200).json({
      success: true,
      message: 'Servers fetched successfully',
      data: servers,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("Error fetching servers for table:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Create a new server
exports.createServer = async (req, res) => {
  try {
    const { serverName, referType, assetTypes } = req.body;

    if (!serverName || !serverName.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Server name is required',
      });
    }

    const trimmedName = normalizeString(serverName);

    const existingServer = await Server.findOne({
      serverName: { $regex: new RegExp(`^${trimmedName}$`, 'i') },
    });

    if (existingServer) {
      return res.status(400).json({
        success: false,
        message: 'A server with this name already exists',
      });
    }

    const cleanAssetTypes = Array.isArray(assetTypes)
      ? assetTypes.map(t => t.trim()).filter(Boolean)
      : [];

    const newServer = new Server({
      serverName: trimmedName,
      referType: referType || 'No',
      assetTypes: cleanAssetTypes,
      createdBy: req.user?._id,
    });

    await newServer.save();

    // Sync any asset types to AssetType collection
    await syncAssetTypesToDb(cleanAssetTypes, req.user?._id);

    return res.status(201).json({
      success: true,
      message: 'Server created successfully',
      data: newServer,
    });
  } catch (err) {
    console.error("Error creating server:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Update an existing server
exports.updateServer = async (req, res) => {
  try {
    const { id } = req.params;
    const { serverName, referType, assetTypes, isActive } = req.body;

    const server = await Server.findById(id);
    if (!server) {
      return res.status(404).json({
        success: false,
        message: 'Server not found',
      });
    }

    if (serverName && serverName.trim()) {
      const trimmedName = normalizeString(serverName);
      const duplicate = await Server.findOne({
        _id: { $ne: id },
        serverName: { $regex: new RegExp(`^${trimmedName}$`, 'i') },
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Another server with this name already exists',
        });
      }
      server.serverName = trimmedName;
    }

    if (referType !== undefined) {
      server.referType = referType;
    }

    if (assetTypes !== undefined) {
      const cleanAssetTypes = Array.isArray(assetTypes)
        ? assetTypes.map(t => t.trim()).filter(Boolean)
        : [];
      server.assetTypes = cleanAssetTypes;
      await syncAssetTypesToDb(cleanAssetTypes, req.user?._id);
    }

    if (isActive !== undefined) {
      server.isActive = isActive;
    }

    await server.save();

    return res.status(200).json({
      success: true,
      message: 'Server updated successfully',
      data: server,
    });
  } catch (err) {
    console.error("Error updating server:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Delete a server
exports.deleteServer = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Server.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Server not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Server deleted successfully',
      data: deleted,
    });
  } catch (err) {
    console.error("Error deleting server:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};

// Seed default servers explicitly
exports.seedDefaultServers = async (req, res) => {
  try {
    for (const def of DEFAULT_SERVERS) {
      await Server.updateOne(
        { serverName: def.serverName },
        { $setOnInsert: def },
        { upsert: true }
      );
    }

    for (const at of DEFAULT_ASSET_TYPES) {
      await AssetType.updateOne(
        { assetTypeName: at.assetTypeName },
        { $setOnInsert: at },
        { upsert: true }
      );
    }

    const all = await Server.find().sort({ serverName: 1 });
    return res.status(200).json({
      success: true,
      message: 'Default servers and asset types seeded / verified successfully',
      data: all,
    });
  } catch (err) {
    console.error("Error seeding default servers:", err);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: err.message,
    });
  }
};
