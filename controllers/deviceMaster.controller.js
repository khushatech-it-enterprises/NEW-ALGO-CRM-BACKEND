const DeviceMasterModel = require("../models/deviceMaster");
const mongoose = require("mongoose");
const { computeWarrantyStatus } = require("../utils/warrantyUtils");
const { isDemoExpiringSoon } = require("../utils/demoPeriodChecker");

// exports.getAllDeviceMasters = async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 10;
//     const skip = (page - 1) * limit;

//     const { search, sortBy, sortOrder } = req.query;
//     let searchQuery = {};
//     if (search) {
//       searchQuery = {
//         $or: [
//           { deviceManufacturer: { $regex: search, $options: "i" } },
//           { deviceType: { $regex: search, $options: "i" } },
//           { deviceModel: { $regex: search, $options: "i" } },
//           { deviceId: { $regex: search, $options: "i" } },
//           { invoiceNumber: { $regex: search, $options: "i" } },
//           { customerName: { $regex: search, $options: "i" } },
//           { status: { $regex: search, $options: "i" } },
//         ],
//       };
//     }

//     const totalCount = await DeviceMasterModel.countDocuments(searchQuery);

//     const deviceMasters = await DeviceMasterModel.find(searchQuery)
//       .skip(skip)
//       .limit(limit)
//       .sort({ [sortBy]: sortOrder });

//     const totalPages = Math.ceil(totalCount / limit);

//     const hasNextPage = page < totalPages;
//     const hasPreviousPage = page > 1;
//     res.status(200).json({
//       success: true,
//       deviceMasters,
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

// exports.createDeviceMasters = async (req, res) => {
//   try {
//     const data = { ...req.body };

//     // Clean up enum fields
//     if (data.warrantyStatus === "" || data.warrantyStatus === null)
//       delete data.warrantyStatus;
//     if (data.status === "" || data.status === null) delete data.status;

//     const newDeviceMaster = new DeviceMasterModel(data);

//     await newDeviceMaster.save();

//     res.status(201).json({
//       success: true,
//       message: "Device Master created successfully",
//       deviceMaster: newDeviceMaster,
//     });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

// stock counting code
// exports.updateDeviceMasters = async (req, res) => {
//   try {
//     const { id } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid device master ID",
//       });
//     }

//     const updates = Object.fromEntries(
//       Object.entries(req.body).filter(([_, value]) => value !== undefined)
//     );

//     const updatedDeviceMaster = await DeviceMasterModel.findByIdAndUpdate(
//       id,
//       { $set: updates },
//       { new: true, runValidators: true }
//     );

//     if (!updatedDeviceMaster) {
//       return res.status(404).json({
//         success: false,
//         message: "Device Master not found",
//       });
//     }

//     res.status(200).json({
//       success: true,
//       message: "Device Master updated successfully",
//       deviceMaster: updatedDeviceMaster,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

// stock counting code

// exports.getAllDeviceMasters = async (req, res) => {
//   try {
//     const page = parseInt(req.query.page, 10) || 1;
//     const limit = parseInt(req.query.limit, 10) || 10;
//     const skip = (page - 1) * limit;

//     const { search, sortBy, sortOrder } = req.query;

//     // ✅ search
//     let searchQuery = {};
//     if (search) {
//       searchQuery = {
//         $or: [
//           { deviceManufacturer: { $regex: search, $options: "i" } },
//           { deviceType: { $regex: search, $options: "i" } },
//           { deviceModel: { $regex: search, $options: "i" } },
//           { deviceId: { $regex: search, $options: "i" } },
//           { invoiceNumber: { $regex: search, $options: "i" } },
//           { customerName: { $regex: search, $options: "i" } },
//           { status: { $regex: search, $options: "i" } },
//         ],
//       };
//     }

//     // ✅ safe sort
//     const sortField = sortBy || "createdAt";
//     const sortDir =
//       String(sortOrder).toLowerCase() === "asc" || sortOrder === 1 || sortOrder === "1"
//         ? 1
//         : -1;

//     const totalCount = await DeviceMasterModel.countDocuments(searchQuery);

//     const deviceMastersRaw = await DeviceMasterModel.find(searchQuery)
//       .skip(skip)
//       .limit(limit)
//       .sort({ [sortField]: sortDir })
//       .lean(); // ✅ important

//     // ✅ add daysInStock only when status = stock
//     const MS_PER_DAY = 1000 * 60 * 60 * 24;

//     const deviceMasters = deviceMastersRaw.map((d) => {
//       let daysInStock = null;

//       if (d.status === "stock") {
//         const start = d.stockEnteredAt || d.createdAt; // fallback safety
//         if (start) {
//           daysInStock = Math.floor((Date.now() - new Date(start).getTime()) / MS_PER_DAY);
//           if (daysInStock < 0) daysInStock = 0; // safety if clock mismatch
//         } else {
//           daysInStock = 0;
//         }
//       }

//       return { ...d, daysInStock };
//     });

//     const totalPages = Math.ceil(totalCount / limit);

//     res.status(200).json({
//       success: true,
//       deviceMasters,
//       totalPages,
//       hasNextPage: page < totalPages,
//       hasPreviousPage: page > 1,
//       nextPage: page < totalPages ? page + 1 : null,
//       previousPage: page > 1 ? page - 1 : null,
//     });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

// exports.createDeviceMasters = async (req, res) => {
//   try {
//     const data = { ...req.body };

//     // Clean up enum fields
//     if (data.warrantyStatus === "" || data.warrantyStatus === null) delete data.warrantyStatus;
//     if (data.status === "" || data.status === null) delete data.status;

//     // auto warrantyStatus based on invoiceDate + warrantyPeriod
//     const autoWarranty = computeWarrantyStatus(data.invoiceDate, data.warrantyPeriod);
//     if (autoWarranty) data.warrantyStatus = autoWarranty;

//     // status will default to "stock" if not provided
//     const finalStatus = data.status || "stock";

//     const newDeviceMaster = new DeviceMasterModel({
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

//     await newDeviceMaster.save();

//     res.status(201).json({
//       success: true,
//       message: "Device Master created successfully",
//       deviceMaster: newDeviceMaster,
//     });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// exports.updateDeviceMasters = async (req, res) => {
//   try {
//     const { id } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid device master ID",
//       });
//     }

//     const device = await DeviceMasterModel.findById(id);
//     if (!device) {
//       return res.status(404).json({
//         success: false,
//         message: "Device Master not found",
//       });
//     }

//     // ✅ Build updates but ignore undefined (same as you)
//     const updates = Object.fromEntries(
//       Object.entries(req.body).filter(([_, value]) => value !== undefined)
//     );

//     // ✅ Clean up enum fields (optional but matches your create controller)
//     if (updates.warrantyStatus === "" || updates.warrantyStatus === null) delete updates.warrantyStatus;
//     if (updates.status === "" || updates.status === null) delete updates.status;

//     // ✅ Handle status change logic
//     const incomingStatus = updates.status; // may be undefined
//     const prevStatus = device.status;

//     // ✅ Apply all other fields except status first
//     // (so we can manually manage status + history)
//     delete updates.status;
//     Object.assign(device, updates);

//     // ✅ If status was provided and actually changed
//     if (incomingStatus && incomingStatus !== prevStatus) {
//       device.status = incomingStatus;

//       // push history
//       device.statusHistory = device.statusHistory || [];
//       device.statusHistory.push({
//         status: incomingStatus,
//         changedAt: new Date(),
//         changedBy: req.user?.name || req.user?.email || "system",
//       });

//       // if moved into stock, reset stockEnteredAt
//       if (incomingStatus === "stock") {
//         device.stockEnteredAt = new Date();
//       }
//     }

//     const updatedDeviceMaster = await device.save(); // validators run here

//     res.status(200).json({
//       success: true,
//       message: "Device Master updated successfully",
//       deviceMaster: updatedDeviceMaster,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

// below controller contains all functionalities

// exports.getAllDeviceMasters = async (req, res) => {
//   try {
//     const page = parseInt(req.query.page, 10) || 1;
//     const limit = parseInt(req.query.limit, 10) || 10;
//     const skip = (page - 1) * limit;

//     const { search, sortBy, sortOrder } = req.query;

//     // ✅ search
//     let searchQuery = {};
//     if (search) {
//       searchQuery = {
//         $or: [
//           { deviceManufacturer: { $regex: search, $options: "i" } },
//           { deviceType: { $regex: search, $options: "i" } },
//           { deviceModel: { $regex: search, $options: "i" } },
//           { deviceId: { $regex: search, $options: "i" } },
//           { invoiceNumber: { $regex: search, $options: "i" } },
//           { customerName: { $regex: search, $options: "i" } },
//           { status: { $regex: search, $options: "i" } },
//         ],
//       };
//     }

//     // ✅ safe sort
//     const sortField = sortBy || "createdAt";
//     const sortDir =
//       String(sortOrder).toLowerCase() === "asc" || sortOrder === 1 || sortOrder === "1"
//         ? 1
//         : -1;

//     const totalCount = await DeviceMasterModel.countDocuments(searchQuery);

//     const deviceMastersRaw = await DeviceMasterModel.find(searchQuery)
//       .skip(skip)
//       .limit(limit)
//       .sort({ [sortField]: sortDir })
//       .lean();

//     const MS_PER_DAY = 1000 * 60 * 60 * 24;

//     // normalize "today" at midnight (prevents time-of-day issues)
//     const today = new Date();
//     today.setHours(0, 0, 0, 0);

//     const deviceMasters = deviceMastersRaw.map((d) => {
//       let daysInStock = null;

//       // ✅ STOCK DAYS
//       if (d.status === "stock") {
//         const start = d.stockEnteredAt || d.createdAt;
//         if (start) {
//           daysInStock = Math.floor((Date.now() - new Date(start).getTime()) / MS_PER_DAY);
//           if (daysInStock < 0) daysInStock = 0;
//         } else {
//           daysInStock = 0;
//         }
//       }

//       // ✅ DEMO BADGE DATA
//       let demoDaysLeft = null;
//       let demoAlert = false;
//       let demoExpired = false;

//       if (d.status === "customer demo" && d.demoToDate) {
//         const end = new Date(d.demoToDate);
//         end.setHours(0, 0, 0, 0);

//         demoDaysLeft = Math.ceil((end - today) / MS_PER_DAY); // e.g. 2 means ends in 2 days
//         demoExpired = demoDaysLeft < 0;

//         // true only when exactly 2 days left (you can change 2 to 1/3 etc)
//         demoAlert = isDemoExpiringSoon(d.demoToDate, 2);
//       }

//       return { ...d, daysInStock, demoDaysLeft, demoAlert, demoExpired };
//     });

//     const totalPages = Math.ceil(totalCount / limit);

//     res.status(200).json({
//       success: true,
//       deviceMasters,
//       totalPages,
//       hasNextPage: page < totalPages,
//       hasPreviousPage: page > 1,
//       nextPage: page < totalPages ? page + 1 : null,
//       previousPage: page > 1 ? page - 1 : null,
//     });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

// exports.createDeviceMasters = async (req, res) => {
//   try {
//     const data = { ...req.body };

//     // ✅ Never accept warrantyStatus from frontend (always auto)
//     delete data.warrantyStatus;

//     // ✅ Clean up enum fields
//     if (data.status === "" || data.status === null) delete data.status;

//     // ✅ status will default to "stock" if not provided
//     const finalStatus = data.status || "stock";

//     // ✅ If status is customer demo, demo dates must be present
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
//       // ✅ If NOT customer demo, always clear demo dates
//       data.demoFromDate = null;
//       data.demoToDate = null;
//     }

//     // ✅ ALWAYS auto-calc warrantyStatus (after invoiceDate/warrantyPeriod available)
//     const autoWarranty = computeWarrantyStatus(data.invoiceDate, data.warrantyPeriod);
//     if (autoWarranty) data.warrantyStatus = autoWarranty;

//     const newDeviceMaster = new DeviceMasterModel({
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

//     await newDeviceMaster.save();

//     res.status(201).json({
//       success: true,
//       message: "Device Master created successfully",
//       deviceMaster: newDeviceMaster,
//     });
//   } catch (error) {
//     console.log(error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

// exports.updateDeviceMasters = async (req, res) => {
//   try {
//     const { id } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid device master ID",
//       });
//     }

//     const device = await DeviceMasterModel.findById(id);
//     if (!device) {
//       return res.status(404).json({
//         success: false,
//         message: "Device Master not found",
//       });
//     }

//     // ✅ Build updates but ignore undefined
//     const updates = Object.fromEntries(
//       Object.entries(req.body).filter(([_, value]) => value !== undefined)
//     );

//     // ✅ DO NOT accept warrantyStatus from frontend (always auto-calc)
//     delete updates.warrantyStatus;

//     // ✅ Clean up enum fields
//     if (updates.status === "" || updates.status === null) delete updates.status;

//     // ✅ Handle status change logic
//     const incomingStatus = updates.status; // may be undefined
//     const prevStatus = device.status;

//     // ✅ Apply all other fields except status first
//     delete updates.status;
//     Object.assign(device, updates);

//     // ✅ ALWAYS auto-calculate warrantyStatus (after invoiceDate/warrantyPeriod updates applied)
//     const autoWarranty = computeWarrantyStatus(device.invoiceDate, device.warrantyPeriod);
//     if (autoWarranty) {
//       device.warrantyStatus = autoWarranty;
//     } else {
//       // optional: if missing invoiceDate/warrantyPeriod, you can clear it
//       // device.warrantyStatus = undefined;
//     }

//     // ✅ If status was provided and actually changed
//     if (incomingStatus && incomingStatus !== prevStatus) {
//       device.status = incomingStatus;

//       // push history
//       device.statusHistory = device.statusHistory || [];
//       device.statusHistory.push({
//         status: incomingStatus,
//         changedAt: new Date(),
//         changedBy: req.user?.name || req.user?.email || "system",
//       });

//       // if moved into stock, reset stockEnteredAt
//       if (incomingStatus === "stock") {
//         device.stockEnteredAt = new Date();
//       }
//     }

//     const updatedDeviceMaster = await device.save();

//     res.status(200).json({
//       success: true,
//       message: "Device Master updated successfully",
//       deviceMaster: updatedDeviceMaster,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

// this below controller is containing all changes with functionalities

// exports.updateDeviceMasters = async (req, res) => {
//   try {
//     const { id } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(id)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid device master ID",
//       });
//     }

//     const device = await DeviceMasterModel.findById(id);
//     if (!device) {
//       return res.status(404).json({
//         success: false,
//         message: "Device Master not found",
//       });
//     }

//     // ✅ Build updates but ignore undefined
//     const updates = Object.fromEntries(
//       Object.entries(req.body).filter(([_, value]) => value !== undefined)
//     );

//     // ✅ never accept warrantyStatus from frontend
//     delete updates.warrantyStatus;

//     // ✅ Clean up enum fields
//     if (updates.status === "" || updates.status === null) delete updates.status;

//     const incomingStatus = updates.status;
//     const prevStatus = device.status;

//     // remove status from normal assign
//     delete updates.status;
//     Object.assign(device, updates);

//     // ============================
//     // ✅ DEMO STATUS RULES
//     // ============================
//     if (incomingStatus === "customer demo") {
//       if (!device.demoFromDate || !device.demoToDate) {
//         return res.status(400).json({
//           success: false,
//           message: "demoFromDate and demoToDate are required for customer demo",
//         });
//       }

//       const from = new Date(device.demoFromDate);
//       const to = new Date(device.demoToDate);

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

//     // if status is NOT demo → clear demo dates
//     if (incomingStatus && incomingStatus !== "customer demo") {
//       device.demoFromDate = null;
//       device.demoToDate = null;
//     }

//     // ============================
//     // ✅ WARRANTY AUTO CALC
//     // ============================
//     const autoWarranty = computeWarrantyStatus(device.invoiceDate, device.warrantyPeriod);
//     if (autoWarranty) device.warrantyStatus = autoWarranty;

//     // ============================
//     // ✅ STATUS CHANGE + HISTORY
//     // ============================
//     if (incomingStatus && incomingStatus !== prevStatus) {
//       device.status = incomingStatus;

//       device.statusHistory = device.statusHistory || [];
//       device.statusHistory.push({
//         status: incomingStatus,
//         changedAt: new Date(),
//         changedBy: req.user?.name || req.user?.email || "system",
//       });

//       if (incomingStatus === "stock") {
//         device.stockEnteredAt = new Date();
//       }
//     }

//     const updatedDeviceMaster = await device.save();

//     res.status(200).json({
//       success: true,
//       message: "Device Master updated successfully",
//       deviceMaster: updatedDeviceMaster,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }
// };

function pushStatusHistory(doc, status, changedBy) {
  doc.statusHistory = doc.statusHistory || [];
  doc.statusHistory.push({
    status,
    changedAt: new Date(),
    changedBy: changedBy || "system",
  });
}

function getAssignedToModelFromStatus(status) {
  if (status === "with technician") return "Technician";
  if (status === "with cse") return "Employee";
  if (status === "testing") return "Employee";
  if (
    status === "sold to customer" ||
    status === "customer demo" ||
    status === "foc"
  )
    return "QstClient";
  return null;
}

exports.updateDeviceMasters = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid device master ID" });
    }

    const device = await DeviceMasterModel.findById(id);
    if (!device) {
      return res
        .status(404)
        .json({ success: false, message: "Device Master not found" });
    }

    // ✅ Block status change if device is "assign to vendor" and user is NOT r&d
    if (device.status === "assign to vendor" && req.user?.role !== "r&d") {
      return res.status(403).json({
        success: false,
        message: "This device has been assigned to vendor. Only the R&D team can change its status.",
      });
    }

    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([_, value]) => value !== undefined),
    );

    // ✅ never accept warrantyStatus from frontend
    delete updates.warrantyStatus;

    if (updates.status === "" || updates.status === null) delete updates.status;

    const incomingStatus = updates.status;
    const prevStatus = device.status;

    // do normal assign (except status)
    delete updates.status;
    Object.assign(device, updates);

    // ✅ if status changed, enforce assignedToModel rules
    if (incomingStatus) {
      const needsAssignedTo = [
        "with technician",
        "with cse",
        "sold to customer",
        "customer demo",
        "foc",
        "testing",
      ].includes(incomingStatus);

      if (!needsAssignedTo) {
        device.assignedTo = null;
        device.assignedToModel = null;
      } else {
        device.assignedToModel = getAssignedToModelFromStatus(incomingStatus);

        // if needsAssignedTo but missing
        if (!device.assignedTo) {
          return res.status(400).json({
            success: false,
            message: "assignedTo is required for this status",
          });
        }
      }

      // ✅ demo validation/cleanup
      if (incomingStatus === "customer demo") {
        if (!device.demoFromDate || !device.demoToDate) {
          return res.status(400).json({
            success: false,
            message:
              "demoFromDate and demoToDate are required for customer demo",
          });
        }

        const from = new Date(device.demoFromDate);
        const to = new Date(device.demoToDate);

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
        device.demoFromDate = null;
        device.demoToDate = null;
      }
    }

    // ✅ auto warranty calc (any time invoiceDate/warrantyPeriod changes too)
    const autoWarranty = computeWarrantyStatus(
      device.invoiceDate,
      device.warrantyPeriod,
    );
    if (autoWarranty) device.warrantyStatus = autoWarranty;

    // ✅ status change + history
    if (incomingStatus && incomingStatus !== prevStatus) {
      device.status = incomingStatus;

      // build a richer changedBy message for testing status
      let changedBy = req.user?.name || req.user?.email || "system";
      if (incomingStatus === "testing" && device.assignedToName) {
        changedBy = `${changedBy} - Assigned to R&D: ${device.assignedToName}`;
      }

      pushStatusHistory(device, incomingStatus, changedBy);

      if (incomingStatus === "stock") {
        device.stockEnteredAt = new Date();
      }

      // ✅ if moved out of active vehicle use
      if (["testing", "defective", "stock"].includes(incomingStatus)) {
        const MainData = require("../models/mainData.model");
        await MainData.updateMany(
          { deviceDetails: device._id },
          { $unset: { deviceDetails: 1 } }
        );
      }
    }

    const updated = await device.save();

    res.status(200).json({
      success: true,
      message: "Device Master updated successfully",
      deviceMaster: updated,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllDeviceMasters = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const { search, sortBy, sortOrder, status: statusFilter, assignedTo: assignedToFilter, testingStatus: testingStatusFilter, warrantyStatus: warrantyStatusFilter,demoStatus, } = req.query;

    let searchQuery = {};
    if (search) {
      // Escape special regex characters so strings like "AIS 140 + Temp" work correctly
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      searchQuery = {
        $or: [
          { deviceManufacturer: { $regex: escapedSearch, $options: "i" } },
          { deviceType: { $regex: escapedSearch, $options: "i" } },
          { deviceModel: { $regex: escapedSearch, $options: "i" } },
          { deviceId: { $regex: escapedSearch, $options: "i" } },
          { invoiceNumber: { $regex: escapedSearch, $options: "i" } },
          { status: { $regex: escapedSearch, $options: "i" } },
          { devicePerRate: { $regex: escapedSearch, $options: "i" } },
        ],
      };
    }

    // ✅ filter by status if provided
    if (statusFilter) {
      searchQuery.status = statusFilter;
    }

    // ✅ filter by warrantyStatus if provided
    if (warrantyStatusFilter) {
      searchQuery.warrantyStatus = warrantyStatusFilter;
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
    const sortDir =
      String(sortOrder).toLowerCase() === "asc" ||
        sortOrder === 1 ||
        sortOrder === "1"
        ? 1
        : -1;

        // Filter customer demo records by demo period
if (statusFilter === "customer demo" && demoStatus) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (demoStatus === "within") {
    searchQuery.demoToDate = {
      $gte: today,
    };
  }

  if (demoStatus === "outside") {
    searchQuery.demoToDate = {
      $lt: today,
    };
  }
}

    const totalCount = await DeviceMasterModel.countDocuments(searchQuery);

    const deviceMastersRaw = await DeviceMasterModel.find(searchQuery)
      .skip(skip)
      .limit(limit)
      .sort({ [sortField]: sortDir })
      // ✅ populate assignedTo name
      .populate({ path: "assignedTo", select: "name companyName" })
      .lean();

    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const deviceMasters = deviceMastersRaw.map((d) => {
      // ✅ assignedToName (frontend can show directly)
      const assignedToName =
        d?.assignedTo?.name || d?.assignedTo?.companyName || "";

      // ✅ stock days
      let daysInStock = null;
      if (d.status === "stock") {
        const start = d.stockEnteredAt || d.createdAt;
        daysInStock = start
          ? Math.floor((Date.now() - new Date(start).getTime()) / MS_PER_DAY)
          : 0;
        if (daysInStock < 0) daysInStock = 0;
      }

      // ✅ demo badges
      let demoDaysLeft = null;
      let demoAlert = false;
      let demoExpired = false;

      if (d.status === "customer demo" && d.demoToDate) {
        const end = new Date(d.demoToDate);
        end.setHours(0, 0, 0, 0);

        demoDaysLeft = Math.ceil((end - today) / MS_PER_DAY);
        demoExpired = demoDaysLeft < 0;
        demoAlert = isDemoExpiringSoon(d.demoToDate, 2);
      }

      return {
        ...d,
        assignedToName,
        daysInStock,
        demoDaysLeft,
        demoAlert,
        demoExpired,
      };
    });

    const totalPages = Math.ceil(totalCount / limit);

    res.status(200).json({
      success: true,
      deviceMasters,
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

exports.createDeviceMasters = async (req, res) => {
  try {
    const data = { ...req.body };

    // ✅ do not accept warrantyStatus from frontend
    delete data.warrantyStatus;

    // cleanup enum fields
    if (data.status === "" || data.status === null) delete data.status;

    const finalStatus = data.status || "stock";

    // ✅ assign model automatically from status
    const autoModel = getAssignedToModelFromStatus(finalStatus);
    if (autoModel) data.assignedToModel = autoModel;
    else {
      data.assignedToModel = null;
      data.assignedTo = null;
    }

    // ✅ if status needs assignedTo, validate
    const needsAssignedTo = [
      "with technician",
      "with cse",
      "sold to customer",
      "customer demo",
      "foc",
    ].includes(finalStatus);
    if (needsAssignedTo && !data.assignedTo) {
      return res.status(400).json({
        success: false,
        message: "assignedTo is required for this status",
      });
    }

    // ✅ demo rules
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

    // ✅ auto warranty calc
    const autoWarranty = computeWarrantyStatus(
      data.invoiceDate,
      data.warrantyPeriod,
    );
    if (autoWarranty) data.warrantyStatus = autoWarranty;

    const device = new DeviceMasterModel({
      ...data,
      status: finalStatus,
    });

    // ✅ stockEnteredAt set when stock
    if (finalStatus === "stock") {
      device.stockEnteredAt = new Date();
    }

    // ✅ status history on create
    device.statusHistory = [];
    pushStatusHistory(device, finalStatus, req.user?.name || req.user?.email);

    await device.save();

    res.status(201).json({
      success: true,
      message: "Device Master created successfully",
      deviceMaster: device,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.bulkCreateDeviceMasters = async (req, res) => {
  try {
    const rawDevices = req.body; // Expecting an array of device objects

    if (!Array.isArray(rawDevices) || rawDevices.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of devices.",
      });
    }

    // Map fields and handle date conversion if needed
    const devices = rawDevices.map((device) => {
      const d = { ...device };
      if (d.invoiceDate) d.invoiceDate = new Date(d.invoiceDate);

      // Clean up enum fields: if they are empty strings, remove them so they don't trigger validation
      if (d.warrantyStatus === "" || d.warrantyStatus === null)
        delete d.warrantyStatus;
      if (d.status === "" || d.status === null) delete d.status;

      return d;
    });

    // 1. Get existing deviceIds to skip duplicates
    const allDeviceIds = devices.map((d) => d.deviceId).filter(Boolean);

    const existingDevices = await DeviceMasterModel.find(
      {
        deviceId: { $in: allDeviceIds },
      },
      "deviceId",
    );

    const existingDeviceIds = new Set(existingDevices.map((d) => d.deviceId));

    const finalDevicesToInsert = [];
    let duplicateCount = 0;
    const seenDeviceIds = new Set();

    for (const device of devices) {
      if (
        device.deviceId &&
        (existingDeviceIds.has(device.deviceId) ||
          seenDeviceIds.has(device.deviceId))
      ) {
        duplicateCount++;
      } else {
        finalDevicesToInsert.push(device);
        if (device.deviceId) seenDeviceIds.add(device.deviceId);
      }
    }

    let createdDevices = [];
    if (finalDevicesToInsert.length > 0) {
      createdDevices = await DeviceMasterModel.insertMany(finalDevicesToInsert);
    }

    res.status(201).json({
      success: true,
      message: `${createdDevices.length} Devices imported successfully. ${duplicateCount} duplicates skipped.`,
      newCount: createdDevices.length,
      duplicateCount: duplicateCount,
      data: createdDevices,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ✅ Get stock device count grouped by deviceType
exports.getStockCountByType = async (req, res) => {
  try {
    const counts = await DeviceMasterModel.aggregate([
      { $match: { status: "stock" } },
      {
        $group: {
          _id: "$deviceType",
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Transform to { deviceType, count } array
    const result = counts.map((c) => ({
      deviceType: c._id || "Unknown",
      count: c.count,
    }));

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Bulk assign stock devices to R&D team member
exports.bulkAssignToRd = async (req, res) => {
  try {
    const { deviceType, quantity, assignedTo } = req.body;

    if (!deviceType || !quantity || !assignedTo) {
      return res.status(400).json({
        success: false,
        message: "deviceType, quantity, and assignedTo are required",
      });
    }

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({
        success: false,
        message: "quantity must be a positive number",
      });
    }

    // 1. Find the first N stock devices of the given type
    const devices = await DeviceMasterModel.find({
      status: "stock",
      deviceType: deviceType,
    })
      .sort({ createdAt: 1 })
      .limit(qty)
      .select("_id")
      .lean();

    if (devices.length === 0) {
      return res.status(400).json({
        success: false,
        message: `No stock devices found for type "${deviceType}"`,
      });
    }

    const deviceIds = devices.map((d) => d._id);
    const changedBy = req.user?.name || req.user?.email || "system";

    // 2. Bulk update all selected devices
    await DeviceMasterModel.updateMany(
      { _id: { $in: deviceIds } },
      {
        $set: {
          status: "testing",
          assignedTo: new mongoose.Types.ObjectId(assignedTo),
          assignedToModel: "Employee",
        },
        $push: {
          statusHistory: {
            status: "testing",
            changedAt: new Date(),
            changedBy: `${changedBy} - Bulk Assign to R&D`,
          },
        },
      }
    );

    res.status(200).json({
      success: true,
      message: `${deviceIds.length} devices assigned to R&D successfully`,
      assignedCount: deviceIds.length,
      requestedCount: qty,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteDeviceMasters = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid device master ID",
      });
    }

    const deletedDeviceMaster = await DeviceMasterModel.findByIdAndDelete(id);
    if (!deletedDeviceMaster) {
      return res.status(404).json({
        success: false,
        message: "Device Master not found",
      });
    }
    res.status(200).json({
      success: true,
      message: "Device Master deleted successfully",
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
