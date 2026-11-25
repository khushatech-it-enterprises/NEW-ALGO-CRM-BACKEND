const accessoryMasterModel = require("../models/accessoryMaster");
const mongoose = require("mongoose");
const { computeWarrantyStatus } = require("../utils/warrantyUtils");
const { isDemoExpiringSoon } = require("../utils/demoPeriodChecker");

// exports.getAllAccessoryMasters = async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 20;
//     const skip = (page - 1) * limit;

//     const { search, sortOrder, sortBy } = req.query;

//     let searchQuery = {};
//     if (search) {
//       searchQuery = {
//         $or: [
//           { accessoryManufacturer: { $regex: search, $options: "i" } },
//           { accessoryType: { $regex: search, $options: "i" } },
//           { accessoryModel: { $regex: search, $options: "i" } },
//           { accessoryId: { $regex: search, $options: "i" } },
//           { invoiceNumber: { $regex: search, $options: "i" } },
//           { status: { $regex: search, $options: "i" } },
//         ],
//       };
//     }

//     const sortField = sortBy || "createdAt";
//     const sortDirection = sortOrder === "asc" ? 1 : -1;

//     const accessoryMasters = await accessoryMasterModel
//       .find(searchQuery)
//       .sort({ [sortField]: sortDirection })
//       .skip(skip)
//       .limit(limit);

//     const totalCount = await accessoryMasterModel.countDocuments(searchQuery);

//     const totalPages = Math.ceil(totalCount / limit);

//     const hasNextPage = page < totalPages;
//     const hasPreviousPage = page > 1;
//     res.status(200).json({
//       success: true,
//       accessoryMasters,
//       totalPages,
//       hasNextPage,
//       hasPreviousPage,
//       nextPage: hasNextPage ? page + 1 : null,
//       previousPage: hasPreviousPage ? page - 1 : null,
//     });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

// exports.createAccessoryMasters = async (req, res) => {
//   try {
//     const {
//       accessoryManufacturer,
//       accessoryType,
//       accessoryModel,
//       accessoryId,
//       invoiceDate,
//       invoiceNumber,
//       warrantyPeriod,
//       warrantyStatus,
//       status,
//       customerName,
//       age,
//     } = req.body;

//     const accessoryMaster = await accessoryMasterModel.create({
//       accessoryManufacturer,
//       accessoryType,
//       accessoryModel,
//       accessoryId,
//       invoiceDate,
//       invoiceNumber,
//       warrantyPeriod,
//       warnatyStatus: warrantyStatus,
//       status,
//       customerName,
//       Age: age,
//     });

//     await accessoryMaster.save();

//     res.status(201).json({
//       success: true,
//       message: "Accessory Master created successfully",
//       accessoryMaster,
//     });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

// exports.getAllAccessoryMasters = async (req, res) => {
//   try {
//     const page = parseInt(req.query.page, 10) || 1;
//     const limit = parseInt(req.query.limit, 10) || 20;
//     const skip = (page - 1) * limit;

//     const { search, sortOrder, sortBy } = req.query;

//     let searchQuery = {};
//     if (search) {
//       searchQuery = {
//         $or: [
//           { accessoryManufacturer: { $regex: search, $options: "i" } },
//           { accessoryType: { $regex: search, $options: "i" } },
//           { accessoryModel: { $regex: search, $options: "i" } },
//           { accessoryId: { $regex: search, $options: "i" } },
//           { invoiceNumber: { $regex: search, $options: "i" } },
//           { status: { $regex: search, $options: "i" } },
//         ],
//       };
//     }

//     const sortField = sortBy || "createdAt";
//     const sortDirection = String(sortOrder).toLowerCase() === "asc" ? 1 : -1;

//     const totalCount = await accessoryMasterModel.countDocuments(searchQuery);

//     const accessoryMastersRaw = await accessoryMasterModel
//       .find(searchQuery)
//       .sort({ [sortField]: sortDirection })
//       .skip(skip)
//       .limit(limit)
//       .lean();

//     const MS_PER_DAY = 1000 * 60 * 60 * 24;
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     const accessoryMasters = accessoryMastersRaw.map((a) => {
//       // stock days
//       let daysInStock = null;
//       if (a.status === "stock") {
//         const start = a.stockEnteredAt || a.createdAt;
//         daysInStock = start
//           ? Math.floor((Date.now() - new Date(start).getTime()) / MS_PER_DAY)
//           : 0;
//         if (daysInStock < 0) daysInStock = 0;
//       }

//       // demo badges
//       let demoDaysLeft = null;
//       let demoAlert = false;
//       let demoExpired = false;

//       if (a.status === "customer demo" && a.demoToDate) {
//         const end = new Date(a.demoToDate);
//         end.setHours(0, 0, 0, 0);

//         demoDaysLeft = Math.ceil((end - today) / MS_PER_DAY);
//         demoExpired = demoDaysLeft < 0;
//         demoAlert = isDemoExpiringSoon(a.demoToDate, 2); // today/1/2 days
//       }

//       return { ...a, daysInStock, demoDaysLeft, demoAlert, demoExpired };
//     });

//     const totalPages = Math.ceil(totalCount / limit);

//     res.status(200).json({
//       success: true,
//       accessoryMasters,
//       totalPages,
//       hasNextPage: page < totalPages,
//       hasPreviousPage: page > 1,
//       nextPage: page < totalPages ? page + 1 : null,
//       previousPage: page > 1 ? page - 1 : null,
//     });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// exports.createAccessoryMasters = async (req, res) => {
//   try {
//     const data = { ...req.body };

//     // ✅ never accept warrantyStatus from frontend
//     delete data.warrantyStatus;
//     delete data.warnatyStatus;

//     // ✅ status default
//     const finalStatus = data.status || "stock";

//     // ✅ demo rule
//     if (finalStatus === "customer demo") {
//       if (!data.demoFromDate || !data.demoToDate) {
//         return res.status(400).json({
//           success: false,
//           message: "demoFromDate and demoToDate are required when status is customer demo",
//         });
//       }

//       const from = new Date(data.demoFromDate);
//       const to = new Date(data.demoToDate);

//       if (isNaN(from.getTime()) || isNaN(to.getTime())) {
//         return res.status(400).json({
//           success: false,
//           message: "Invalid demoFromDate or demoToDate",
//         });
//       }

//       if (to < from) {
//         return res.status(400).json({
//           success: false,
//           message: "demoToDate cannot be earlier than demoFromDate",
//         });
//       }
//     } else {
//       data.demoFromDate = null;
//       data.demoToDate = null;
//     }

//     // ✅ ALWAYS auto-calc warranty
//     const autoWarranty = computeWarrantyStatus(data.invoiceDate, data.warrantyPeriod);
//     if (autoWarranty) data.warnatyStatus = autoWarranty;

//     const accessoryMaster = new accessoryMasterModel({
//       ...data,
//       status: finalStatus,
//       stockEnteredAt: finalStatus === "stock" ? new Date() : undefined,
//       statusHistory: [
//         {
//           status: finalStatus,
//           changedAt: new Date(),
//           changedBy: req.user?.name || req.user?.email || "system",
//         },
//       ],
//     });

//     await accessoryMaster.save();

//     res.status(201).json({
//       success: true,
//       message: "Accessory Master created successfully",
//       accessoryMaster,
//     });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

exports.getAllAccessoryMasters = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const { search, sortOrder, sortBy, status: statusFilter, assignedTo: assignedToFilter, testingStatus: testingStatusFilter, warrantyStatus: warrantyStatusFilter } = req.query;

    let searchQuery = {};
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      searchQuery = {
        $or: [
          { accessoryManufacturer: { $regex: escapedSearch, $options: "i" } },
          { accessoryType: { $regex: escapedSearch, $options: "i" } },
          { accessoryModel: { $regex: escapedSearch, $options: "i" } },
          { accessoryId: { $regex: escapedSearch, $options: "i" } },
          { invoiceNumber: { $regex: escapedSearch, $options: "i" } },
          { status: { $regex: escapedSearch, $options: "i" } },
          { accessoryPerRate: { $regex: escapedSearch, $options: "i" } },
        ],
      };
    }

    // ✅ filter by status if provided
    if (statusFilter) {
      searchQuery.status = statusFilter;
    }

    // ✅ filter by warrantyStatus if provided (note: field is warnatyStatus in model)
    if (warrantyStatusFilter) {
      searchQuery.warnatyStatus = warrantyStatusFilter;
    }

    // ✅ filter by assignedTo if provided
    if (assignedToFilter && mongoose.Types.ObjectId.isValid(assignedToFilter)) {
      searchQuery.assignedTo = new mongoose.Types.ObjectId(assignedToFilter);
    }

    if (testingStatusFilter) {
      searchQuery.testingStatus = testingStatusFilter;
    }

    // ✅ filter by isRepairable if provided
    const isRepairableFilter = req.query.isRepairable;
    if (isRepairableFilter === 'true') {
      searchQuery.isRepairable = true;
    } else if (isRepairableFilter === 'false') {
      searchQuery.isRepairable = { $ne: true };
    }

    const sortField = sortBy || "createdAt";
    const sortDirection = String(sortOrder).toLowerCase() === "asc" ? 1 : -1;

    const totalCount = await accessoryMasterModel.countDocuments(searchQuery);

    // ✅ populate assignedTo using refPath (assignedToModel)
    const accessoryMastersRaw = await accessoryMasterModel
      .find(searchQuery)
      .populate({
        path: "assignedTo",
        select: "name companyName", // Technician/Employee -> name, QstClient -> companyName
      })
      .sort({ [sortField]: sortDirection })
      .skip(skip)
      .limit(limit)
      .lean();

    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const accessoryMasters = accessoryMastersRaw.map((a) => {
      // ✅ assign name (works for any model)
      const assignedToName =
        a?.assignedTo?.companyName || a?.assignedTo?.name || null;

      // stock days
      let daysInStock = null;
      if (a.status === "stock") {
        const start = a.stockEnteredAt || a.createdAt;
        daysInStock = start
          ? Math.floor((Date.now() - new Date(start).getTime()) / MS_PER_DAY)
          : 0;
        if (daysInStock < 0) daysInStock = 0;
      }

      // demo badges
      let demoDaysLeft = null;
      let demoAlert = false;
      let demoExpired = false;

      if (a.status === "customer demo" && a.demoToDate) {
        const end = new Date(a.demoToDate);
        end.setHours(0, 0, 0, 0);

        demoDaysLeft = Math.ceil((end - today) / MS_PER_DAY);
        demoExpired = demoDaysLeft < 0;
        demoAlert = isDemoExpiringSoon(a.demoToDate, 2); // today/1/2
      }

      return {
        ...a,
        assignedToName, // ✅ add simple field for frontend
        daysInStock,
        demoDaysLeft,
        demoAlert,
        demoExpired,
      };
    });

    const totalPages = Math.ceil(totalCount / limit);

    res.status(200).json({
      success: true,
      accessoryMasters,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      nextPage: page < totalPages ? page + 1 : null,
      previousPage: page > 1 ? page - 1 : null,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createAccessoryMasters = async (req, res) => {
  try {
    const data = { ...req.body };

    // ✅ never accept warrantyStatus from frontend
    delete data.warrantyStatus;
    delete data.warnatyStatus;

    const finalStatus = data.status || "stock";

    // ✅ mapping status -> model
    const STATUS_OWNER_RULES = {
      "with technician": "Technician",
      "with cse": "Employee",
      "sold to customer": "QstClient",
      "customer demo": "QstClient",
      foc: "QstClient",
      testing: "Employee",
    };

    // ✅ If status requires owner, validate assignedTo and set assignedToModel automatically
    const requiredModel = STATUS_OWNER_RULES[finalStatus];

    if (requiredModel) {
      if (
        !data.assignedTo ||
        !mongoose.Types.ObjectId.isValid(data.assignedTo)
      ) {
        return res.status(400).json({
          success: false,
          message: `assignedTo is required and must be a valid ObjectId when status is "${finalStatus}"`,
        });
      }
      data.assignedToModel = requiredModel;
    } else {
      data.assignedTo = null;
      data.assignedToModel = null;
    }

    // ✅ demo rule
    if (finalStatus === "customer demo") {
      if (!data.demoFromDate || !data.demoToDate) {
        return res.status(400).json({
          success: false,
          message:
            "demoFromDate and demoToDate are required when status is customer demo",
        });
      }

      const from = new Date(data.demoFromDate);
      const to = new Date(data.demoToDate);

      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid demoFromDate or demoToDate",
        });
      }

      if (to < from) {
        return res.status(400).json({
          success: false,
          message: "demoToDate cannot be earlier than demoFromDate",
        });
      }
    } else {
      data.demoFromDate = null;
      data.demoToDate = null;
    }

    // ✅ ALWAYS auto-calc warranty
    const autoWarranty = computeWarrantyStatus(
      data.invoiceDate,
      data.warrantyPeriod,
    );
    if (autoWarranty) data.warnatyStatus = autoWarranty;

    const accessoryMaster = new accessoryMasterModel({
      ...data,
      status: finalStatus,
      stockEnteredAt: finalStatus === "stock" ? new Date() : undefined,
      statusHistory: [
        {
          status: finalStatus,
          changedAt: new Date(),
          changedBy: req.user?.name || req.user?.email || "system",
        },
      ],
    });

    await accessoryMaster.save();

    res.status(201).json({
      success: true,
      message: "Accessory Master created successfully",
      accessoryMaster,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.bulkCreateAccessoryMasters = async (req, res) => {
  try {
    const rawAccessories = req.body; // Expecting an array of accessory objects

    if (!Array.isArray(rawAccessories) || rawAccessories.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of accessories.",
      });
    }

    // Map fields to match the model schema (Age and warnatyStatus)
    const accessories = rawAccessories.map((acc) => ({
      ...acc,
      Age: acc.Age || acc.age,
      warnatyStatus: acc.warnatyStatus || acc.warrantyStatus,
    }));

    // 1. Get existing accessoryIds to skip duplicates
    const allAccessoryIds = accessories
      .map((a) => a.accessoryId)
      .filter(Boolean);

    const existingAccessories = await accessoryMasterModel.find(
      {
        accessoryId: { $in: allAccessoryIds },
      },
      "accessoryId",
    );

    const existingAccessoryIds = new Set(
      existingAccessories.map((a) => a.accessoryId),
    );

    const finalAccessoriesToInsert = [];
    let duplicateCount = 0;
    const seenAccessoryIds = new Set();

    for (const acc of accessories) {
      if (
        acc.accessoryId &&
        (existingAccessoryIds.has(acc.accessoryId) ||
          seenAccessoryIds.has(acc.accessoryId))
      ) {
        duplicateCount++;
      } else {
        finalAccessoriesToInsert.push(acc);
        if (acc.accessoryId) seenAccessoryIds.add(acc.accessoryId);
      }
    }

    let createdAccessories = [];
    if (finalAccessoriesToInsert.length > 0) {
      createdAccessories = await accessoryMasterModel.insertMany(
        finalAccessoriesToInsert,
      );
    }

    res.status(201).json({
      success: true,
      message: `${createdAccessories.length} Accessories imported successfully. ${duplicateCount} duplicates skipped.`,
      newCount: createdAccessories.length,
      duplicateCount: duplicateCount,
      data: createdAccessories,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// exports.updateAccessoryMasters = async (req, res) => {
//   try {
//     const { id } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid accessory master ID",
//       });
//     }

//     const updates = { ...req.body };
//     if (updates.age !== undefined) {
//       updates.Age = updates.age;
//       delete updates.age;
//     }
//     if (updates.warrantyStatus !== undefined) {
//       updates.warnatyStatus = updates.warrantyStatus;
//       delete updates.warrantyStatus;
//     }

//     const updatedAccessoryMaster = await accessoryMasterModel.findByIdAndUpdate(
//       id,
//       { $set: updates },
//       { new: true }
//     );

//     if (!updatedAccessoryMaster) {
//       return res.status(404).json({
//         success: false,
//         message: "Accessory Master not found",
//       });
//     }

//     res.status(200).json({
//       success: true,
//       message: "Accessory Master updated successfully",
//       accessoryMaster: updatedAccessoryMaster,
//     });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

// exports.updateAccessoryMasters = async (req, res) => {
//   try {
//     const { id } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid accessory master ID",
//       });
//     }

//     const accessory = await accessoryMasterModel.findById(id);
//     if (!accessory) {
//       return res.status(404).json({
//         success: false,
//         message: "Accessory Master not found",
//       });
//     }

//     const updates = Object.fromEntries(
//       Object.entries(req.body).filter(([_, value]) => value !== undefined)
//     );

//     // age mapping
//     if (updates.age !== undefined) {
//       updates.Age = updates.age;
//       delete updates.age;
//     }

//     // ✅ never accept warrantyStatus from frontend
//     delete updates.warrantyStatus;
//     delete updates.warnatyStatus;

//     if (updates.status === "" || updates.status === null) delete updates.status;

//     const incomingStatus = updates.status;
//     const prevStatus = accessory.status;

//     delete updates.status;
//     Object.assign(accessory, updates);

//     // ✅ demo rules
//     if (incomingStatus === "customer demo") {
//       if (!accessory.demoFromDate || !accessory.demoToDate) {
//         return res.status(400).json({
//           success: false,
//           message: "demoFromDate and demoToDate are required for customer demo",
//         });
//       }

//       const from = new Date(accessory.demoFromDate);
//       const to = new Date(accessory.demoToDate);

//       if (isNaN(from.getTime()) || isNaN(to.getTime())) {
//         return res.status(400).json({
//           success: false,
//           message: "Invalid demoFromDate or demoToDate",
//         });
//       }

//       if (to < from) {
//         return res.status(400).json({
//           success: false,
//           message: "demoToDate cannot be earlier than demoFromDate",
//         });
//       }
//     }

//     if (incomingStatus && incomingStatus !== "customer demo") {
//       accessory.demoFromDate = null;
//       accessory.demoToDate = null;
//     }

//     // ✅ ALWAYS auto-calc warranty
//     const autoWarranty = computeWarrantyStatus(accessory.invoiceDate, accessory.warrantyPeriod);
//     if (autoWarranty) accessory.warnatyStatus = autoWarranty;

//     // ✅ status change + history
//     if (incomingStatus && incomingStatus !== prevStatus) {
//       accessory.status = incomingStatus;

//       accessory.statusHistory = accessory.statusHistory || [];
//       accessory.statusHistory.push({
//         status: incomingStatus,
//         changedAt: new Date(),
//         changedBy: req.user?.name || req.user?.email || "system",
//       });

//       if (incomingStatus === "stock") {
//         accessory.stockEnteredAt = new Date();
//       }
//     }

//     const updatedAccessoryMaster = await accessory.save();

//     res.status(200).json({
//       success: true,
//       message: "Accessory Master updated successfully",
//       accessoryMaster: updatedAccessoryMaster,
//     });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

exports.updateAccessoryMasters = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid accessory master ID",
      });
    }

    const accessory = await accessoryMasterModel.findById(id);
    if (!accessory) {
      return res.status(404).json({
        success: false,
        message: "Accessory Master not found",
      });
    }

    // ✅ Block status change if accessory is "assign to vendor" and user is NOT r&d
    if (accessory.status === "assign to vendor" && req.user?.role !== "r&d") {
      return res.status(403).json({
        success: false,
        message: "This accessory has been assigned to vendor. Only the R&D team can change its status.",
      });
    }

    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([_, value]) => value !== undefined),
    );

    // age mapping
    if (updates.age !== undefined) {
      updates.Age = updates.age;
      delete updates.age;
    }

    // ✅ never accept warrantyStatus from frontend
    delete updates.warrantyStatus;
    delete updates.warnatyStatus;

    if (updates.status === "" || updates.status === null) delete updates.status;

    const incomingStatus = updates.status;
    const prevStatus = accessory.status;

    delete updates.status;
    Object.assign(accessory, updates);

    // ✅ mapping status -> model
    const STATUS_OWNER_RULES = {
      "with technician": "Technician",
      "with cse": "Employee",
      "sold to customer": "QstClient",
      "customer demo": "QstClient",
      "foc": "QstClient",
      "testing": "Employee",
    };

    // ✅ assignment rules ONLY if status is being updated
    if (incomingStatus) {
      const requiredModel = STATUS_OWNER_RULES[incomingStatus];

      if (requiredModel) {
        const assignedToId = req.body.assignedTo; // must come in request when changing to these statuses

        if (!assignedToId || !mongoose.Types.ObjectId.isValid(assignedToId)) {
          return res.status(400).json({
            success: false,
            message: `assignedTo is required and must be a valid ObjectId when status is "${incomingStatus}"`,
          });
        }

        accessory.assignedTo = assignedToId;
        accessory.assignedToModel = requiredModel;
      } else {
        accessory.assignedTo = null;
        accessory.assignedToModel = null;
      }
    }

    // ✅ demo rules
    if (incomingStatus === "customer demo") {
      if (!accessory.demoFromDate || !accessory.demoToDate) {
        return res.status(400).json({
          success: false,
          message: "demoFromDate and demoToDate are required for customer demo",
        });
      }

      const from = new Date(accessory.demoFromDate);
      const to = new Date(accessory.demoToDate);

      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid demoFromDate or demoToDate",
        });
      }

      if (to < from) {
        return res.status(400).json({
          success: false,
          message: "demoToDate cannot be earlier than demoFromDate",
        });
      }
    }

    if (incomingStatus && incomingStatus !== "customer demo") {
      accessory.demoFromDate = null;
      accessory.demoToDate = null;
    }

    // ✅ ALWAYS auto-calc warranty
    const autoWarranty = computeWarrantyStatus(
      accessory.invoiceDate,
      accessory.warrantyPeriod,
    );
    if (autoWarranty) accessory.warnatyStatus = autoWarranty;

    // ✅ status change + history
    if (incomingStatus && incomingStatus !== prevStatus) {
      accessory.status = incomingStatus;

      accessory.statusHistory = accessory.statusHistory || [];
      let changedBy = req.user?.name || req.user?.email || "system";
      if (incomingStatus === "testing" && accessory.assignedToName) {
        changedBy = `${changedBy} - Assigned to R&D: ${accessory.assignedToName}`;
      }
      accessory.statusHistory.push({
        status: incomingStatus,
        changedAt: new Date(),
        changedBy,
      });

      if (incomingStatus === "stock") {
        accessory.stockEnteredAt = new Date();
      }

      // ✅ if moved out of active vehicle use
      if (["testing", "defective", "stock"].includes(incomingStatus)) {
        const MainData = require("../models/mainData.model");
        await MainData.updateMany(
          { accessoryDetails: accessory._id },
          { $pull: { accessoryDetails: accessory._id } }
        );
      }
    }

    const updatedAccessoryMaster = await accessory.save();

    res.status(200).json({
      success: true,
      message: "Accessory Master updated successfully",
      accessoryMaster: updatedAccessoryMaster,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteAccessoryMasters = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid accessory master ID",
      });
    }

    const deletedAccessoryMaster =
      await accessoryMasterModel.findByIdAndDelete(id);

    if (!deletedAccessoryMaster) {
      return res.status(404).json({
        success: false,
        message: "Accessory Master not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Accessory Master deleted successfully",
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

function getAccessoryAssignedToModel(status) {
  if (status === "with technician") return "Technician";
  if (status === "with cse" || status === "testing") return "Employee";
  if (status === "sold to customer" || status === "customer demo" || status === "foc") {
    return "QstClient";
  }
  return null;
}

// ✅ Get stock accessory count grouped by accessoryModel
exports.getStockCountByType = async (req, res) => {
  const { clientId } = req.params;
  const status = req.body?.status || req.query?.status;
  try {
    const matchStage = { status: "stock" };

    if (status === "sold to customer" || status === "send to customer") {
      matchStage.testingStatus = "tested ok";
    } else if (status === "testing") {
      matchStage.testingStatus = { $ne: "tested ok" };
    }

    if (clientId && clientId !== "all" && mongoose.Types.ObjectId.isValid(clientId)) {
      const MainData = require("../models/mainData.model");
      const storeRecords = await MainData.find(
        {
          company: new mongoose.Types.ObjectId(clientId),
          accessoryDetails: { $exists: true, $ne: [] },
        },
        { accessoryDetails: 1, _id: 0 }
      ).lean();

      const linkedAccessoryIds = storeRecords
        .flatMap((r) => r.accessoryDetails || [])
        .filter(Boolean);
      matchStage._id = { $in: linkedAccessoryIds };
    }

    const counts = await accessoryMasterModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$accessoryModel",
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const result = counts.map((c) => ({
      accessoryModel: c._id || "Unknown",
      count: c.count,
    }));

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Preview stock accessories by accessoryModel
exports.getStockAccessoriesByModel = async (req, res) => {
  try {
    const { accessoryModel, limit, clientId, status } = req.query;
    if (!accessoryModel) {
      return res.status(400).json({ success: false, message: "accessoryModel is required" });
    }

    const qty = Math.min(parseInt(limit, 10) || 500, 20000);

    const accFilter = { status: "stock" };
    if (accessoryModel && accessoryModel !== "all") {
      accFilter.accessoryModel =
        accessoryModel === "Unknown" ? { $in: [null, "", "Unknown"] } : accessoryModel;
    }

    if (status === "sold to customer" || status === "send to customer") {
      accFilter.testingStatus = "tested ok";
    } else if (status === "testing") {
      accFilter.testingStatus = { $ne: "tested ok" };
    }

    if (clientId && clientId !== "all" && mongoose.Types.ObjectId.isValid(clientId)) {
      const MainData = require("../models/mainData.model");
      const storeRecords = await MainData.find(
        {
          company: new mongoose.Types.ObjectId(clientId),
          accessoryDetails: { $exists: true, $ne: [] },
        },
        { accessoryDetails: 1, _id: 0 }
      ).lean();
      const linkedIds = storeRecords
        .flatMap((r) => r.accessoryDetails || [])
        .filter(Boolean);
      accFilter._id = { $in: linkedIds };
    }

    const accessories = await accessoryMasterModel
      .find(accFilter)
      .sort({ createdAt: -1 })
      .limit(qty)
      .select("accessoryId accessoryModel accessoryType accessoryManufacturer testingStatus createdAt")
      .lean();

    const totalAvailable = await accessoryMasterModel.countDocuments(accFilter);

    res.status(200).json({ success: true, accessories, totalAvailable });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Bulk assign stock accessories to any status
exports.bulkAssignStatus = async (req, res) => {
  try {
    const {
      accessoryModel,
      quantity,
      status,
      assignedTo,
      clientId,
      accessoryIds: manualAccessoryIds,
    } = req.body;

    const targetStatus = status === "send to customer" ? "sold to customer" : status;

    const VALID_STATUSES = [
      "testing",
      "sold to customer",
      "send to customer",
      "with technician",
      "with cse",
      "foc",
    ];

    if (!status || !assignedTo) {
      return res.status(400).json({
        success: false,
        message: "status and assignedTo are required",
      });
    }

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }

    const assignedToModel = getAccessoryAssignedToModel(targetStatus);

    let accessoryIds;

    if (manualAccessoryIds && Array.isArray(manualAccessoryIds) && manualAccessoryIds.length > 0) {
      const objectIds = manualAccessoryIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (objectIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid accessory IDs provided",
        });
      }

      if (targetStatus === "sold to customer") {
        const nonTestedOk = await accessoryMasterModel
          .find({
            _id: { $in: objectIds },
            testingStatus: { $ne: "tested ok" },
          })
          .select("accessoryId testingStatus")
          .lean();

        if (nonTestedOk.length > 0) {
          const samples = nonTestedOk
            .slice(0, 5)
            .map((a) => `${a.accessoryId || a._id} (${a.testingStatus || "not tested"})`)
            .join(", ");
          return res.status(400).json({
            success: false,
            message: `Cannot assign to customer: ${nonTestedOk.length} accessory(s) do not have testingStatus as "tested ok" [${samples}${nonTestedOk.length > 5 ? "..." : ""}]. Only accessories tested OK can be sold to customer.`,
          });
        }
      }

      if (targetStatus === "testing") {
        const alreadyTestedOk = await accessoryMasterModel
          .find({
            _id: { $in: objectIds },
            testingStatus: "tested ok",
          })
          .select("accessoryId testingStatus")
          .lean();

        if (alreadyTestedOk.length > 0) {
          const samples = alreadyTestedOk
            .slice(0, 5)
            .map((a) => `${a.accessoryId || a._id}`)
            .join(", ");
          return res.status(400).json({
            success: false,
            message: `Cannot assign to R&D / Testing: ${alreadyTestedOk.length} accessory(s) already have testingStatus as "tested ok" [${samples}${alreadyTestedOk.length > 5 ? "..." : ""}]. Only untested accessories can be assigned for R&D testing.`,
          });
        }
      }

      const validFilter = {
        _id: { $in: objectIds },
        status: "stock",
      };
      if (targetStatus === "sold to customer") {
        validFilter.testingStatus = "tested ok";
      } else if (targetStatus === "testing") {
        validFilter.testingStatus = { $ne: "tested ok" };
      }

      const validAccessories = await accessoryMasterModel
        .find(validFilter)
        .select("_id")
        .lean();

      if (validAccessories.length === 0) {
        return res.status(400).json({
          success: false,
          message: targetStatus === "sold to customer"
            ? "None of the selected accessories are in stock with testingStatus 'tested ok'"
            : targetStatus === "testing"
              ? "None of the selected accessories are in stock with testing status other than 'tested ok'"
              : "None of the selected accessories are in stock",
        });
      }

      accessoryIds = validAccessories.map((a) => a._id);
    } else {
      if (!accessoryModel || !quantity) {
        return res.status(400).json({
          success: false,
          message: "Either accessoryIds[] or (accessoryModel + quantity) are required",
        });
      }

      const qty = parseInt(quantity, 10);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({
          success: false,
          message: "quantity must be a positive number",
        });
      }

      const accFilter = { status: "stock" };
      if (accessoryModel && accessoryModel !== "all") {
        accFilter.accessoryModel =
          accessoryModel === "Unknown" ? { $in: [null, "", "Unknown"] } : accessoryModel;
      }
      if (targetStatus === "sold to customer") {
        accFilter.testingStatus = "tested ok";
      } else if (targetStatus === "testing") {
        accFilter.testingStatus = { $ne: "tested ok" };
      }
      if (clientId && clientId !== "all" && mongoose.Types.ObjectId.isValid(clientId)) {
        const MainData = require("../models/mainData.model");
        const storeRecords = await MainData.find(
          {
            company: new mongoose.Types.ObjectId(clientId),
            accessoryDetails: { $exists: true, $ne: [] },
          },
          { accessoryDetails: 1, _id: 0 }
        ).lean();
        const linkedIds = storeRecords
          .flatMap((r) => r.accessoryDetails || [])
          .filter(Boolean);
        accFilter._id = { $in: linkedIds };
      }

      const accessories = await accessoryMasterModel
        .find(accFilter)
        .sort({ createdAt: -1 })
        .limit(qty)
        .select("_id")
        .lean();

      if (accessories.length === 0) {
        return res.status(400).json({
          success: false,
          message: targetStatus === "sold to customer"
            ? `No stock accessories with testingStatus 'tested ok' found for model "${accessoryModel}"${clientId && clientId !== "all" ? " for this client" : ""}`
            : targetStatus === "testing"
              ? `No stock accessories without 'tested ok' status found for model "${accessoryModel}"${clientId && clientId !== "all" ? " for this client" : ""}`
              : `No stock accessories found for model "${accessoryModel}"${clientId && clientId !== "all" ? " for this client" : ""}`,
        });
      }

      accessoryIds = accessories.map((a) => a._id);
    }

    const changedBy = req.user?.name || req.user?.email || "system";

    await accessoryMasterModel.updateMany(
      { _id: { $in: accessoryIds } },
      {
        $set: {
          status: targetStatus,
          assignedTo: new mongoose.Types.ObjectId(assignedTo),
          assignedToModel: assignedToModel,
        },
        $push: {
          statusHistory: {
            status: targetStatus,
            changedAt: new Date(),
            changedBy: `${changedBy} - Bulk Assign`,
          },
        },
      }
    );

    res.status(200).json({
      success: true,
      message: `${accessoryIds.length} accessories assigned successfully`,
      assignedCount: accessoryIds.length,
      status: targetStatus,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};
