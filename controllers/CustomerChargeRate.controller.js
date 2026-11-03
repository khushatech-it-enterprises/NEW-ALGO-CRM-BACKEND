const { isValidObjectId } = require("mongoose");
const CustomerChargeRateModel = require("../models/customerChargeRateList.model");
const mongoose = require("mongoose");

const createCustomerChargeRateListOfClient = async (req, res) => {
  try {
    const {
      qstClient,
      project,
      device,
      taskType,
      isQuantityBased,
      flatRate,
      charges,
    } = req.body;

    // 1. Basic validation
    if (!qstClient || !device || !taskType) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: qstClient, device, or taskType",
      });
    }

    // console.log(req.body, "Request body");

    // 2. Check either flatRate or quantity-based charges
    if (isQuantityBased) {
      if (!Array.isArray(charges) || charges.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Missing or invalid quantity-based charges",
        });
      }

      const allowedFields = new Set([
        "quantity_1_10",
        "quantity_11_20",
        "quantity_21_25",
        "quantity_26_30",
        "quantity_31_40",
        "quantity_41_50",
        "quantity_51_plus",
      ]);

      const ratesObject = {};

      for (const rate of charges) {
        const { range, amount } = rate;

        if (!allowedFields.has(range)) {
          return res.status(400).json({
            success: false,
            message: `Invalid range: ${range}. Must be one of: ${[
              ...allowedFields,
            ].join(", ")}`,
          });
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount < 0) {
          return res.status(400).json({
            success: false,
            message: `Invalid amount for ${range}. Must be a non-negative number.`,
          });
        }

        ratesObject[range] = parsedAmount;
      }

      // 3. Check for existing - MODIFIED LOGIC FOR PROJECT HANDLING
      // const existingQuery = {
      //   qstClient,
      //   device,
      //   taskType,
      //   $or: [
      //     { project: project || null }, // Match either the same project or null
      //     { project: { $exists: !project } } // Or match existence/non-existence
      //   ]
      // };

      // const existing = await CustomerChargeRateModel.findOne(existingQuery);

      // const projectStatus = project ? { $ne: null } : null;

      // 3. Check for existing - FIXED LOGIC
      const existingQuery = {
        qstClient,
        device,
        taskType
      };

      if (project) {
        existingQuery.project = project; // Exact project match
      } else {
        existingQuery.$or = [
          { project: { $exists: false } },
          { project: null }
        ]; // No project records
      }
      const existing = await CustomerChargeRateModel.findOne(existingQuery);
      // const existing = await CustomerChargeRateModel.findOne({
      //   qstClient,
      //   device,
      //   taskType,
      //   project: projectStatus,
      // });

      if (existing) {
        return res.status(409).json({
          success: false,
          message: "Charge rate for this combination already exists.",
          existingId: existing._id,
        });
      }

      // 4. Save quantity-based
      const newRate = await CustomerChargeRateModel.create({
        qstClient,
        project: project || undefined,
        device,
        taskType,
        isQuantityBased: true,
        rates: ratesObject,
      });

      const populatedRate = await CustomerChargeRateModel.findById(
        newRate._id
      ).populate("qstClient device taskType project");

      return res.status(201).json({
        success: true,
        message: "Quantity-based charge rate created successfully",
        data: populatedRate,
      });
    } else {
      if (
        flatRate === undefined ||
        isNaN(parseFloat(flatRate)) ||
        parseFloat(flatRate) < 0
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid flatRate. Must be a non-negative number.",
        });
      }

      // 3. Check for existing - MODIFIED LOGIC FOR PROJECT HANDLING
      // const existingQuery = {
      //   qstClient,
      //   device,
      //   taskType,
      //   $or: [
      //     { project: project || null }, // Match either the same project or null
      //     { project: { $exists: !project } } // Or match existence/non-existence
      //   ]
      // };

      // const projectStatus = project ? { $ne: null } : null;

      // const existing = await CustomerChargeRateModel.findOne({
      //   qstClient,
      //   device,
      //   taskType,
      //   project: projectStatus,
      // });


      const existingQuery = {
        qstClient,
        device,
        taskType
      };

      if (project) {
        existingQuery.project = project;
      } else {
        existingQuery.$or = [
          { project: { $exists: false } },
          { project: null }
        ];
      }

      const existing = await CustomerChargeRateModel.findOne(existingQuery);

      // const existing = await CustomerChargeRateModel.findOne(existingQuery);

      if (existing) {
        return res.status(409).json({
          success: false,
          message: "Charge rate for this combination already exists.",
          existingId: existing._id,
        });
      }

      // 4. Save flat rate
      const newRate = await CustomerChargeRateModel.create({
        qstClient,
        project: project || undefined,
        device,
        taskType,
        isQuantityBased: false,
        flatRate: parseFloat(flatRate),
      });

      const populatedRate = await CustomerChargeRateModel.findById(
        newRate._id
      ).populate("qstClient device taskType project");

      return res.status(201).json({
        success: true,
        message: "Flat charge rate created successfully",
        data: populatedRate,
      });
    }
  } catch (error) {
    console.error("Error creating charge rates:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create charge rates",
      error: error.message,
    });
  }
};

const updateCustomerChargeRate = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      qstClient,
      project,
      device,
      taskType,
      isQuantityBased, // intentional – see rule (1)
      flatRate,
      charges,
    } = req.body;

    /* ---------- 0. Fetch existing document ---------- */
    const existingDoc = await CustomerChargeRateModel.findById(id);
    if (!existingDoc) {
      return res.status(404).json({
        success: false,
        message: "Charge rate not found.",
      });
    }

    /* ---------- 1. Immutable pricing-type rule ---------- */
    if (
      isQuantityBased !== undefined &&
      isQuantityBased !== existingDoc.isQuantityBased
    ) {
      return res.status(409).json({
        success: false,
        message: "Cannot change pricing type (flat-rate ↔ quantity-based).",
      });
    }

    /* ---------- 2. Build the candidate tuple ---------- */
    const finalQstClient = qstClient ?? existingDoc.qstClient;
    const finalDevice = device ?? existingDoc.device;
    const finalTaskType = taskType ?? existingDoc.taskType;
    const finalProject = project !== undefined ? project : existingDoc.project; // null/"" allowed
    const finalIsQuantityBased = existingDoc.isQuantityBased; // already frozen above

    /* ---------- 3. Validate incoming data based on type ---------- */
    if (finalIsQuantityBased) {
      if (charges !== undefined) {
        const allowed = new Set([
          "quantity_1_10",
          "quantity_11_20",
          "quantity_21_25",
          "quantity_26_30",
          "quantity_31_40",
          "quantity_41_50",
          "quantity_51_plus",
        ]);
        const rates = {};
        for (const { range, amount } of charges) {
          if (!allowed.has(range)) {
            return res.status(400).json({
              success: false,
              message: `Invalid range: ${range}`,
            });
          }
          const num = parseFloat(amount);
          if (isNaN(num) || num < 0) {
            return res.status(400).json({
              success: false,
              message: `Invalid amount for ${range}`,
            });
          }
          rates[range] = num;
        }
        existingDoc.rates = rates;
      }
    } else {
      if (flatRate !== undefined) {
        const num = parseFloat(flatRate);
        if (isNaN(num) || num < 0) {
          return res.status(400).json({
            success: false,
            message: "Invalid flatRate",
          });
        }
        existingDoc.flatRate = num;
      }
    }

    /* ---------- 4. Uniqueness check (project-status rule) ---------- */
    // When no project: match both null and missing-field documents
    const conflictProjectQuery = finalProject
      ? { project: finalProject }
      : { $or: [{ project: { $exists: false } }, { project: null }] };

    const conflict = await CustomerChargeRateModel.findOne({
      _id: { $ne: id }, // ignore current doc
      qstClient: finalQstClient,
      device: finalDevice,
      taskType: finalTaskType,
      ...conflictProjectQuery,
    });

    if (conflict) {
      return res.status(409).json({
        success: false,
        message: "Updated combination already exists.",
        conflictingId: conflict._id,
      });
    }

    /* ---------- 5. Apply safe updates ---------- */
    // Build the update op using $unset to physically remove the project field
    // when there is no project. Assigning undefined to an existing Mongoose
    // doc field is silently ignored, leaving the old null value in MongoDB,
    // which then breaks the $exists:false lookup at ticket creation time.
    const updateOp = {
      $set: {
        qstClient: finalQstClient,
        device: finalDevice,
        taskType: finalTaskType,
        ...(existingDoc.isQuantityBased
          ? { rates: existingDoc.rates }
          : { flatRate: existingDoc.flatRate }),
      },
    };

    if (finalProject) {
      updateOp.$set.project = finalProject;
    } else {
      updateOp.$unset = { project: "" }; // physically remove the field from MongoDB
    }

    const updated = await CustomerChargeRateModel.findByIdAndUpdate(
      id,
      updateOp,
      { new: true }
    );
    const populated = await CustomerChargeRateModel.findById(
      updated._id
    ).populate("qstClient device taskType project");

    return res.status(200).json({
      success: true,
      message: "Charge rate updated successfully.",
      data: populated,
    });
  } catch (err) {
    console.error("Error updating charge rate:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update charge rate",
      error: err.message,
    });
  }
};

const getCustomerChargeById = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid charge rate ID format",
      });
    }

    // Find the charge rate with full population
    const chargeRate = await CustomerChargeRateModel.findById(id)
      .populate("qstClient", "companyShortName companyName _id") // Only include specific fields
      .populate("project", "projectName _id")
      .populate("device", "deviceName _id")
      .populate("taskType", "taskName _id")
      .lean(); // Convert to plain JavaScript object

    if (!chargeRate) {
      return res.status(404).json({
        success: false,
        message: "Charge rate not found",
      });
    }

    // Transform the response format for better client consumption
    const responseData = {
      _id: chargeRate._id,
      client: {
        _id: chargeRate.qstClient?._id,
        shortName: chargeRate.qstClient?.companyShortName,
        name: chargeRate.qstClient?.companyName,
      },
      project: chargeRate.project
        ? {
          _id: chargeRate.project?._id,
          name: chargeRate.project.projectName,
        }
        : null,
      device: {
        _id: chargeRate.device?._id,
        name: chargeRate?.device?.deviceName,
      },
      taskType: {
        _id: chargeRate.taskType?._id,
        name: chargeRate.taskType.taskName,
      },
      isQuantityBased: chargeRate.isQuantityBased,
      pricingDetails: chargeRate.isQuantityBased
        ? {
          quantityRates: {
            quantity_1_10: chargeRate.rates.quantity_1_10,
            quantity_11_20: chargeRate.rates.quantity_11_20,
            quantity_21_25: chargeRate.rates.quantity_21_25,
            quantity_26_30: chargeRate.rates.quantity_26_30,
            quantity_31_40: chargeRate.rates.quantity_31_40,
            quantity_41_50: chargeRate.rates.quantity_41_50,
            quantity_51_plus: chargeRate.rates.quantity_51_plus,
          },
        }
        : {
          flatRate: chargeRate.flatRate,
        },
      createdAt: chargeRate.created_at,
      updatedAt: chargeRate.updated_at,
    };

    return res.status(200).json({
      success: true,
      message: "Charge rate retrieved successfully",
      data: responseData,
    });
  } catch (error) {
    console.error("Error fetching charge rate:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch charge rate",
      error: error.message,
    });
  }
};

const deleteCustomerChargeRate = async (req, res) => {
  try {
    const { id } = req.params;
    // console.log(id, "skjdhskjahdajkshdkjashdkj");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid charge rate ID format",
      });
    }

    const deleted = await CustomerChargeRateModel.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Charge rate not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Charge rate deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting charge rate:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete charge rate",
      error: error.message,
    });
  }
};

// it used in ticket creation page for direct apply customer charge per vehicle
const getCustomerRatePerVehicleForTicketCreatePage = async (req, res) => {
  try {
    const { qstClient, project, device, taskType } = req.query;

    // Validate required parameters
    if (!qstClient || !device || !taskType) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: qstClient, device, or taskType",
      });
    }

    // Validate ObjectIDs
    if (
      !isValidObjectId(qstClient) ||
      !isValidObjectId(device) ||
      !isValidObjectId(taskType)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid ID format",
      });
    }

    // Search in this order:
    // 1. Exact match with project (if provided)
    // 2. Client+Device+Task without project

    const baseQuery = {
      qstClient,
      device,
      taskType,
    };

    // console.log(project,"oooooooooooooooo")
    // 1. First try exact match including project (if provided)
    if (project && isValidObjectId(project)) {
      const chargeRate = await CustomerChargeRateModel.findOne({
        ...baseQuery,
        project,
      }).lean();

      // console.log(chargeRate, "Charge rate found");
      // console.log(baseQuery, "baseQuery");
      if (chargeRate) {
        return res.json({
          success: true,
          data: formatResponse(chargeRate),
        });
      } else {
        // Project specified but no rate found - return null
        return res.json({
          success: true,
          data: null,
          message: "No charge rates found for this project combination",
        });
      }
    }

    // 2. Try without project (general rate for this client+device+task)
    // Use $or to cover both: field absent ($exists: false) and field stored as null
    const generalRate = await CustomerChargeRateModel.findOne({
      ...baseQuery,
      $or: [
        { project: { $exists: false } },
        { project: null },
      ],
    }).lean();


    // Helper function to format response
    function formatResponse(chargeRate) {
      return {
        ...chargeRate,
        pricingType: chargeRate.flatRate ? "flat" : "quantity",
        isQuantityBased: !!chargeRate.rates,
      };
    }

    if (generalRate) {
      return res.json({
        success: true,
        data: formatResponse(generalRate),
      });
    }

    // 3. No rates found at all
    return res.json({
      success: true,
      data: null,
      message: "No charge rates found for this combination",
    });
  } catch (error) {
    console.error("Error fetching charge rates:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching charge rates",
    });
  }
};

// const getAllCustomerChargeRateListOfClient = async (req, res) => {
//   try {
//     const { page = 1, limit = 10, search = "" } = req.query;
//     const skip = (page - 1) * limit;

//     // Aggregation pipeline
//     const pipeline = [
//       // Lookup for all referenced collections
//       {
//         $lookup: {
//           from: "qstclients",
//           localField: "qstClient",
//           foreignField: "_id",
//           as: "qstClient",
//         },
//       },
//       { $unwind: { path: "$qstClient", preserveNullAndEmptyArrays: true } },
//       {
//         $lookup: {
//           from: "projects",
//           localField: "project",
//           foreignField: "_id",
//           as: "project",
//         },
//       },
//       { $unwind: { path: "$project", preserveNullAndEmptyArrays: true } },
//       {
//         $lookup: {
//           from: "devices",
//           localField: "device",
//           foreignField: "_id",
//           as: "device",
//         },
//       },
//       { $unwind: { path: "$device", preserveNullAndEmptyArrays: true } },
//       {
//         $lookup: {
//           from: "tasks",
//           localField: "taskType",
//           foreignField: "_id",
//           as: "taskType",
//         },
//       },
//       { $unwind: { path: "$taskType", preserveNullAndEmptyArrays: true } },
//     ];

//     // Add search match if search term exists
//     // if (search) {
//     //   pipeline.push({
//     //     $match: {
//     //       $or: [
//     //         { 'qstClient.companyShortName': { $regex: search, $options: 'i' } },
//     //         { 'project.projectName': { $regex: search, $options: 'i' } },
//     //         { 'device.deviceName': { $regex: search, $options: 'i' } },
//     //         { 'taskType.taskName': { $regex: search, $options: 'i' } }
//     //       ]
//     //     }
//     //   });
//     // }

//     const escapeRegex = (text) => {
//       return text.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"); // Escape all special regex chars
//     };

//     if (search) {
//       const escapedSearch = escapeRegex(search.trim());

//       pipeline.push({
//         $match: {
//           $or: [
//             {
//               "qstClient.companyShortName": {
//                 $regex: escapedSearch,
//                 $options: "i",
//               },
//             },
//             { "project.projectName": { $regex: escapedSearch, $options: "i" } },
//             {
//               $and: [
//                 { device: { $exists: true, $ne: null } },
//                 {
//                   $or: [
//                     // Match full device name
//                     //  { 'device': { $exists: true, $ne: null } },
//                     {
//                       "device.deviceName": {
//                         $regex: `^${escapedSearch}`,
//                         $options: "i",
//                       },
//                     }, // Left-anchored match
//                     // { 'device.deviceName': { $regex: `^${escapedSearch}$`, $options: 'i' } },
//                     //  { 'device.deviceName': { $regex: `^${escapedSearch}`, $options: 'i' } } // Left-anchored match
//                     // Match any part of device name
//                     // { 'device.deviceName': { $regex: escapedSearch, $options: 'i' } },
//                     // Match words separately (for "CCTV - DVR" style names)
//                     // { 'device.deviceName': { $regex: escapedSearch.split(/\s+/).join('|'), $options: 'i' } }
//                   ],
//                 },
//               ],
//             },
//             { "taskType.taskName": { $regex: escapedSearch, $options: "i" } },
//           ],
//         },
//       });
//     }

//     // Add count and pagination stages
//     const countPipeline = [...pipeline, { $count: "total" }];
//     const dataPipeline = [
//       ...pipeline,
//       { $sort: { created_at: -1 } },
//       { $skip: skip },
//       { $limit: parseInt(limit) },
//     ];

//     // Execute in parallel
//     const [countResult, data] = await Promise.all([
//       CustomerChargeRateModel.aggregate(countPipeline),
//       CustomerChargeRateModel.aggregate(dataPipeline),
//     ]);

//     const total = countResult[0]?.total || 0;

//     res.status(200).json({
//       success: true,
//       data,
//       total,
//       page: parseInt(page),
//       pages: Math.ceil(total / limit),
//       limit: parseInt(limit),
//     });
//   } catch (error) {
//     console.error("Error:", error);
//     res.status(500).json({
//       success: false,
//       message: "Server error",
//     });
//   }
// };

const getAllCustomerChargeRateListOfClient = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", client, project, device } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const escapeRegex = (text) =>
      text.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");

    // ── Step 1: populate all refs ──────────────────────────────────────────
    const pipeline = [
      {
        $lookup: {
          from: "qstclients",
          localField: "qstClient",
          foreignField: "_id",
          as: "qstClient",
        },
      },
      { $unwind: { path: "$qstClient", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "projects",
          localField: "project",
          foreignField: "_id",
          as: "project",
        },
      },
      { $unwind: { path: "$project", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "devices",
          localField: "device",
          foreignField: "_id",
          as: "device",
        },
      },
      { $unwind: { path: "$device", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "tasks",
          localField: "taskType",
          foreignField: "_id",
          as: "taskType",
        },
      },
      { $unwind: { path: "$taskType", preserveNullAndEmptyArrays: true } },
    ];

    // ── Step 2: search filter ──────────────────────────────────────────────
    if (search) {
      const escapedSearch = escapeRegex(search.trim());
      pipeline.push({
        $match: {
          $or: [
            { "qstClient.companyShortName": { $regex: escapedSearch, $options: "i" } },
            { "project.projectName": { $regex: escapedSearch, $options: "i" } },
            { "device.deviceName": { $regex: escapedSearch, $options: "i" } },
            { "taskType.taskName": { $regex: escapedSearch, $options: "i" } },
          ],
        },
      });
    }

    // ── Step 3: dropdown filters ───────────────────────────────────────────
    if (client && mongoose.Types.ObjectId.isValid(client)) {
      pipeline.push({ $match: { "qstClient._id": new mongoose.Types.ObjectId(client) } });
    }
    if (project && mongoose.Types.ObjectId.isValid(project)) {
      pipeline.push({ $match: { "project._id": new mongoose.Types.ObjectId(project) } });
    }
    if (device && mongoose.Types.ObjectId.isValid(device)) {
      pipeline.push({ $match: { "device._id": new mongoose.Types.ObjectId(device) } });
    }

    // ── Step 4: group by client + project + device ─────────────────────────
    // Each group holds an array of taskRates (one per task type document)
    pipeline.push(
      {
        $group: {
          _id: {
            qstClientId: "$qstClient._id",
            projectId: { $ifNull: ["$project._id", null] },
            deviceId: "$device._id",
          },
          qstClient: { $first: "$qstClient" },
          project: { $first: "$project" },
          device: { $first: "$device" },
          // Collect each individual task-rate record as its own object
          taskRates: {
            $push: {
              _id: "$_id",
              taskType: "$taskType",
              flatRate: "$flatRate",
              rates: "$rates",
              isQuantityBased: "$isQuantityBased",
              updated_at: "$updated_at",
            },
          },
          // Keep the earliest createdAt for stable sort
          created_at: { $min: "$created_at" },
        },
      },
      { $sort: { "qstClient.companyShortName": 1, "device.deviceName": 1 } }
    );

    // ── Step 5: paginate on grouped results ────────────────────────────────
    const countPipeline = [...pipeline, { $count: "total" }];
    const dataPipeline = [
      ...pipeline,
      { $skip: skip },
      { $limit: parseInt(limit) },
    ];

    const [countResult, data] = await Promise.all([
      CustomerChargeRateModel.aggregate(countPipeline),
      CustomerChargeRateModel.aggregate(dataPipeline),
    ]);

    const total = countResult[0]?.total || 0;

    res.status(200).json({
      success: true,
      data,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
      limit: parseInt(limit),
    });
  } catch (error) {
    console.error("Error in getAllCustomerChargeRateListOfClient:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// Bulk delete all task-rate records belonging to one grouped row (client+project+device)
const deleteCustomerChargeRateGroup = async (req, res) => {
  try {
    const { ids } = req.body; // array of _id strings

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ids must be a non-empty array",
      });
    }

    const invalidIds = ids.filter((id) => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid IDs: ${invalidIds.join(", ")}`,
      });
    }

    const result = await CustomerChargeRateModel.deleteMany({
      _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
    });

    return res.status(200).json({
      success: true,
      message: `${result.deletedCount} charge rate(s) deleted successfully`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Error deleting charge rate group:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete charge rate group",
      error: error.message,
    });
  }
};

module.exports = {
  createCustomerChargeRateListOfClient,
  getAllCustomerChargeRateListOfClient,
  getCustomerChargeById,
  deleteCustomerChargeRate,
  deleteCustomerChargeRateGroup,
  getCustomerRatePerVehicleForTicketCreatePage,
  updateCustomerChargeRate,
};

