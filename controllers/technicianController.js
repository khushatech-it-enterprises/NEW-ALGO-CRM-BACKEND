// controllers/technician.controller.js

const Technician = require("../models/technician.model");
//const Employee = require("../models/employee.model");
const Ticket = require("../models/ticket.model");
const mongoose = require("mongoose");
const dayjs = require("dayjs");

const securityCodeModel = require("../models/securityCode.model");
const DeviceMaster = require("../models/deviceMaster");
const SimMaster = require("../models/simMaster");
const AccessoryMaster = require("../models/accessoryMaster");
const MainData = require("../models/mainData.model");

exports.getAllTechnicians = async (req, res) => {
  try {
    const technicians = await Technician.find();
    // console.log(technicians.length, "length===================");
    res.status(200).json({
      status: true,
      success: true,
      message: "Technicians retrieved successfully",
      data: technicians,
    });
  } catch (error) {
    console.error("Error in getAllTechnicians:", error);
    res.status(500).json({ error: "Internal server error." });
  }
};

exports.getTechnicianById = async (req, res) => {
  const { id } = req.params;
  try {
    const technician = await Technician.findById(id);
    if (!technician) {
      return res.status(404).json({
        success: false,
        message: "Technician not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Technician retrieved successfully",
      technician,
    });
  } catch (error) {
    console.error("Error in getTechnicianById:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

exports.checkTechnicianAccountNuberAtomicity = async (req, res) => {
  try {
    const { accountNumber } = req.params;

    if (!accountNumber) {
      return res.status(400).json({
        success: false,
        message: "Account number is required",
      });
    }

    const technician = await Technician.findOne({ accountNumber });

    res.status(200).json({
      success: true,
      exists: !!technician,
      message: technician
        ? "Account number already exists"
        : "Account number is available",
    });
  } catch (error) {
    console.error("Error checking account number:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

exports.getAllTechniciansWithSearchAndFilter = async (req, res) => {
  try {
    const { search = "", page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    // Build search query
    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { nickName: { $regex: search, $options: "i" } },
        { location: { $regex: search, $options: "i" } },
        { state: { $regex: search, $options: "i" } },
        { accountNumber: { $regex: search, $options: "i" } },
        { beneficiaryId: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
      ];
    }

    // Get total count and paginated data
    const [totalItems, technicians] = await Promise.all([
      Technician.countDocuments(query),
      Technician.find(query)
        .populate("technicianCreator", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    res.status(200).json({
      success: true,
      data: technicians,
      pagination: {
        totalItems,
        totalPages,
        currentPage: parseInt(page),
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Error fetching technicians:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


// Bulk update technician category types for all technicians with missing/invalid categories
exports.bulkUpdateTechnicianCategories = async (req, res) => {
  try {
    const { defaultCategory = 'freelance' } = req.body; // Optional: allow specifying default category

    // Validate default category
    if (!['payroll', 'freelance'].includes(defaultCategory)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid default category. Must be either "payroll" or "freelance"'
      });
    }

    // Find and update all technicians with missing, invalid, or null category types
    const result = await Technician.updateMany(
      {
        $or: [
          { technicianCategoryType: { $exists: false } },
          { technicianCategoryType: null },
          { technicianCategoryType: '' },
          { technicianCategoryType: { $nin: ['payroll', 'freelance'] } }
        ]
      },
      {
        $set: { technicianCategoryType: defaultCategory }
      }
    );

    // Get details of updated technicians
    const updatedTechnicians = await Technician.find({
      _id: {
        $in: (await Technician.find({
          $or: [
            { technicianCategoryType: { $exists: false } },
            { technicianCategoryType: null },
            { technicianCategoryType: '' },
            { technicianCategoryType: { $nin: ['payroll', 'freelance'] } }
          ]
        })).map(t => t._id)
      }
    }).select('name nickName technicianCategoryType');

    res.json({
      success: true,
      message: `Bulk update completed successfully`,
      summary: {
        totalTechniciansInDatabase: await Technician.countDocuments(),
        techniciansMatched: result.matchedCount,
        techniciansUpdated: result.modifiedCount,
        defaultCategoryApplied: defaultCategory
      },
      updatedTechnicians: updatedTechnicians,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in bulk updating technician categories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk update technician categories',
      error: error.message
    });
  }
};




// exports.getAllNewViewTechniciansWithSearchAndFilter = async (req, res) => {
//   try {
//     const { search = "", page = 1, limit = 10 } = req.query;
//     const skip = (page - 1) * limit;

//      // Calculate date 30 days ago from current date
//     const thirtyDaysAgo = new Date();
//     thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

//     // Build search query
//     const query = {
//       createdAt: { $gte: thirtyDaysAgo } // Filter for documents created in the last 30 days
//     };
//     if (search) {
//       query.$or = [
//         { name: { $regex: search, $options: "i" } },
//         { email: { $regex: search, $options: "i" } },
//         { nickName: { $regex: search, $options: "i" } },
//         { location: { $regex: search, $options: "i" } },
//         { state: { $regex: search, $options: "i" } },
//         { accountNumber: { $regex: search, $options: "i" } },
//         { beneficiaryId: { $regex: search, $options: "i" } },
//         { phoneNumber: { $regex: search, $options: "i" } },
//       ];
//     }

//     // Get total count and paginated data
//     const [totalItems, technicians] = await Promise.all([
//       Technician.countDocuments(query),
//       Technician.find(query)
//       .populate("technicianCreator", "name")
//         .sort({ createdAt: -1 })
//         .skip(skip)
//         .limit(parseInt(limit)),
//     ]);

//     const totalPages = Math.ceil(totalItems / limit);

//     res.status(200).json({
//       success: true,
//       data: technicians,
//       pagination: {
//         totalItems,
//         totalPages,
//         currentPage: parseInt(page),
//         itemsPerPage: parseInt(limit),
//       },
//     });
//   } catch (error) {
//     console.error("Error fetching technicians:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// };



// exports.getAllNewViewTechniciansWithSearchAndFilter = async (req, res) => {
//   try {
//     const { search = "", page = 1, limit = 10, zone } = req.query;
//     const skip = (page - 1) * limit;

//     // Calculate date 30 days ago
//     const thirtyDaysAgo = new Date();
//     thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

//     // Build search conditions
//     const searchConditions = [];
//     if (search) {
//       const regex = new RegExp(search, "i");
//       searchConditions.push(
//         { name: regex },
//         { email: regex },
//         { nickName: regex },
//         { location: regex },
//         { state: regex },
//         { accountNumber: regex },
//         { beneficiaryId: regex },
//         { phoneNumber: regex }
//       );
//     }

//     // Build aggregation pipeline
//     const pipeline = [
//       // Filter technicians created in the last 30 days
//       {
//         $match: {
//           createdAt: { $gte: thirtyDaysAgo },
//         },
//       },
//       // Lookup employee (technicianCreator)
//       {
//         $lookup: {
//           from: "employees", // collection name in MongoDB
//           localField: "technicianCreator",
//           foreignField: "_id",
//           as: "creator",
//         },
//       },
//       {
//         $unwind: {
//           path: "$creator",
//           preserveNullAndEmptyArrays: true,
//         },
//       },
//     ];

//     // Apply zone filter if provided
//     if (zone) {
//   pipeline.push({
//     $match: {
//       $or: [
//         { "creator.zone": zone },         // matches given zone
//         { "creator.zone": { $exists: false } }, // include if zone missing
//         { "creator.zone": "" },           // include if zone is empty string
//       ]
//     },
//   });
// }

//     // Apply search filter if provided
//     if (searchConditions.length > 0) {
//       pipeline.push({
//         $match: {
//           $or: searchConditions,
//         },
//       });
//     }

//     // Sort by newest first
//     pipeline.push({ $sort: { createdAt: -1 } });

//     // Count total before pagination
//     const countPipeline = [...pipeline, { $count: "totalItems" }];
//     const totalItemsResult = await Technician.aggregate(countPipeline);
//     const totalItems = totalItemsResult[0]?.totalItems || 0;

//     // Apply pagination
//     pipeline.push({ $skip: skip });
//     pipeline.push({ $limit: parseInt(limit) });

//     // Project fields (optional: to control what you return)
//     pipeline.push({
//       $project: {
//         name: 1,
//         nickName: 1,
//         email: 1,
//         location: 1,
//         state: 1,
//         phoneNumber: 1,
//         accountNumber: 1,
//         ifscCode: 1,
//         createdAt: 1,
//         "creator._id": 1,
//         "creator.name": 1,
//         "creator.zone": 1,
//       },
//     });

//     // Execute aggregation
//     const technicians = await Technician.aggregate(pipeline);

//     const totalPages = Math.ceil(totalItems / limit);

//     res.status(200).json({
//       success: true,
//       data: technicians,
//       pagination: {
//         totalItems,
//         totalPages,
//         currentPage: parseInt(page),
//         itemsPerPage: parseInt(limit),
//       },
//     });
//   } catch (error) {
//     console.error("Error fetching technicians:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// };

// '''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''

// exports.getAllNewViewTechniciansWithSearchAndFilter = async (req, res) => {
//   try {
//     const { search = "", page = 1, limit = 10, zone } = req.query;
//     const skip = (page - 1) * limit;

//     // Calculate date 30 days ago
//     const thirtyDaysAgo = new Date();
//     thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

//     // Build search conditions
//     const searchConditions = [];
//     if (search) {
//       const regex = new RegExp(search, "i");
//       searchConditions.push(
//         { name: regex },
//         { email: regex },
//         { nickName: regex },
//         { location: regex },
//         { state: regex },
//         { accountNumber: regex },
//         { beneficiaryId: regex },
//         { phoneNumber: regex }
//       );
//     }

//     // Build aggregation pipeline
//     const pipeline = [
//       {
//         $lookup: {
//           from: "tickets",
//           localField: "_id",
//           foreignField: "technician",
//           as: "tickets",
//         },
//       },
//       {
//         $lookup: {
//           from: "employees",
//           localField: "technicianCreator",
//           foreignField: "_id",
//           as: "creator",
//         },
//       },
//       {
//         $unwind: {
//           path: "$creator",
//           preserveNullAndEmptyArrays: true,
//         },
//       },
//     ];

//     // ✅ Apply zone filter only if provided
//     if (zone) {
//       pipeline.push({
//         $match: {
//           "creator.zone": zone,
//         },
//       });
//     }

//     // ✅ Apply search filter after lookup + unwind
//     if (searchConditions.length > 0) {
//       pipeline.push({
//         $match: { $or: searchConditions },
//       });
//     }

//     // ✅ Filter + calculate ticket counts and vehicles
//     pipeline.push({
//       $addFields: {
//         filteredTickets: {
//           $filter: {
//             input: "$tickets",
//             as: "t",
//             cond: {
//               $and: [
//                 { $eq: ["$$t.ticketStatus", "work done"] },
//                 { $gte: ["$$t.createdAt", thirtyDaysAgo] }
//               ]
//             }
//           }
//         },
//         totalTickets: {
//           $size: {
//             $filter: {
//               input: "$tickets",
//               as: "t",
//               cond: {
//                 $and: [
//                   { $eq: ["$$t.ticketStatus", "work done"] },
//                   { $gte: ["$$t.createdAt", thirtyDaysAgo] }
//                 ]
//               }
//             }
//           }
//         },
//         totalVehicles: {
//           $sum: {
//             $map: {
//               input: {
//                 $filter: {
//                   input: "$tickets",
//                   as: "t",
//                   cond: {
//                     $and: [
//                       { $eq: ["$$t.ticketStatus", "work done"] },
//                       { $gte: ["$$t.createdAt", thirtyDaysAgo] }
//                     ]
//                   }
//                 }
//               },
//               as: "t",
//               in: "$$t.noOfVehicles"
//             }
//           }
//         }
//       }
//     });

//     // Sort (most active technicians first)
//     pipeline.push({ $sort: { totalTickets: -1, createdAt: -1 } });

//     // Count total before pagination
//     const countPipeline = [...pipeline, { $count: "totalItems" }];
//     const totalItemsResult = await Technician.aggregate(countPipeline);
//     const totalItems = totalItemsResult[0]?.totalItems || 0;

//     // Pagination
//     pipeline.push({ $skip: skip });
//     pipeline.push({ $limit: parseInt(limit) });

//     // Final projection
//     pipeline.push({
//       $project: {
//         name: 1,
//         nickName: 1,
//         email: 1,
//         location: 1,
//         state: 1,
//         phoneNumber: 1,
//         accountNumber: 1,
//         ifscCode: 1,
//         createdAt: 1,
//         totalTickets: 1,
//         totalVehicles: 1,
//         tickets: "$filteredTickets", // only send filtered ones
//         "creator._id": 1,
//         "creator.name": 1,
//         "creator.zone": 1,
//       },
//     });

//     // Execute aggregation
//     const technicians = await Technician.aggregate(pipeline);
//     const totalPages = Math.ceil(totalItems / limit);

//     res.status(200).json({
//       success: true,
//       data: technicians,
//       pagination: {
//         totalItems,
//         totalPages,
//         currentPage: parseInt(page),
//         itemsPerPage: parseInt(limit),
//       },
//     });
//   } catch (error) {
//     console.error("Error fetching technicians:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// };









// '''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''



exports.getAllNewViewTechniciansWithSearchAndFilter = async (req, res) => {
  try {
    const { search = "", page = 1, limit = 10, zone } = req.query;
    const skip = (page - 1) * limit;

    // ✅ Calculate date 30 days ago
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // ✅ Build search conditions
    const searchConditions = [];
    if (search) {
      const regex = new RegExp(search, "i");
      searchConditions.push(
        { name: regex },
        { email: regex },
        { nickName: regex },
        { location: regex },
        { state: regex },
        { accountNumber: regex },
        { beneficiaryId: regex },
        { phoneNumber: regex }
      );
    }

    // ✅ Build aggregation pipeline
    const pipeline = [
      {
        $match: {
          createdAt: { $gte: thirtyDaysAgo }, // ✅ Only last 30 days technicians
        },
      },
      {
        $lookup: {
          from: "tickets",
          localField: "_id",
          foreignField: "technician",
          as: "tickets",
        },
      },
      {
        $lookup: {
          from: "employees",
          localField: "technicianCreator",
          foreignField: "_id",
          as: "creator",
        },
      },
      {
        $unwind: {
          path: "$creator",
          preserveNullAndEmptyArrays: true,
        },
      },
    ];

    // ✅ Apply zone filter if provided
    if (zone) {
      pipeline.push({
        $match: {
          "creator.zone": zone,
        },
      });
    }

    // ✅ Apply search filter after lookups
    if (searchConditions.length > 0) {
      pipeline.push({
        $match: { $or: searchConditions },
      });
    }

    // ✅ Filter tickets and calculate counts
    pipeline.push({
      $addFields: {
        filteredTickets: {
          $filter: {
            input: "$tickets",
            as: "t",
            cond: {
              $and: [
                { $eq: ["$$t.ticketStatus", "work done"] },
                // { $gte: ["$$t.createdAt", thirtyDaysAgo] },
              ],
            },
          },
        },
        totalTickets: {
          $size: {
            $filter: {
              input: "$tickets",
              as: "t",
              cond: {
                $and: [
                  { $eq: ["$$t.ticketStatus", "work done"] },
                  // { $gte: ["$$t.createdAt", thirtyDaysAgo] },
                ],
              },
            },
          },
        },
        totalVehicles: {
          $sum: {
            $map: {
              input: {
                $filter: {
                  input: "$tickets",
                  as: "t",
                  cond: {
                    $and: [
                      { $eq: ["$$t.ticketStatus", "work done"] },
                      // { $gte: ["$$t.createdAt", thirtyDaysAgo] },
                    ],
                  },
                },
              },
              as: "t",
              in: "$$t.noOfVehicles",
            },
          },
        },
      },
    });

    // ✅ Sort (most recent technicians first, then most tickets)
    pipeline.push({ $sort: { createdAt: -1, totalTickets: -1 } });

    // ✅ Count before pagination
    const countPipeline = [...pipeline, { $count: "totalItems" }];
    const totalItemsResult = await Technician.aggregate(countPipeline);
    const totalItems = totalItemsResult[0]?.totalItems || 0;

    // ✅ Pagination
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: parseInt(limit) });

    // ✅ Final projection
    pipeline.push({
      $project: {
        name: 1,
        nickName: 1,
        email: 1,
        location: 1,
        state: 1,
        phoneNumber: 1,
        accountNumber: 1,
        ifscCode: 1,
        createdAt: 1,
        totalTickets: 1,
        totalVehicles: 1,
        tickets: "$filteredTickets", // Only filtered tickets returned
        "creator._id": 1,
        "creator.name": 1,
        "creator.zone": 1,
      },
    });

    // ✅ Execute aggregation
    const technicians = await Technician.aggregate(pipeline);
    const totalPages = Math.ceil(totalItems / limit);

    res.status(200).json({
      success: true,
      data: technicians,
      pagination: {
        totalItems,
        totalPages,
        currentPage: parseInt(page),
        itemsPerPage: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Error fetching technicians:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};








exports.ExportgetAllNewViewTechnicians = async (req, res) => {
  try {
    let { zone, fromDate, toDate } = req.query;

    // Default: last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Build date range
    let from;
    let to;
    if (fromDate) {
      from = dayjs(fromDate).startOf("day").toDate();
    }
    if (toDate) {
      to = dayjs(toDate).endOf("day").toDate();
    }

    // Match by date range or default last 30 days
    const initialMatch = {};
    if (from && to) {
      initialMatch.createdAt = { $gte: from, $lte: to };
    } else if (from && !to) {
      initialMatch.createdAt = { $gte: from };
    } else if (!from && to) {
      initialMatch.createdAt = { $lte: to };
    } else {
      initialMatch.createdAt = { $gte: thirtyDaysAgo };
    }

    // Aggregation pipeline
    const pipeline = [
      { $match: initialMatch },
      {
        $lookup: {
          from: "tickets",
          localField: "_id",
          foreignField: "technician",
          as: "tickets",
        },
      },
      {
        $lookup: {
          from: "employees",
          localField: "technicianCreator",
          foreignField: "_id",
          as: "creator",
        },
      },
      {
        $unwind: {
          path: "$creator",
          preserveNullAndEmptyArrays: true,
        },
      },
    ];

    // Zone filter
    if (zone) {
      pipeline.push({
        $match: { "creator.zone": zone },
      });
    }

    // Add ticket calculations
    pipeline.push({
      $addFields: {
        filteredTickets: {
          $filter: {
            input: "$tickets",
            as: "t",
            cond: {
              $and: [
                { $eq: ["$$t.ticketStatus", "work done"] },
              ],
            },
          },
        },
        totalTickets: {
          $size: {
            $filter: {
              input: "$tickets",
              as: "t",
              cond: {
                $and: [
                  { $eq: ["$$t.ticketStatus", "work done"] },
                ],
              },
            },
          },
        },
        totalVehicles: {
          $sum: {
            $map: {
              input: {
                $filter: {
                  input: "$tickets",
                  as: "t",
                  cond: {
                    $and: [
                      { $eq: ["$$t.ticketStatus", "work done"] },
                    ],
                  },
                },
              },
              as: "t",
              in: "$$t.noOfVehicles",
            },
          },
        },
      },
    });

    // Sort by date (newest first), then ticket count
    pipeline.push({ $sort: { createdAt: -1, totalTickets: -1 } });

    // Projection
    pipeline.push({
      $project: {
        name: 1,
        nickName: 1,
        email: 1,
        location: 1,
        pincode: 1,
        experience: 1,
        bankName: 1,
        skills: 1,
        state: 1,
        beneficiaryId: 1,
        beneficiaryName: 1,
        phoneNumber: 1,
        accountNumber: 1,
        ifscCode: 1,
        createdAt: 1,
        updatedAt: 1,
        totalTickets: 1,
        totalVehicles: 1,
        tickets: "$filteredTickets",
        "creator._id": 1,
        "creator.name": 1,
        "creator.zone": 1,
      },
    });

    // Execute aggregation
    const technicians = await Technician.aggregate(pipeline);

    res.status(200).json({
      success: true,
      count: technicians.length,
      data: technicians,
    });
  } catch (error) {
    console.error("Error fetching technicians:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};





exports.bulkCreateTechnicians = async (req, res) => {
  try {
    const { technicians, creator } = req.body;

    if (!Array.isArray(technicians) || technicians.length === 0) {
      return res
        .status(400)
        .json({ error: "Technicians must be a non-empty array." });
    }

    if (!creator) {
      return res
        .status(400)
        .json({ error: "Creator (Employee ID) is required." });
    }

    const creatorExists = await Employee.findById(creator);
    if (!creatorExists) {
      return res.status(404).json({ error: "Creator (Employee) not found." });
    }

    const preparedData = technicians.map((t) => ({
      beneficiaryId: t.beneficiaryId,
      name: t.name,
      nickName: t.nickName,
      bankName: t.bankName,
      accountNumber: t.accountNumber || "",
      ifscCode: t.ifscCode || "",
      location: t.location,
      email: t.email || "",
      skills: t.skills || [],
      experience: t.experience || "",
      beneficiaryName: t.beneficiaryName || "",
      state: t.state || "",
      pincode: t.pincode || "",
      phoneNumber: t.phoneNumber || "",
      technicianCreator: creator,
    }));

    const inserted = await Technician.insertMany(preparedData);

    res.status(201).json({
      message: `${inserted.length} technicians created successfully.`,
      technicians: inserted,
    });
  } catch (error) {
    console.error("Error in bulkCreateTechnicians:", error);
    res.status(500).json({ error: "Internal server error." });
  }
};

exports.getAllActiveAssignedTicket = async (req, res) => {
  try {
    const { technicianId } = req.params;
    console.log(technicianId);
    if (!technicianId) {
      return res.status(400).json({ message: "Technician ID is required" });
    }
    if (!mongoose.Types.ObjectId.isValid(technicianId)) {
      return res.status(400).json({ message: "Invalid technician ID format" });
    }
    const tickets = await Ticket.find({
      technician: technicianId,
      isTicketClosed: false,
    })
      .populate("qstClientName")
      .populate("taskType")
      .populate("deviceType")
      .populate("assignee")
      .populate("technician") // optionally populate technician data too
      .populate("creator");

    res.status(200).json(tickets);
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// exports.getParticularActiveAssignedTicket = async (req, res) => {
//   try {
//     const { technicianId, ticketId } = req.params;
//     console.log(technicianId);

//     if (!ticketId) {
//       return res.status(400).json({ message: "Ticket ID is required" });
//     }

//     if (!technicianId) {
//       return res.status(400).json({ message: "Technician ID is required" });
//     }

//     if (!mongoose.Types.ObjectId.isValid(ticketId)) {
//       return res.status(400).json({ message: "Invalid ticket ID format" });
//     }
//     if (!mongoose.Types.ObjectId.isValid(technicianId)) {
//       return res.status(400).json({ message: "Invalid technician ID format" });
//     }
//     const tickets = await Ticket.find({
//       _id: ticketId,
//       technician: technicianId,
//       isTicketClosed: false,
//     })
//       .populate("qstClientName")
//       .populate("taskType")
//       .populate("deviceType")
//       .populate("assignee")
//       .populate("technician") // optionally populate technician data too
//       .populate("creator");

//     res.status(200).json(tickets);
//   } catch (error) {
//     console.error("Error fetching tickets:", error);
//     res.status(500).json({ message: "Internal server error" });
//   }
// };



exports.getParticularActiveAssignedTicket = async (req, res) => {
  try {
    const { technicianId, ticketId } = req.params;

    if (!ticketId) return res.status(400).json({ message: "Ticket ID is required" });
    if (!technicianId) return res.status(400).json({ message: "Technician ID is required" });

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({ message: "Invalid ticket ID format" });
    }
    if (!mongoose.Types.ObjectId.isValid(technicianId)) {
      return res.status(400).json({ message: "Invalid technician ID format" });
    }

    const ticketObjectId = new mongoose.Types.ObjectId(ticketId);
    const techObjectId = new mongoose.Types.ObjectId(technicianId);

    const tickets = await Ticket.aggregate([
      {
        $match: {
          _id: ticketObjectId,
          technician: techObjectId,
          isTicketClosed: false,
        },
      },

      // ✅ populate qstClientName
      {
        $lookup: {
          from: "qstclients",
          localField: "qstClientName",
          foreignField: "_id",
          as: "qstClientName",
        },
      },
      { $unwind: { path: "$qstClientName", preserveNullAndEmptyArrays: true } },

      // ✅ populate taskType
      {
        $lookup: {
          from: "tasks",
          localField: "taskType",
          foreignField: "_id",
          as: "taskType",
        },
      },
      { $unwind: { path: "$taskType", preserveNullAndEmptyArrays: true } },

      // ✅ populate deviceType
      {
        $lookup: {
          from: "devices",
          localField: "deviceType",
          foreignField: "_id",
          as: "deviceType",
        },
      },
      { $unwind: { path: "$deviceType", preserveNullAndEmptyArrays: true } },

      // ✅ populate assignee (Employee)
      {
        $lookup: {
          from: "employees",
          localField: "assignee",
          foreignField: "_id",
          as: "assignee",
        },
      },
      { $unwind: { path: "$assignee", preserveNullAndEmptyArrays: true } },

      // ✅ populate technician
      {
        $lookup: {
          from: "technicians",
          localField: "technician",
          foreignField: "_id",
          as: "technician",
        },
      },
      { $unwind: { path: "$technician", preserveNullAndEmptyArrays: true } },

      // ✅ populate creator
      {
        $lookup: {
          from: "employees",
          localField: "creator",
          foreignField: "_id",
          as: "creator",
        },
      },
      { $unwind: { path: "$creator", preserveNullAndEmptyArrays: true } },

      // ✅ Lookup MainData for all vehicleNumbers in this ticket
      {
        $lookup: {
          from: "maindatas",
          let: { regNos: "$vehicleNumbers.vehicleNumber" },
          pipeline: [
            { $match: { $expr: { $in: ["$registrationNumber", "$$regNos"] } } },

            // ✅ simDetails (remove statusHistory)
            {
              $lookup: {
                from: "simmasters",
                localField: "simDetails",
                foreignField: "_id",
                as: "simDetails",
                pipeline: [{ $project: { statusHistory: 0, __v: 0 } }],
              },
            },
            { $unwind: { path: "$simDetails", preserveNullAndEmptyArrays: true } },

            // ✅ deviceDetails (remove statusHistory)
            {
              $lookup: {
                from: "devicemasters",
                localField: "deviceDetails",
                foreignField: "_id",
                as: "deviceDetails",
                pipeline: [{ $project: { statusHistory: 0, __v: 0 } }],
              },
            },
            { $unwind: { path: "$deviceDetails", preserveNullAndEmptyArrays: true } },

            // ✅ accessoryDetails (remove statusHistory)
            {
              $lookup: {
                from: "accessorymasters",
                localField: "accessoryDetails",
                foreignField: "_id",
                as: "accessoryDetails",
                pipeline: [{ $project: { statusHistory: 0, __v: 0 } }],
              },
            },

            { $project: { __v: 0 } },
          ],
          as: "attachedMainData",
        },
      },

      // ✅ merge MainData into vehicleNumbers items
      {
        $addFields: {
          vehicleNumbers: {
            $map: {
              input: "$vehicleNumbers",
              as: "v",
              in: {
                $mergeObjects: [
                  "$$v",
                  {
                    mainData: {
                      $first: {
                        $filter: {
                          input: "$attachedMainData",
                          as: "m",
                          cond: { $eq: ["$$m.registrationNumber", "$$v.vehicleNumber"] },
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },

      // ✅ remove extra array
      { $project: { attachedMainData: 0 } },
    ]);

    // Keep same shape as your old API: it returned an array
    return res.status(200).json(tickets);
  } catch (error) {
    console.error("Error fetching tickets:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};



exports.exportsFiltTechnicians = async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "fromDate and toDate are required",
      });
    }

    const from = dayjs(fromDate).startOf("day").toDate();
    const to = dayjs(toDate).endOf("day").toDate();

    const technicians = await Technician.find({
      createdAt: {
        $gte: from,
        $lte: to,
      },
    })
      .populate("technicianCreator", "name")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: technicians.length,
      data: technicians,
    });
  } catch (error) {
    console.error("Error fetching filtered technicians:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

//  exports.savedImageToParticularVehicalByTechnician = async (req, res) => {
//   try {
//     const { ticketId, vehicleId, images = [], videoURL = '' } = req.body;

//     if (!ticketId || !vehicleId) {
//       return res.status(400).json({ message: 'ticketId and vehicleId are required' });
//     }

//     // ✅ Validation: at least one image and a non-empty videoURL
//     if (!Array.isArray(images) || images.length === 0) {
//       return res.status(400).json({ message: 'At least one image URL is required' });
//     }

//     if (typeof videoURL !== 'string' || videoURL.trim() === '') {
//       return res.status(400).json({ message: 'Video URL is required' });
//     }

//     // Fetch ticket
//     const ticket = await Ticket.findById(ticketId);
//     if (!ticket) {
//       return res.status(404).json({ message: 'Ticket not found' });
//     }

//     // Find vehicle entry by subdocument _id
//     const vehicleObjectId = new mongoose.Types.ObjectId(vehicleId);
//     const vehicle = ticket.vehicleNumbers.id(vehicleObjectId);

//     if (!vehicle) {
//       return res.status(404).json({ message: 'Vehicle ID not found in ticket' });
//     }

//     // Update fields
//     vehicle.images = images;
//     vehicle.videoURL = videoURL;

//     await ticket.save();

//     return res.status(200).json({
//       message: 'Media updated successfully',
//       vehicle
//     });

//   } catch (error) {
//     console.error('Error updating vehicle media:', error);
//     return res.status(500).json({ message: 'Server error', error: error.message });
//   }
// };

exports.savedImageToParticularVehicalByTechnician = async (req, res) => {
  try {
    const {
      ticketId,
      // For existing vehicles
      vehicleId,
      // For new vehicles
      vehicleNumber,
      // For reinstallation cases (only when creating new vehicle)
      oldVehicleNumber,
      isReinstallation = false,
      // Media
      images = [],
      video: videoURL = "",
      isRegistered,
    } = req.body;

    // Validate required fields
    if (!ticketId) {
      return res.status(400).json({ message: "ticketId is required" });
    }

    // Find the ticket
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (ticket.isTicketClosed) {
      return res.status(404).json({ message: "Your assigned ticket is closed." });
    }


    // Handle based on registration status
    if (isRegistered) {
      // Existing vehicle - media upload only (no reinstallation handling)
      return handleExistingVehicleMediaUpload({
        ticket,
        vehicleId,
        images,
        videoURL,
        res,
      });
    } else {
      // New vehicle - could be regular or reinstallation
      return handleNewVehicleCreation({
        ticket,
        vehicleNumber,
        oldVehicleNumber,
        images,
        videoURL,
        isReinstallation,
        res,
      });
    }
  } catch (error) {
    console.error("Error saving vehicle media:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};

// Handler for existing vehicle media upload
async function handleExistingVehicleMediaUpload({
  ticket,
  vehicleId,
  images,
  videoURL,
  res,
}) {
  // Validate required fields for existing vehicle
  if (!vehicleId) {
    return res
      .status(400)
      .json({ message: "vehicleId is required for existing vehicles" });
  }

  console.log(videoURL, "videoURL");
  // console.log(res,"res")
  console.log(images, "images");
  // Find the vehicle subdocument
  const vehicleObjectId = new mongoose.Types.ObjectId(vehicleId);
  const vehicle = ticket.vehicleNumbers.id(vehicleObjectId);

  if (!vehicle) {
    return res.status(404).json({ message: "Vehicle not found in ticket" });
  }

  // Update media (replace existing media with new upload)
  vehicle.images = images;
  vehicle.videoURL = videoURL;

  await ticket.save();

  return res.status(200).json({
    message: "Vehicle media updated successfully",
    vehicle: vehicle.toObject(),
    ticketId: ticket._id,
  });
}

// Handler for new vehicle creation
async function handleNewVehicleCreation({
  ticket,
  vehicleNumber,
  oldVehicleNumber,
  images,
  videoURL,
  isReinstallation,
  res,
}) {
  // Validate vehicle number
  if (!vehicleNumber) {
    return res.status(400).json({ message: "Vehicle number is required" });
  }

  console.log(videoURL, "videoURL");
  // console.log(res,"res")
  console.log(images, "images");

  // For reinstallation, validate old vehicle number
  if (isReinstallation && !oldVehicleNumber) {
    return res.status(400).json({
      message: "Old vehicle number is required for reinstallation",
    });
  }

  // Check if vehicle already exists in this ticket
  const existingVehicle = ticket.vehicleNumbers.find(
    (v) => v.vehicleNumber === vehicleNumber
  );

  if (existingVehicle) {
    return res.status(400).json({
      message: "Vehicle number already exists in this ticket",
    });
  }

  // Create new vehicle entry
  const newVehicle = {
    vehicleNumber,
    images,
    videoURL,
    isResinstalationTypeNewVehicalNumber: isReinstallation,
  };

  // For reinstallation, add old vehicle number to ticket
  if (isReinstallation) {
    ticket.oldVehicleNumber = [
      ...new Set([...(ticket.oldVehicleNumber || []), oldVehicleNumber]),
    ];
  }

  // Add new vehicle to ticket
  ticket.vehicleNumbers.push(newVehicle);
  ticket.noOfVehicles = ticket.vehicleNumbers.length;

  await ticket.save();

  // Get the newly created vehicle with its generated ID
  const createdVehicle =
    ticket.vehicleNumbers[ticket.vehicleNumbers.length - 1];

  return res.status(201).json({
    message: "New vehicle added successfully",
    vehicle: createdVehicle.toObject(),
    ticketId: ticket._id,
  });
}

// -------------------------------------------------=====================================
// Create Technician api

// Update vehicle registration number
exports.updateVehicleNumber = async (req, res) => {
  try {
    const { ticketId, vehicleId } = req.params;
    const { vehicleNumber } = req.body;

    // Validate required fields
    if (!ticketId || !vehicleId) {
      return res.status(400).json({
        message: "ticketId and vehicleId are required"
      });
    }

    if (!vehicleNumber || !vehicleNumber.trim()) {
      return res.status(400).json({
        message: "Vehicle number is required"
      });
    }

    // Find the ticket
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    // Find the vehicle subdocument
    const vehicleObjectId = new mongoose.Types.ObjectId(vehicleId);
    const vehicle = ticket.vehicleNumbers.id(vehicleObjectId);

    if (!vehicle) {
      return res.status(404).json({ message: "Vehicle not found in ticket" });
    }

    // Check if the new vehicle number already exists in this ticket (excluding current vehicle)
    const duplicateVehicle = ticket.vehicleNumbers.find(
      (v) => v._id.toString() !== vehicleId && v.vehicleNumber === vehicleNumber.trim()
    );

    if (duplicateVehicle) {
      return res.status(400).json({
        message: "Vehicle number already exists in this ticket"
      });
    }

    // Update the vehicle number
    vehicle.vehicleNumber = vehicleNumber.trim();
    await ticket.save();

    return res.status(200).json({
      message: "Vehicle number updated successfully",
      vehicle: vehicle.toObject(),
    });

  } catch (error) {
    console.error("Error updating vehicle number:", error);
    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
};


// Mark / unmark a single vehicle as done by the technician
exports.markVehicleAsDone = async (req, res) => {
  try {
    const { ticketId, vehicleId, isDone } = req.body;

    if (!ticketId || !vehicleId) {
      return res.status(400).json({ message: 'ticketId and vehicleId are required' });
    }

    if (typeof isDone !== 'boolean') {
      return res.status(400).json({ message: 'isDone must be a boolean' });
    }

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const vehicleObjectId = new mongoose.Types.ObjectId(vehicleId);
    const vehicle = ticket.vehicleNumbers.id(vehicleObjectId);

    if (!vehicle) {
      return res.status(404).json({ message: 'Vehicle not found in ticket' });
    }

    vehicle.isDone = isDone;
    await ticket.save();

    return res.status(200).json({
      message: isDone ? 'Vehicle marked as done' : 'Vehicle unmarked',
      vehicle: vehicle.toObject(),
    });
  } catch (error) {
    console.error('Error marking vehicle as done:', error);
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};


exports.createTechnician = async (req, res) => {

  try {
    const {
      beneficiaryId,
      name,
      nickName,
      bankName,
      employeeId,
      location,
      accountNumber,
      ifscCode,
      state,
      pincode,
      beneficiaryName,
      phoneNumber,
      skills,
      experience,
      email,
    } = req.body;

    // Validate required fields
    const requiredFields = [
      "beneficiaryId",
      "name",
      "nickName",
      "location",
      "accountNumber",
      "ifscCode",
      "beneficiaryName",
      "phoneNumber",
      "bankName",
      "skills",
    ];

    const missingFields = requiredFields.filter((field) => !req.body[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    // Check for existing technician (excluding phone number from duplicate check)
    const existingConditions = [{ beneficiaryId }, { accountNumber }];

    // Add email to uniqueness check if provided
    if (email) {
      existingConditions.push({ email });
    }

    const existingTechnician = await Technician.findOne({
      $or: existingConditions,
    });

    if (existingTechnician) {
      const conflictFields = [];
      if (existingTechnician.beneficiaryId === beneficiaryId)
        conflictFields.push("beneficiaryId");
      if (existingTechnician.accountNumber === accountNumber)
        conflictFields.push("accountNumber");
      if (email && existingTechnician.email === email)
        conflictFields.push("email");

      return res.status(409).json({
        success: false,
        error: `Technician with this ${conflictFields.join(
          ", "
        )} already exists`,
        conflictFields,
      });
    }

    // Validate skills array
    if (!Array.isArray(skills)) {
      return res.status(400).json({
        success: false,
        error: "Skills must be an array",
      });
    }

    if (skills.length === 0) {
      return res.status(400).json({
        success: false,
        error: "At least one skill must be selected",
      });
    }

    // Validate IFSC code
    const cleanedIfsc = ifscCode.replace(/\s+/g, "").toUpperCase();
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(cleanedIfsc)) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid IFSC format. Must be 4 letters + 0 + 6 alphanumeric (e.g. SBIN001151)",
      });
    }

    // Validate phone number (format only, duplicates allowed)
    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        error: "Phone number must be 10 digits",
      });
    }

    // Validate pincode
    if (pincode && !/^\d{6}$/.test(pincode)) {
      return res.status(400).json({
        success: false,
        error: "Pincode must be exactly 6 digits",
      });
    }

    // Validate account number
    if (!/^\d{9,18}$/.test(accountNumber)) {
      return res.status(400).json({
        success: false,
        error: "Account number must be between 9-18 digits",
      });
    }

    // Validate email (must be unique if provided)
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        error: "Please provide a valid email address",
      });
    }

    const newTechnician = new Technician({
      beneficiaryId,
      name,
      nickName,
      email, // Will be stored if provided
      bankName,
      technicianCreator: employeeId,
      location,
      accountNumber,
      ifscCode: cleanedIfsc,
      state,
      pincode,
      beneficiaryName,
      phoneNumber, // Duplicates allowed
      skills,
      experience: experience || null,
    });

    await newTechnician.save();

    res.status(201).json({
      success: true,
      message: "Technician created successfully",
      data: newTechnician,
    });
  } catch (error) {
    console.error("Error creating technician:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      details: error.message,
    });
  }
};

exports.updateTechnician = async (req, res) => {
  try {
    const { technicianId } = req.params;
    const {
      name,
      nickName,
      email,
      location,
      state,
      pincode,
      accountNumber,
      ifscCode,
      beneficiaryName,
      beneficiaryId,
      phoneNumber,
      bankName,
      skills,
      salary,
      technicianCategoryType,
      experience,
    } = req.body;

    // Validate ID
    if (!mongoose.Types.ObjectId.isValid(technicianId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid technician ID",
      });
    }

    // Find technician
    const technician = await Technician.findById(technicianId);
    if (!technician) {
      return res.status(404).json({
        success: false,
        error: "Technician not found",
      });
    }

    // Validate field formats
    if (phoneNumber && !/^\d{10}$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        error: "Phone number must be 10 digits",
      });
    }

    if (pincode && !/^\d{6}$/.test(pincode)) {
      return res.status(400).json({
        success: false,
        error: "Pincode must be exactly 6 digits",
      });
    }

    if (accountNumber && !/^\d{9,18}$/.test(accountNumber)) {
      return res.status(400).json({
        success: false,
        error: "Account number must be between 9-18 digits",
      });
    }

    // Validate IFSC code if provided
    if (ifscCode) {
      const cleanedIfsc = ifscCode.replace(/\s+/g, "").toUpperCase();
      const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
      if (!ifscRegex.test(cleanedIfsc)) {
        return res.status(400).json({
          success: false,
          error:
            "Invalid IFSC format. Must be 4 letters + 0 + 6 alphanumeric (e.g. SBIN001151)",
        });
      }
      technician.ifscCode = cleanedIfsc;
    }

    // Validate email if provided
    if (email !== undefined) {
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
          success: false,
          error: "Please provide a valid email address",
        });
      }

      // Check for email uniqueness (excluding current technician)
      if (email) {
        const existingWithEmail = await Technician.findOne({
          _id: { $ne: technicianId },
          email: email,
        });

        if (existingWithEmail) {
          return res.status(409).json({
            success: false,
            error: "Email already exists for another technician",
          });
        }
      }
      technician.email = email;
    }

    // Check for account number conflicts (excluding current technician)
    if (accountNumber) {
      const existingWithAccount = await Technician.findOne({
        _id: { $ne: technicianId },
        accountNumber: accountNumber,
      });

      if (existingWithAccount) {
        return res.status(409).json({
          success: false,
          error: "Account number already exists for another technician",
        });
      }
    }

    // 🔎 Check for nickName conflicts (excluding current technician, case-insensitive)
    if (nickName) {
      const existingWithNick = await Technician.findOne({
        _id: { $ne: technicianId },
        nickName: { $regex: new RegExp(`^${nickName.trim()}$`, "i") },
      });

      if (existingWithNick) {
        return res.status(409).json({
          success: false,
          error: "Nickname already exists for another technician",
          existingTechnician: {
            id: existingWithNick._id,
            name: existingWithNick.name,
            nickName: existingWithNick.nickName,
            phoneNumber: existingWithNick.phoneNumber,
          },
        });
      }
    }

    // Update fields
    const fieldsToUpdate = {
      name,
      nickName,
      location,
      state,
      pincode,
      accountNumber,
      beneficiaryName,
      beneficiaryId,
      phoneNumber, // Phone number can be same (no duplicate check)
      bankName,
      experience,
      salary,
      technicianCategoryType,
    };

    Object.keys(fieldsToUpdate).forEach((field) => {
      if (fieldsToUpdate[field] !== undefined) {
        technician[field] =
          typeof fieldsToUpdate[field] === "string"
            ? fieldsToUpdate[field].trim()
            : fieldsToUpdate[field];
      }
    });

    // Handle skills (ensure array format)
    if (skills !== undefined) {
      technician.skills = Array.isArray(skills)
        ? skills.filter((skill) => skill.trim())
        : typeof skills === "string"
          ? skills
            .split(",")
            .map((skill) => skill.trim())
            .filter((skill) => skill)
          : [];

      // Validate at least one skill if skills field was provided
      if (technician.skills.length === 0) {
        return res.status(400).json({
          success: false,
          error: "At least one skill must be selected",
        });
      }
    }

    const updatedTechnician = await technician.save();

    return res.json({
      success: true,
      message: "Technician updated successfully",
      data: updatedTechnician,
    });
  } catch (error) {
    console.error("Update error:", error);
    return res.status(500).json({
      success: false,
      error: "Server error during update",
      details: error.message,
    });
  }
};

exports.deleteTechnician = async (req, res) => {
  try {
    const technicianId = req.params.id;

    // Check if technician exists
    const technician = await Technician.findById(technicianId);
    if (!technician) {
      return res.status(404).json({ error: "Technician not found" });
    }
    const dependentTickets = await Ticket.findOne({
      technician: technicianId,
      isTicketClosed: false
    });

    if (dependentTickets) {
      return res.status(400).json({
        success: false,
        message: "Technician is assigned to active open tickets",
      });
    }
    // Delete the technician
    await Technician.findByIdAndDelete(technicianId);

    res.status(200).json({
      success: true,
      message: "Technician deleted successfully",
      technicianId: technicianId,
    });
  } catch (error) {
    console.error("Error deleting technician:", error);
    res.status(500).json({
      success: false,
      error: "Server error while deleting technician"
    });
  }
};

exports.addSingleTechnician = async (req, res) => {
  try {
    // Extract data from request body
    const {
      beneficiaryId,
      name,
      nickName,
      email, // Added email
      location,
      phoneNumber,
      bankName,
      accountNumber,
      ifscCode,
      state,
      pincode,
      beneficiaryName,
      skills, // Will handle skills properly
      experience,
      employeeId,
      salary,
      technicianCategoryType,
    } = req.body;

    // Validate required fields
    const requiredFields = {
      // beneficiaryId: "Beneficiary ID",
      name: "Name",
      nickName: "Nickname",
      // location: "Location",
      // bankName: "Bank Name",
      // accountNumber: "Account Number",
      // ifscCode: "IFSC Code",
      // beneficiaryName: "Beneficiary Name",
      // phoneNumber: "Phone Number",
      technicianCategoryType: "Technician type"
    };

    const missingFields = [];
    for (const [field, fieldName] of Object.entries(requiredFields)) {
      if (!req.body[field] || req.body[field].trim() === "") {
        missingFields.push(fieldName);
      }
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    // Email validation (if provided)
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid email address",
        });
      }

      const existingEmail = await Technician.findOne({
        email: { $regex: new RegExp(`^${email.trim()}$`, "i") }, // case-insensitive
      });

      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: "Email already exists. Please use another email",
          existingTechnician: {
            name: existingEmail.name,
            phoneNumber: existingEmail.phoneNumber,
            email: existingEmail.email,
          },
        });
      }
    }

    // Phone validation
    if (!/^\d{10}$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be 10 digits",
      });
    }

    // Pincode validation (if provided)
    if (pincode && !/^\d{6}$/.test(pincode)) {
      return res.status(400).json({
        success: false,
        message: "Pincode must be 6 digits",
      });
    }

    // Account number validation
    if (!/^\d{9,18}$/.test(accountNumber)) {
      return res.status(400).json({
        success: false,
        message: "Account number must be 9-18 digits",
      });
    }

    // IFSC Code validation
    if (ifscCode) {
      const cleanedIFSC = ifscCode.replace(/\s/g, "").toUpperCase();
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanedIFSC)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid IFSC code format. Format: 4 letters + 0 + 6 alphanumeric",
        });
      }
      // Use cleaned value
      req.body.ifscCode = cleanedIFSC;
    }

    // Check if account number already exists
    const existingTechnician = await Technician.findOne({ accountNumber });
    if (existingTechnician) {
      return res.status(400).json({
        success: false,
        message: "Account number already exists",
        existingTechnician: {
          name: existingTechnician.name,
          phoneNumber: existingTechnician.phoneNumber,
        },
      });
    }


    // 🔎 Check if nickname already exists (case-insensitive, trimmed)
    if (nickName) {
      const existingNick = await Technician.findOne({
        nickName: { $regex: new RegExp(`^${nickName.trim()}$`, "i") },
      });

      if (existingNick) {
        return res.status(400).json({
          success: false,
          message: "Nickname already exists. Please choose another one",
          existingTechnician: {
            name: existingNick.name,
            phoneNumber: existingNick.phoneNumber,
            nickName: existingNick.nickName,
          },
        });
      }
    }

    // Skills handling - ensure it's always an array
    let skillsArray = [];
    if (skills) {
      skillsArray = Array.isArray(skills)
        ? skills.filter((skill) => skill) // Remove empty values if array
        : [skills]; // Convert single value to array
    }

    // Experience validation (if provided)
    if (
      experience &&
      (isNaN(experience) || experience < 0 || experience > 50)
    ) {
      return res.status(400).json({
        success: false,
        message: "Experience must be between 0-50 years",
      });
    }

    // Create new technician
    const newTechnician = new Technician({
      beneficiaryId,
      name: name?.trim(),
      nickName: nickName?.trim(),
      email: email?.trim(),
      location: location?.trim(),
      phoneNumber,
      bankName,
      accountNumber,
      ifscCode,
      state,
      pincode,
      beneficiaryName: beneficiaryName?.trim(),
      skills: skillsArray, // Properly formatted skills array
      experience,
      salary,
      technicianCategoryType,
      technicianCreator: req.user?._id || employeeId,
    });

    // Save to database
    const savedTechnician = await newTechnician.save();

    return res.status(201).json({
      success: true,
      message: "Technician added successfully",
      data: savedTechnician,
    });
  } catch (error) {
    console.error("Error adding technician:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.addTechnicianDuringTicketCreation = async (req, res) => {
  try {
    // Extract data from request body
    const {
      beneficiaryId,
      name,
      nickName,
      email, // Added email
      location,
      phoneNumber,
      bankName,
      accountNumber,
      ifscCode,
      state,
      pincode,
      beneficiaryName,
      skills, // Will handle skills properly
      experience,
      employeeId,
      technicianCategoryType
    } = req.body;

    // Validate required fields
    const requiredFields = {
      // beneficiaryId: 'Beneficiary ID',
      name: "Name",
      nickName: "Nickname",
      email: "Email",
      // phoneNumber: "Phone Number",
      technicianCategoryType: "Technician Type"
      // location: "Location",
      // bankName: "Bank Name",
      // accountNumber: "Account Number",
      // ifscCode: "IFSC Code",
      // // beneficiaryName: 'Beneficiary Name',
      // phoneNumber: "Phone Number",
    };

    const missingFields = [];
    for (const [field, fieldName] of Object.entries(requiredFields)) {
      if (!req.body[field] || req.body[field].trim() === "") {
        missingFields.push(fieldName);
      }
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    // Email validation (if provided)
    if (email) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid email address",
        });
      }

      const existingEmail = await Technician.findOne({
        email: { $regex: new RegExp(`^${email.trim()}$`, "i") }, // case-insensitive match
      });

      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: "Email already exists. Please use another email",
          existingTechnician: {
            name: existingEmail.name,
            phoneNumber: existingEmail.phoneNumber,
            email: existingEmail.email,
          },
        });
      }
    }


    // Phone validation
    if (phoneNumber && !/^\d{10}$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be 10 digits",
      });
    }

    // Pincode validation (if provided)
    if (pincode && !/^\d{6}$/.test(pincode)) {
      return res.status(400).json({
        success: false,
        message: "Pincode must be 6 digits",
      });
    }

    // Account number validation
    if (accountNumber && !/^\d{9,18}$/.test(accountNumber)) {
      return res.status(400).json({
        success: false,
        message: "Account number must be 9-18 digits",
      });
    }

    // IFSC Code validation
    if (ifscCode) {
      const cleanedIFSC = ifscCode.replace(/\s/g, "").toUpperCase();
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanedIFSC)) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid IFSC code format. Format: 4 letters + 0 + 6 alphanumeric",
        });
      }
      // Use cleaned value
      req.body.ifscCode = cleanedIFSC;
    }

    // Check if account number already exists
    if (accountNumber) {
      const existingTechnician = await Technician.findOne({ accountNumber });
      if (existingTechnician) {
        return res.status(400).json({
          success: false,
          message: "Account number already exists",
          existingTechnician: {
            name: existingTechnician.name,
            phoneNumber: existingTechnician.phoneNumber,
          },
        });
      }
    }

    console.log(nickName, "nickName------------------------------------------------====");

    // Check if nickname already exists (case-insensitive)
    if (nickName) {
      const existingNick = await Technician.findOne({
        nickName: { $regex: new RegExp(`^${nickName.trim()}$`, "i") }, // case-insensitive exact match
      });

      console.log(existingNick, "existingNick");

      if (existingNick) {
        return res.status(400).json({
          success: false,
          message: "Nickname already exists. Please choose another one",
          existingTechnician: {
            name: existingNick.name,
            phoneNumber: existingNick.phoneNumber,
            nickName: existingNick.nickName,
          },
        });
      }
    }

    // Skills handling - ensure it's always an array
    let skillsArray = [];
    if (skills) {
      skillsArray = Array.isArray(skills)
        ? skills.filter((skill) => skill) // Remove empty values if array
        : [skills]; // Convert single value to array
    }

    // Experience validation (if provided)
    if (
      experience &&
      (isNaN(experience) || experience < 0 || experience > 50)
    ) {
      return res.status(400).json({
        success: false,
        message: "Experience must be between 0-50 years",
      });
    }

    // Create new technician
    const newTechnician = new Technician({
      beneficiaryId,
      name: name?.trim(),
      nickName: nickName?.trim(),
      email: email?.trim(),
      location: location?.trim(),
      phoneNumber,
      bankName,
      accountNumber,
      ifscCode,
      state,
      pincode,
      beneficiaryName: beneficiaryName?.trim(),
      skills: skillsArray, // Properly formatted skills array
      experience,
      technicianCreator: req.user?._id || employeeId,
      technicianCategoryType,
    });

    // Save to database
    const savedTechnician = await newTechnician.save();

    return res.status(201).json({
      success: true,
      message: "Technician added successfully",
      data: savedTechnician,
    });
  } catch (error) {
    console.error("Error adding technician:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// exports.updateTechnicianAccountDetails = async (req, res) => {
//   try {
//     const { technicianId } = req.params;

//     // Validate technicianId
//     if (!mongoose.Types.ObjectId.isValid(technicianId)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid technician ID format",
//       });
//     }

//     const { accountHolder, accountNumber, ifscCode } = req.body;

//     // Basic validation
//     if ( !accountNumber || !ifscCode) {
//       return res.status(400).json({
//         success: false,
//         message: "Account number, and IFSC code are required",
//       });
//     }

//   // console.log(req.body,"90909090909")

//     const updatedTechnician = await Technician.findByIdAndUpdate(
//       technicianId,
//       {
//         beneficiaryName:accountHolder,
//         accountNumber,
//         ifscCode,
//       },
//       { new: true, runValidators: true }
//     );

//     if (!updatedTechnician) {
//       return res.status(404).json({
//         success: false,
//         message: "Technician not found",
//       });
//     }

//     res.status(200).json({
//       success: true,
//       message: "Technician account details updated successfully",
//       data: updatedTechnician,
//     });
//   } catch (error) {
//     console.error("Error updating technician:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// };

exports.updateTechnicianAccountDetails = async (req, res) => {
  try {
    const { technicianId } = req.params;

    // Validate technicianId
    if (!mongoose.Types.ObjectId.isValid(technicianId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid technician ID format",
      });
    }

    const { accountNumber, ifscCode, nickName } = req.body;
    // accountHolder,
    // Basic validation
    if (!accountNumber || !ifscCode) {
      return res.status(400).json({
        success: false,
        message: "Account number, and IFSC code are required",
      });
    }

    // Account number validation
    if (!/^\d{9,18}$/.test(accountNumber)) {
      return res.status(400).json({
        success: false,
        message: "Account number must be 9-18 digits",
      });
    }

    // IFSC Code validation
    const cleanedIFSC = ifscCode.replace(/\s/g, "").toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanedIFSC)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid IFSC code format. Format: 4 letters + 0 + 6 alphanumeric",
      });
    }

    // Check if account number exists for other technicians
    const existingTechnician = await Technician.findOne({
      accountNumber,
      _id: { $ne: technicianId }, // Exclude the current technician from the check
    });

    if (existingTechnician) {
      return res.status(400).json({
        success: false,
        message: "Account number already exists for another technician",
        existingTechnician: {
          name: existingTechnician.name,
          phoneNumber: existingTechnician.phoneNumber,
        },
      });
    }

    const updatedTechnician = await Technician.findByIdAndUpdate(
      technicianId,
      {
        // beneficiaryName: accountHolder,
        nickName,
        accountNumber,
        ifscCode: cleanedIFSC, // Use the cleaned IFSC code
      },
      { new: true, runValidators: true }
    );

    if (!updatedTechnician) {
      return res.status(404).json({
        success: false,
        message: "Technician not found",
      });
    }
    console.log("update tech", updatedTechnician);

    res.status(200).json({
      success: true,
      message: "Technician account details updated successfully",
      data: updatedTechnician,
    });
  } catch (error) {
    console.error("Error updating technician:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


exports.VerifySecurityCodeOfTechnicianInFileUpload = async (req, res) => {
  try {
    const { technicianSecurityCode: code, technicianId, ticketId } = req.body;

    console.log(code, technicianId, ticketId, "Incoming payload for verification");

    const securityCode1 = await securityCodeModel.findOne({})
    console.log(securityCode1, "securityCode1===================");

    // Validate input

    const securityCode = await securityCodeModel.findOne({
      securityCode: code,
      technicianId,
      ticketId,
      expiresAt: { $gt: new Date() },
      // isUsed: false
    });

    console.log(securityCode, "securityCode123")

    if (!securityCode) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired security code'
      });
    }

    // Mark code as used (optional - depends on your requirements)
    securityCode.isUsed = true;
    await securityCode.save();

    res.json({
      success: true,
      message: 'Code verified successfully',
      ticket: securityCode.ticketId
    });

  } catch (error) {
    console.error('Error verifying security code:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
}



exports.getTechDeviceSimAccessories = async (req, res) => {
  try {
    const { technicianId } = req.params;
    console.log("Technician id : ", technicianId);

    // Validate technicianId
    if (!mongoose.Types.ObjectId.isValid(technicianId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid technician ID format",
      });
    }

    // Verify technician exists
    const technician = await Technician.findById(technicianId);
    if (!technician) {
      return res.status(404).json({
        success: false,
        message: "Technician not found",
      });
    }

    // Use Promise.all to fetch devices, sims, and accessories in parallel
    const [devices, sims, accessories] = await Promise.all([
      DeviceMaster.find({
        status: "with technician",
        assignedTo: technicianId
      }).lean().select('-statusHistory'),

      SimMaster.find({
        status: "with technician",
        assignedTo: technicianId
      }).lean().select('-statusHistory'),

      AccessoryMaster.find({
        status: "with technician",
        assignedTo: technicianId
      }).lean().select('-statusHistory')
    ]);

    return res.status(200).json({
      success: true,
      message: "Technician inventory retrieved successfully",
      data: {
        technician: {
          id: technician._id,
          name: technician.name,
          nickName: technician.nickName,
        },
        inventory: {
          devices: devices,
          sims: sims,
          accessories: accessories,
        },
        counts: {
          totalDevices: devices.length,
          totalSims: sims.length,
          totalAccessories: accessories.length,
          totalItems: devices.length + sims.length + accessories.length,
        }
      },
    });

  } catch (error) {
    console.error("Error fetching technician device sim accessories:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
}

// Get technician's spare inventory (items with status "with technician")
exports.getTechnicianSpareInventory = async (req, res) => {
  try {
    const { id } = req.params;

    // Query each master collection for items with status "with technician" assigned to this technician
    const [devices, sims, accessories] = await Promise.all([
      DeviceMaster.find({
        status: 'with technician',
        assignedTo: id,
        assignedToModel: 'Technician',
        isDefective: { $ne: true } // Exclude already defective items
      }).lean(),

      SimMaster.find({
        status: 'with technician',
        assignedTo: id,
        assignedToModel: 'Technician',
        isDefective: { $ne: true }
      }).lean(),

      AccessoryMaster.find({
        status: 'with technician',
        assignedTo: id,
        assignedToModel: 'Technician',
        isDefective: { $ne: true }
      }).lean()
    ]);

    return res.status(200).json({
      success: true,
      message: 'Spare inventory retrieved successfully',
      data: {
        devices,
        sims,
        accessories,
        summary: {
          totalDevices: devices.length,
          totalSims: sims.length,
          totalAccessories: accessories.length,
          totalSpares: devices.length + sims.length + accessories.length
        }
      }
    });
  } catch (error) {
    console.error('Error fetching technician spare inventory:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching spare inventory',
      error: error.message
    });
  }
};

// Add accessories to a vehicle's MainData
exports.addAccessoriesToVehicle = async (req, res) => {
  try {
    const { vehicleNumber, accessoryIds, ticketId, technicianId } = req.body;

    if (!vehicleNumber || !Array.isArray(accessoryIds) || accessoryIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "vehicleNumber and at least one accessoryId are required",
      });
    }

    if (!ticketId) {
      return res.status(400).json({
        success: false,
        message: "ticketId is required",
      });
    }

    // Validate all IDs are valid ObjectIds
    const validIds = accessoryIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
    if (validIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid accessory IDs provided",
      });
    }

    // Fetch ticket to get customer info
    const ticket = await Ticket.findById(ticketId).populate("qstClientName", "companyName");
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Find MainData for this vehicle
    const mainData = await MainData.findOne({ registrationNumber: vehicleNumber });

    console.log("main data for accessories addition : ", mainData);
    if (!mainData) {
      return res.status(404).json({
        success: false,
        message: `No MainData found for vehicle number: ${vehicleNumber}`,
      });
    }

    // Get customer assignment info from ticket
    const customerId = ticket.qstClientName?._id || ticket.qstClientName;
    const customerName = ticket.qstClientName?.companyName || "";

    // Update each accessory: status → 'sold to customer', assign to customer
    const accessoryObjectIds = validIds.map((id) => new mongoose.Types.ObjectId(id));

    await AccessoryMaster.updateMany(
      { _id: { $in: accessoryObjectIds } },
      {
        $set: {
          status: "sold to customer",
          assignedTo: customerId,
          assignedToModel: "QstClient",
          customerName: customerName,
        },
        $push: {
          statusHistory: {
            status: "sold to customer",
            changedAt: new Date(),
            changedBy: `Technician ${technicianId || "unknown"} - Installed on ${vehicleNumber}`,
          },
        },
      }
    );

    // Push accessory IDs into MainData.accessoryDetails (avoid duplicates)
    // Note: $addToSet won't add an ID that already exists in the array
    const existingIds = mainData.accessoryDetails.map((id) => id.toString());
    const newIds = accessoryObjectIds.filter((id) => !existingIds.includes(id.toString()));

    console.log("Existing accessoryDetails IDs:", existingIds);
    console.log("Requested accessoryIds:", accessoryObjectIds.map(id => id.toString()));
    console.log("New IDs to add (not already present):", newIds.map(id => id.toString()));

    if (newIds.length === 0) {
      // All requested accessories are already in the vehicle — still return current state
      const current = await MainData.findById(mainData._id).populate("accessoryDetails", "-statusHistory -__v");
      return res.status(200).json({
        success: true,
        message: "All selected accessories were already linked to this vehicle",
        data: current,
      });
    }

    await MainData.findByIdAndUpdate(
      mainData._id,
      { $push: { accessoryDetails: { $each: newIds } } },
      { new: true }
    );

    // Fetch fresh populated document (chaining .populate() on findByIdAndUpdate is unreliable)
    const updated = await MainData.findById(mainData._id).populate("accessoryDetails", "-statusHistory -__v");

    console.log(`Added ${newIds.length} new accessories to vehicle ${vehicleNumber}, total now: ${updated.accessoryDetails?.length}`);

    return res.status(200).json({
      success: true,
      message: "Accessories added successfully",
      data: updated,
    });
  } catch (error) {
    console.error("Error adding accessories to vehicle:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


// ── Wiring Verification: Proxy AlgoTrack API call ──────────────────────────────
// This proxies the external AlgoTrack lastdata APIs on behalf of the technician
// to avoid CORS issues from the frontend.
exports.proxyWiringCheck = async (req, res) => {
  try {
    const { checkType, unitNumber, serverName, DeviceType } = req.body;

    // Validate checkType
    const validCheckTypes = {
      ignition: "get-last-ignition",
      mainPowerSupply: "get-last-mainpowersupply",
      latLong: "get-last-latlong",
      pcsGps: "get-last-pcsgps",
    };

    if (!validCheckTypes[checkType]) {
      return res.status(400).json({
        success: false,
        message: `Invalid checkType. Must be one of: ${Object.keys(validCheckTypes).join(", ")}`,
      });
    }

    if (!unitNumber) {
      return res.status(400).json({
        success: false,
        message: "unitNumber is required",
      });
    }

    const endpoint = validCheckTypes[checkType];
    const apiUrl = `https://algotrack.in/AlgoCRMAPI/api/lastdata/${endpoint}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unitNumber,
        serverName: serverName || "Algotrack",
        DeviceType: DeviceType || "",
      }),
    });

    const data = await response.json();

    return res.status(response.ok ? 200 : 502).json({
      success: response.ok,
      message: response.ok
        ? `${checkType} check completed`
        : `${checkType} check failed from AlgoTrack`,
      data,
    });
  } catch (error) {
    console.error("proxyWiringCheck error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to proxy wiring check API",
      error: error.message,
    });
  }
};


// ── Wiring Verification: Save result to ticket ─────────────────────────────────
// Saves the API response for a specific check type to the ticket's
// vehicleNumbers[].wiringVerification field.
exports.saveWiringVerification = async (req, res) => {
  try {
    const { ticketId, vehicleId, checkType, response: apiResponse, status } = req.body;

    // Validate inputs
    if (!ticketId || !vehicleId || !checkType) {
      return res.status(400).json({
        success: false,
        message: "ticketId, vehicleId, and checkType are required",
      });
    }

    const validCheckTypes = ["ignition", "mainPowerSupply", "latLong", "pcsGps"];
    if (!validCheckTypes.includes(checkType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid checkType. Must be one of: ${validCheckTypes.join(", ")}`,
      });
    }

    const validStatuses = ["pending", "success", "failed"];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // Build the update path dynamically
    const updatePath = `vehicleNumbers.$.wiringVerification.${checkType}`;

    const ticket = await Ticket.findOneAndUpdate(
      {
        _id: ticketId,
        "vehicleNumbers._id": vehicleId,
      },
      {
        $set: {
          [`${updatePath}.status`]: status || "success",
          [`${updatePath}.response`]: apiResponse || null,
          [`${updatePath}.verifiedAt`]: new Date(),
        },
      },
      { new: true }
    );

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket or vehicle not found",
      });
    }

    // Find the updated vehicle to return its verification state
    const updatedVehicle = ticket.vehicleNumbers.find(
      (v) => v._id.toString() === vehicleId
    );

    return res.status(200).json({
      success: true,
      message: `${checkType} verification saved successfully`,
      wiringVerification: updatedVehicle?.wiringVerification || null,
    });
  } catch (error) {
    console.error("saveWiringVerification error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save wiring verification",
      error: error.message,
    });
  }
};
