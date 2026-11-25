const mongoose = require("mongoose");
const simMasterModel = require("../models/simMaster");
const {
  pushStatusHistory,
  isDemoExpiringSoon,
} = require("../utils/helperForSimMaster");

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

function normalizeDateInputToISODateString(val) {
  if (!val) return "";
  if (typeof val === "string") val = val.trim();

  // already ISO date
  if (typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;

  // handle "DD/MM/YYYY", "DD-MM-YYYY", "YYYY/MM/DD", etc.
  if (typeof val === "string" && (val.includes("/") || val.includes("-"))) {
    const parts = val.split(/[-/]/).map((p) => p.trim());
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        const [yyyy, mm, dd] = parts;
        return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
      } else if (parts[2].length === 4) {
        const [dd, mm, yyyy] = parts;
        return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
      }
    }
  }

  // handle date object / other string
  const d = new Date(val);
  if (isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function applyActivationAuto(simDocOrData) {
  // if activationDate exists => isSimActivated must be true
  const act = normalizeDateInputToISODateString(simDocOrData.activationDate);
  if (act) {
    simDocOrData.activationDate = act; // store as "YYYY-MM-DD"
    simDocOrData.isSimActivated = true;
  } else {
    // if no activationDate and isSimActivated false => clear activationDate
    if (simDocOrData.isSimActivated === false) {
      simDocOrData.activationDate = "";
    }
  }
}

exports.createSimMaster = async (req, res) => {
  try {
    const data = { ...req.body };

    // ✅ clean empties
    if (data.status === "" || data.status === null) delete data.status;
    if (data.assignedTo === "" || data.assignedTo === null)
      delete data.assignedTo;
    if (data.assignedToName === "" || data.assignedToName === null)
      delete data.assignedToName;
    if (data.assignedToModel === "" || data.assignedToModel === null)
      delete data.assignedToModel;

    // ✅ unique simNumber check
    if (data.simNumber !== undefined) {
      const existingSim = await simMasterModel.findOne({
        simNumber: data.simNumber,
      });
      if (existingSim) {
        return res
          .status(400)
          .json({ success: false, message: "SIM number already exists" });
      }
    }

    // ✅ monthlyDate mapping
    if (data.monthlyDate !== undefined) {
      data.monthlyBillingDate = data.monthlyDate;
      delete data.monthlyDate;
    }

    // ✅ purchaseDate parse
    if (data.purchaseDate) {
      const d = new Date(data.purchaseDate);
      if (!isNaN(d.getTime())) data.purchaseDate = d;
      else delete data.purchaseDate;
    }

    // ✅ normalize activationDate (store as YYYY-MM-DD string)
    if (data.activationDate !== undefined) {
      if (!data.activationDate) {
        data.activationDate = "";
      } else if (
        typeof data.activationDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(data.activationDate)
      ) {
        // ok
      } else {
        const d = new Date(data.activationDate);
        if (!isNaN(d.getTime())) {
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const dd = String(d.getDate()).padStart(2, "0");
          data.activationDate = `${yyyy}-${mm}-${dd}`;
        } else {
          data.activationDate = "";
        }
      }
    }

    // ✅ isSimActivated auto (activationDate wins)
    data.isSimActivated = Boolean(data.activationDate);

    const finalStatus = data.status || "stock";

    // ✅ deactivated validation
    if (finalStatus === "deactivated") {
      if (!data.deactivationDate) {
        return res.status(400).json({ success: false, message: "Deactivation date is required when status is deactivated." });
      }
      if (!data.deactivationRemarks || !String(data.deactivationRemarks).trim()) {
        return res.status(400).json({ success: false, message: "Deactivation remarks are required when status is deactivated." });
      }
      // normalize deactivationDate
      data.deactivationDate = normalizeDateInputToISODateString(data.deactivationDate);
    } else {
      data.deactivationDate = "";
      data.deactivationRemarks = "";
    }

    // ✅ assignment validation based on status
    const needsAssignedTo = [
      "with technician",
      "with cse",
      "sold to customer",
      "customer demo",
      "foc",
      "testing",
    ].includes(finalStatus);

    if (!needsAssignedTo) {
      data.assignedTo = null;
      data.assignedToModel = null;
      data.assignedToName = "";
    } else {
      // set required model by status
      let requiredModel = null;
      if (finalStatus === "with technician") requiredModel = "Technician";
      if (finalStatus === "with cse") requiredModel = "Employee";
      if (finalStatus === "testing") requiredModel = "Employee";
      if (
        finalStatus === "sold to customer" ||
        finalStatus === "customer demo" ||
        finalStatus === "foc"
      )
        requiredModel = "QstClient";

      data.assignedToModel = requiredModel;

      // ✅ require assignedTo + assignedToName
      if (!data.assignedTo) {
        return res.status(400).json({
          success: false,
          message:
            "Customer/Technician/CSE is required for this status (assignedTo missing)",
        });
      }

      if (!data.assignedToName || !String(data.assignedToName).trim()) {
        return res.status(400).json({
          success: false,
          message:
            "Customer/Technician/CSE name is required for this status (assignedToName missing)",
        });
      }
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

      data.demoFromDate = from;
      data.demoToDate = to;
    } else {
      data.demoFromDate = null;
      data.demoToDate = null;
    }

    const newSimMaster = new simMasterModel({
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

    await newSimMaster.save();

    res.status(201).json({
      success: true,
      message: "Sim Master created successfully",
      simMaster: newSimMaster,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateSimMaster = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid sim master ID" });
    }

    const sim = await simMasterModel.findById(id);
    if (!sim) {
      return res
        .status(404)
        .json({ success: false, message: "Sim Master not found" });
    }

    // ✅ Block status change if sim is "assign to vendor" and user is NOT r&d
    if (sim.status === "assign to vendor" && req.user?.role !== "r&d") {
      return res.status(403).json({
        success: false,
        message: "This SIM has been assigned to vendor. Only the R&D team can change its status.",
      });
    }

    const prevStatus = sim.status;

    // ✅ keep keys even if "" so we can detect touched fields
    const updates = Object.fromEntries(
      Object.entries(req.body).filter(([_, v]) => v !== undefined),
    );

    // ✅ monthlyDate mapping
    if (updates.monthlyDate !== undefined) {
      updates.monthlyBillingDate = updates.monthlyDate;
      delete updates.monthlyDate;
    }

    // ✅ parse purchaseDate if provided
    if (updates.purchaseDate !== undefined) {
      const parsed = new Date(updates.purchaseDate);
      if (!isNaN(parsed.getTime())) updates.purchaseDate = parsed;
      else delete updates.purchaseDate;
    }

    // ✅ normalize activationDate, then auto-set isSimActivated
    if (updates.activationDate !== undefined) {
      if (!updates.activationDate) {
        updates.activationDate = "";
      } else if (
        typeof updates.activationDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(updates.activationDate)
      ) {
        // ok
      } else {
        const d = new Date(updates.activationDate);
        if (!isNaN(d.getTime())) {
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const dd = String(d.getDate()).padStart(2, "0");
          updates.activationDate = `${yyyy}-${mm}-${dd}`;
        } else {
          updates.activationDate = "";
        }
      }
    }

    // ✅ clean status empty
    if (updates.status === "" || updates.status === null) delete updates.status;

    const incomingStatus = updates.status;

    // ✅ detect if frontend actually sent assignment fields
    const assignedToTouched = Object.prototype.hasOwnProperty.call(
      req.body,
      "assignedTo",
    );
    const assignedToNameTouched = Object.prototype.hasOwnProperty.call(
      req.body,
      "assignedToName",
    );

    // don't assign status before validation
    delete updates.status;

    // ✅ apply other updates
    Object.assign(sim, updates);

    // ✅ activation auto (after assign)
    sim.isSimActivated = Boolean(sim.activationDate);

    if (incomingStatus) {
      const statusChanging = incomingStatus !== prevStatus;
      const needsAssignedTo = [
        "with technician",
        "with cse",
        "sold to customer",
        "customer demo",
        "foc",
        "testing",
      ].includes(incomingStatus);

      // ✅ if status is changing to a "needsAssignedTo" status,
      // require user to send assignment again (prevents old carry-over)
      if (statusChanging && needsAssignedTo) {
        if (!assignedToTouched || !req.body.assignedTo) {
          return res.status(400).json({
            success: false,
            message:
              "Customer/Technician/CSE is required for this status (assignedTo missing)",
          });
        }
        if (
          !assignedToNameTouched ||
          !req.body.assignedToName ||
          !String(req.body.assignedToName).trim()
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Customer/Technician/CSE name is required for this status (assignedToName missing)",
          });
        }
      }

      // ✅ assignment handling
      if (!needsAssignedTo) {
        // if moved to stock/testing -> clear assignment
        sim.assignedTo = null;
        sim.assignedToModel = null;
        sim.assignedToName = "";
      } else {
        // set required model by status
        let requiredModel = null;
        if (incomingStatus === "with technician") requiredModel = "Technician";
        if (incomingStatus === "with cse") requiredModel = "Employee";
        if (incomingStatus === "testing") requiredModel = "Employee";
        if (
          incomingStatus === "sold to customer" ||
          incomingStatus === "customer demo" ||
          incomingStatus === "foc"
        )
          requiredModel = "QstClient";

        sim.assignedToModel = requiredModel;

        // ✅ if status needs assignedTo, ALWAYS validate current doc values too
        if (!sim.assignedTo) {
          return res.status(400).json({
            success: false,
            message:
              "Customer/Technician/CSE is required for this status (assignedTo missing)",
          });
        }
        if (!sim.assignedToName || !String(sim.assignedToName).trim()) {
          return res.status(400).json({
            success: false,
            message:
              "Customer/Technician/CSE name is required for this status (assignedToName missing)",
          });
        }
      }

      // ✅ demo rules
      if (incomingStatus === "customer demo") {
        if (!sim.demoFromDate || !sim.demoToDate) {
          return res.status(400).json({
            success: false,
            message:
              "demoFromDate and demoToDate are required for customer demo",
          });
        }

        const from = new Date(sim.demoFromDate);
        const to = new Date(sim.demoToDate);

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

        sim.demoFromDate = from;
        sim.demoToDate = to;
      } else {
        sim.demoFromDate = null;
        sim.demoToDate = null;
      }

      // ✅ deactivated validation
      if (incomingStatus === "deactivated") {
        if (!sim.deactivationDate) {
          return res.status(400).json({ success: false, message: "Deactivation date is required when status is deactivated." });
        }
        if (!sim.deactivationRemarks || !String(sim.deactivationRemarks).trim()) {
          return res.status(400).json({ success: false, message: "Deactivation remarks are required when status is deactivated." });
        }
        sim.deactivationDate = normalizeDateInputToISODateString(sim.deactivationDate);
      } else {
        sim.deactivationDate = "";
        sim.deactivationRemarks = "";
      }

      // ✅ push history if status changed
      if (statusChanging) {
        sim.status = incomingStatus;
        sim.statusHistory = sim.statusHistory || [];
        let changedBy = req.user?.name || req.user?.email || "system";
        if (incomingStatus === "testing" && sim.assignedToName) {
          changedBy = `${changedBy} - Assigned to R&D: ${sim.assignedToName}`;
        }
        sim.statusHistory.push({
          status: incomingStatus,
          changedAt: new Date(),
          changedBy,
        });

        if (incomingStatus === "stock") {
          sim.stockEnteredAt = new Date();
        }

        // ✅ if moved out of active vehicle use
        if (["testing", "defective", "stock", "deactivated"].includes(incomingStatus)) {
          const MainData = require("../models/mainData.model");
          await MainData.updateMany(
            { simDetails: sim._id },
            { $unset: { simDetails: 1 } }
          );
        }
      }
    }

    const updated = await sim.save();

    res.status(200).json({
      success: true,
      message: "Sim Master updated successfully",
      simMaster: updated,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllSimMasters = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const search = req.query.search || "";
    const sortBy = req.query.sortBy || "createdAt";
    const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
    const statusFilter = req.query.status;
    const assignedToFilter = req.query.assignedTo;
    const testingStatusFilter = req.query.testingStatus;
    const isSimActivatedFilter = req.query.isSimActivated;
    const demoStatus = req.query.demoStatus;

    let searchQuery = {};
    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      searchQuery = {
        $or: [
          { simOwner: { $regex: escapedSearch, $options: "i" } },
          { simProvider: { $regex: escapedSearch, $options: "i" } },
          { simNumber: { $regex: escapedSearch, $options: "i" } },
          { mobileNumber: { $regex: escapedSearch, $options: "i" } },
          { customerOrAlgoEmployeeName: { $regex: escapedSearch, $options: "i" } },
          { assignedToName: { $regex: escapedSearch, $options: "i" } },
          { status: { $regex: escapedSearch, $options: "i" } },
          { simPerRate: { $regex: escapedSearch, $options: "i" } },
        ],
      };
    }

    // ✅ filter by status if provided
    if (statusFilter) {
      searchQuery.status = statusFilter;
    }

    if (assignedToFilter && mongoose.Types.ObjectId.isValid(assignedToFilter)) {
      searchQuery.assignedTo = new mongoose.Types.ObjectId(assignedToFilter);
    }

    if (testingStatusFilter) {
      searchQuery.testingStatus = testingStatusFilter;
    }

    // ✅ filter by assignedTo if provided
    if (assignedToFilter && mongoose.Types.ObjectId.isValid(assignedToFilter)) {
      searchQuery.assignedTo = new mongoose.Types.ObjectId(assignedToFilter);
    }

    // ✅ filter by isRepairable if provided
    const isRepairableFilter = req.query.isRepairable;
    if (isRepairableFilter === 'true') {
      searchQuery.isRepairable = true;
    } else if (isRepairableFilter === 'false') {
      searchQuery.isRepairable = { $ne: true };
    }
if (isSimActivatedFilter === "true") {
  searchQuery.isSimActivated = true;
}

if (isSimActivatedFilter === "false") {
  searchQuery.isSimActivated = false;
}
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
    const totalCount = await simMasterModel.countDocuments(searchQuery);

    const raw = await simMasterModel
      .find(searchQuery)
      .populate({ path: "assignedTo", select: "name companyName" })
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit)
      .lean();

    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const simMasters = raw.map((s) => {
      // ✅ assignedToName
      const assignedToName = s?.assignedTo?.name || s?.assignedTo?.companyName || "";

      // ✅ days in stock
      let daysInStock = null;
      if (s.status === "stock") {
        const start = s.stockEnteredAt || s.createdAt;
        if (start) {
          daysInStock = Math.floor(
            (Date.now() - new Date(start).getTime()) / MS_PER_DAY,
          );
          if (daysInStock < 0) daysInStock = 0;
        } else daysInStock = 0;
      }

      // ✅ demo flags
      let demoDaysLeft = null;
      let demoAlert = false;
      let demoExpired = false;

      if (s.status === "customer demo" && s.demoToDate) {
        const end = new Date(s.demoToDate);
        end.setHours(0, 0, 0, 0);

        demoDaysLeft = Math.ceil((end - today) / MS_PER_DAY);
        demoExpired = demoDaysLeft < 0;
        demoAlert = isDemoExpiringSoon(s.demoToDate, 2);
      }

      return { ...s, assignedToName, daysInStock, demoDaysLeft, demoAlert, demoExpired };
    });

    const totalPages = Math.ceil(totalCount / limit);

    res.status(200).json({
      success: true,
      data: {
        simMasters,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
          nextPage: page < totalPages ? page + 1 : null,
          prevPage: page > 1 ? page - 1 : null,
        },
      },
    });
  } catch (error) {
    console.error("Error in getAllSimMasters:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteSimMaster = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sim master ID",
      });
    }

    const deletedSimMaster = await simMasterModel.findByIdAndDelete(id);

    if (!deletedSimMaster) {
      return res.status(404).json({
        success: false,
        message: "Sim Master not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Sim Master deleted successfully",
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.bulkCreateSimMasters = async (req, res) => {
  try {
    const rawSims = req.body; // Expecting an array of sim objects

    if (!Array.isArray(rawSims) || rawSims.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of SIMs.",
      });
    }

    // Map fields to match the model schema, trim strings, and normalize dates
    const sims = rawSims.map((sim) => {
      const trimmedSim = {};
      for (const [key, value] of Object.entries(sim)) {
        trimmedSim[key] = typeof value === "string" ? value.trim() : value;
      }

      // Normalize purchaseDate to valid Date object or undefined
      let purchaseDate = undefined;
      const normalizedPurchaseDateStr = normalizeDateInputToISODateString(
        trimmedSim.purchaseDate
      );
      if (normalizedPurchaseDateStr) {
        const pd = new Date(normalizedPurchaseDateStr);
        if (!isNaN(pd.getTime())) purchaseDate = pd;
      }

      // Normalize activationDate to YYYY-MM-DD string
      const activationDate = normalizeDateInputToISODateString(
        trimmedSim.activationDate
      );

      // Determine isSimActivated
      const isSimActivated = Boolean(
        activationDate ||
        trimmedSim.isSimActivated === true ||
        trimmedSim.isSimActivated === "true" ||
        trimmedSim.isSimActivated === "Yes" ||
        trimmedSim.isSimActivated === "yes" ||
        trimmedSim.isSimActivated === "Activated" ||
        trimmedSim.isSimActivated === "activated"
      );

      const status = (trimmedSim.status || "stock").toLowerCase();

      return {
        ...trimmedSim,
        status: status || "stock",
        monthlyBillingDate:
          trimmedSim.monthlyBillingDate || trimmedSim.monthlyDate,
        purchaseDate,
        activationDate,
        isSimActivated,
        stockEnteredAt: status === "stock" ? new Date() : undefined,
        statusHistory: [
          {
            status: status || "stock",
            changedAt: new Date(),
            changedBy: req.user?.name || req.user?.email || "system",
          },
        ],
      };
    });

    // Clean up empty strings for enums
    const cleanedSims = sims.map((sim) => {
      if (sim.status === "" || sim.status === null) {
        const { status, ...rest } = sim;
        return rest;
      }
      return sim;
    });

    // 1. Get existing simNumbers and mobileNumbers to skip duplicates
    const allSimNumbers = cleanedSims.map((s) => s.simNumber).filter(Boolean);
    const allMobileNumbers = cleanedSims
      .map((s) => s.mobileNumber)
      .filter(Boolean);

    const existingSims = await simMasterModel.find(
      {
        $or: [
          { simNumber: { $in: allSimNumbers } },
          { mobileNumber: { $in: allMobileNumbers } },
        ],
      },
      "simNumber mobileNumber",
    );

    const existingSimNums = new Set(existingSims.map((s) => s.simNumber));
    const existingMobileNums = new Set(existingSims.map((s) => s.mobileNumber));

    const finalSimsToInsert = [];
    let duplicateCount = 0;
    const seenSimNums = new Set();
    const seenMobileNums = new Set();

    for (const sim of cleanedSims) {
      const isDuplicate =
        (sim.simNumber &&
          (existingSimNums.has(sim.simNumber) ||
            seenSimNums.has(sim.simNumber))) ||
        (sim.mobileNumber &&
          (existingMobileNums.has(sim.mobileNumber) ||
            seenMobileNums.has(sim.mobileNumber)));

      if (isDuplicate) {
        duplicateCount++;
      } else {
        finalSimsToInsert.push(sim);
        if (sim.simNumber) seenSimNums.add(sim.simNumber);
        if (sim.mobileNumber) seenMobileNums.add(sim.mobileNumber);
      }
    }

    let createdSims = [];
    if (finalSimsToInsert.length > 0) {
      createdSims = await simMasterModel.insertMany(finalSimsToInsert);
    }

    res.status(201).json({
      success: true,
      message: `${createdSims.length} SIMs imported successfully. ${duplicateCount} duplicates skipped.`,
      newCount: createdSims.length,
      duplicateCount: duplicateCount,
      data: createdSims,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ✅ Get stock SIM count grouped by simType
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
        { company: new mongoose.Types.ObjectId(clientId), simDetails: { $ne: null } },
        { simDetails: 1, _id: 0 }
      ).lean();

      const linkedSimIds = storeRecords.map((r) => r.simDetails).filter(Boolean);
      matchStage._id = { $in: linkedSimIds };
    }

    const counts = await simMasterModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$simType",
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const result = counts.map((c) => ({
      simType: c._id || "Unknown",
      count: c.count,
    }));

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Preview stock SIMs by simType (returns actual SIM records for bulk-assign preview)
exports.getStockSimsByType = async (req, res) => {
  try {
    const { simType, limit, clientId, status } = req.query;
    if (!simType) {
      return res.status(400).json({ success: false, message: "simType is required" });
    }

    const qty = Math.min(parseInt(limit, 10) || 500, 20000);

    const simFilter = { status: "stock" };
    if (simType && simType !== "all") {
      simFilter.simType =
        simType === "Unknown" ? { $in: [null, "", "Unknown"] } : simType;
    }

    if (status === "sold to customer" || status === "send to customer") {
      simFilter.testingStatus = "tested ok";
    } else if (status === "testing") {
      simFilter.testingStatus = { $ne: "tested ok" };
    }

    if (clientId && clientId !== "all" && mongoose.Types.ObjectId.isValid(clientId)) {
      const MainData = require("../models/mainData.model");
      const storeRecords = await MainData.find(
        { company: new mongoose.Types.ObjectId(clientId), simDetails: { $ne: null } },
        { simDetails: 1, _id: 0 }
      ).lean();
      const linkedIds = storeRecords.map((r) => r.simDetails).filter(Boolean);
      simFilter._id = { $in: linkedIds };
    }

    const sims = await simMasterModel
      .find(simFilter)
      .sort({ createdAt: -1 })
      .limit(qty)
      .select("simNumber mobileNumber simProvider simType testingStatus createdAt")
      .lean();

    const totalAvailable = await simMasterModel.countDocuments(simFilter);

    res.status(200).json({ success: true, sims, totalAvailable });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ Bulk assign stock SIMs to any status (sold to customer, with technician, with cse, foc, testing/r&d)
exports.bulkAssignStatus = async (req, res) => {
  try {
    const { simType, quantity, status, assignedTo, clientId, simIds: manualSimIds } = req.body;

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

    const assignedToModel = getAssignedToModelFromStatus(targetStatus);

    let simIds;

    if (manualSimIds && Array.isArray(manualSimIds) && manualSimIds.length > 0) {
      const objectIds = manualSimIds
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      if (objectIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid SIM IDs provided",
        });
      }

      if (targetStatus === "sold to customer") {
        const nonTestedOk = await simMasterModel
          .find({
            _id: { $in: objectIds },
            testingStatus: { $ne: "tested ok" },
          })
          .select("simNumber mobileNumber testingStatus")
          .lean();

        if (nonTestedOk.length > 0) {
          const samples = nonTestedOk
            .slice(0, 5)
            .map((s) => `${s.simNumber || s.mobileNumber || s._id} (${s.testingStatus || "not tested"})`)
            .join(", ");
          return res.status(400).json({
            success: false,
            message: `Cannot assign to customer: ${nonTestedOk.length} SIM(s) do not have testingStatus as "tested ok" [${samples}${nonTestedOk.length > 5 ? "..." : ""}]. Only SIMs tested OK can be sold to customer.`,
          });
        }
      }

      if (targetStatus === "testing") {
        const alreadyTestedOk = await simMasterModel
          .find({
            _id: { $in: objectIds },
            testingStatus: "tested ok",
          })
          .select("simNumber mobileNumber testingStatus")
          .lean();

        if (alreadyTestedOk.length > 0) {
          const samples = alreadyTestedOk
            .slice(0, 5)
            .map((s) => `${s.simNumber || s.mobileNumber || s._id}`)
            .join(", ");
          return res.status(400).json({
            success: false,
            message: `Cannot assign to R&D / Testing: ${alreadyTestedOk.length} SIM(s) already have testingStatus as "tested ok" [${samples}${alreadyTestedOk.length > 5 ? "..." : ""}]. Only untested SIMs can be assigned for R&D testing.`,
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

      const validSims = await simMasterModel
        .find(validFilter)
        .select("_id")
        .lean();

      if (validSims.length === 0) {
        return res.status(400).json({
          success: false,
          message: targetStatus === "sold to customer"
            ? "None of the selected SIMs are in stock with testingStatus 'tested ok'"
            : targetStatus === "testing"
              ? "None of the selected SIMs are in stock with testing status other than 'tested ok'"
              : "None of the selected SIMs are in stock",
        });
      }

      simIds = validSims.map((s) => s._id);
    } else {
      if (!simType || !quantity) {
        return res.status(400).json({
          success: false,
          message: "Either simIds[] or (simType + quantity) are required",
        });
      }

      const qty = parseInt(quantity, 10);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({
          success: false,
          message: "quantity must be a positive number",
        });
      }

      const simFilter = { status: "stock" };
      if (simType && simType !== "all") {
        simFilter.simType =
          simType === "Unknown" ? { $in: [null, "", "Unknown"] } : simType;
      }
      if (targetStatus === "sold to customer") {
        simFilter.testingStatus = "tested ok";
      } else if (targetStatus === "testing") {
        simFilter.testingStatus = { $ne: "tested ok" };
      }
      if (clientId && clientId !== "all" && mongoose.Types.ObjectId.isValid(clientId)) {
        const MainData = require("../models/mainData.model");
        const storeRecords = await MainData.find(
          { company: new mongoose.Types.ObjectId(clientId), simDetails: { $ne: null } },
          { simDetails: 1, _id: 0 }
        ).lean();
        const linkedIds = storeRecords.map((r) => r.simDetails).filter(Boolean);
        simFilter._id = { $in: linkedIds };
      }

      const sims = await simMasterModel
        .find(simFilter)
        .sort({ createdAt: -1 })
        .limit(qty)
        .select("_id")
        .lean();

      if (sims.length === 0) {
        return res.status(400).json({
          success: false,
          message: targetStatus === "sold to customer"
            ? `No stock SIMs with testingStatus 'tested ok' found for type "${simType}"${clientId && clientId !== "all" ? " for this client" : ""}`
            : targetStatus === "testing"
              ? `No stock SIMs without 'tested ok' status found for type "${simType}"${clientId && clientId !== "all" ? " for this client" : ""}`
              : `No stock SIMs found for type "${simType}"${clientId && clientId !== "all" ? " for this client" : ""}`,
        });
      }

      simIds = sims.map((s) => s._id);
    }

    const changedBy = req.user?.name || req.user?.email || "system";

    await simMasterModel.updateMany(
      { _id: { $in: simIds } },
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
      message: `${simIds.length} SIMs assigned successfully`,
      assignedCount: simIds.length,
      status: targetStatus,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};
