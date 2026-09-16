const QstClient = require("../models/qstClient.model");
const Zone = require("../models/zone.model");
const Employee = require("../models/employee.model");
const Project = require("../models/project.model");
const mongoose = require("mongoose");
const Ticket = require("../models/ticket.model");
const bcrypt = require("bcrypt");
const sendEmail = require("../utils/SendEmail");
const MainDataModel = require("../models/mainData.model");
const dayjs = require("dayjs");
// const sendEmail = require('../../utils/sendEmail');
const welcomeTemplateOfQSTClientsTemplate = require("../emailTemplates/QstClientEmployee");
const customerChargeRateListModel = require("../models/customerChargeRateList.model");
// Controller to add new QST client
exports.addQstClient = async (req, res) => {
  try {
    const newQstClient = new QstClient({
      clientName: req.body.clientName,
      email: req.body.email,
      phone: req.body.phone,
      address: req.body.address,
      status: req.body.status || "active",
    });

    const savedClient = await newQstClient.save();
    res.status(201).json({
      success: true,
      message: "QST client added successfully",
      data: savedClient,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error adding QST client",
      error: error.message,
    });
  }
};

// exports.createSingleQSTClient = async (req,res)=> {

//   // here we use transaction for creating client and user if nay fail then whole process revert
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const { companyName, companyShortName, gstNo, billingAddress, contacts, projectName } = req.body;

//     // Validate required fields
//     if (!companyShortName || !contacts || contacts.length === 0) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(400).json({
//         success: false,
//         message: 'Company short name and at least one contact are required'
//       });
//     }

//     // Validate contact fields
//     for (const contact of contacts) {
//       if (!contact.contactPerson || !contact.email || !contact.mobileNo) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(400).json({
//           success: false,
//           message: 'Each contact must have contactPerson, email, and mobileNo'
//         });
//       }
//     }

//     // Create client
//     const newClient = new QstClient({
//       companyName,
//       companyShortName,
//       gstNo,
//       billingAddress,
//       ContactDetails: contacts,
//       qstClientCreator: req?.user?._id || req.body.employeeId
//     });

//     const savedClient = await newClient.save({ session });

//     // Create project if projectName exists
//     let savedProject = null;
//     if (projectName) {
//       const newProject = new Project({
//         qstClient: savedClient._id,
//         projectName,
//         description: req.body.description || '',
//         startDate: req.body.startDate || null,
//         endDate: req.body.endDate || null
//       });

//       savedProject = await newProject.save({ session });

//       // Removed the redundant projects array update in QstClient
//     }

//     await session.commitTransaction();
//     session.endSession();

//     const response = {
//       success: true,
//       message: projectName ? 'Client and project created successfully' : 'Client created successfully',
//       client: {
//         _id: savedClient._id,
//         companyName: savedClient.companyName,
//         companyShortName: savedClient.companyShortName,
//         gstNo: savedClient.gstNo,
//         billingAddress: savedClient.billingAddress,
//         ContactDetails: savedClient.ContactDetails
//       }
//     };

//     if (savedProject) {
//       response.project = {
//         _id: savedProject._id,
//         projectName: savedProject.projectName,
//         description: savedProject.description,
//         qstClient: savedProject.qstClient // Include client reference
//       };
//     }

//     res.status(201).json(response);

//   } catch (error) {
//     await session.abortTransaction();
//     session.endSession();

//     console.error('Error creating client:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Error creating client',
//       error: error.message
//     });

// }
// }

exports.createSingleQSTClient = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      companyName,
      companyShortName,
      gstNo,
      billingAddress,
      keyClient,
      contacts,
      projectName,
      description,
      startDate,
      billingCategory,
      endDate,
      cse,
      zone,
    } = req.body;

    console.log(zone);
    console.log(cse);

    if (!companyShortName || !contacts || contacts.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Company short name and at least one contact are required",
      });
    }

    if (companyShortName.trim().length < 5) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Company short name must be at least 5 characters",
      });
    }

    if (!billingCategory) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "QSTClient category is required",
      });
    }

    const emails = new Set();
    for (const contact of contacts) {
      if (!contact.contactPerson || !contact.email || !contact.mobileNo) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Each contact must have contactPerson, email, and mobileNo",
        });
      }

      if (emails.has(contact.email.toLowerCase())) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `Duplicate email ${contact.email} found in contacts`,
        });
      }
      emails.add(contact.email.toLowerCase());

      const existingEmployee = await Employee.findOne({
        email: contact.email.toLowerCase(),
      }).session(session);

      if (existingEmployee) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `Email ${contact.email} is already registered`,
        });
      }
    }

    if (cse) {
      const existingCse = await Employee.findById(cse).session(session);
      if (!existingCse) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "CSE not found",
        });
      }
    }

    if (zone) {
      const existingZone = await Zone.findById(zone).session(session);
      if (!existingZone) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Zone not found",
        });
      }
    }

    const existingClient = await QstClient.findOne({
      companyName: companyName.trim(),
    }).session(session);

    if (existingClient) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Client with company name "${companyName}" already exists`,
      });
    }

    const newClient = new QstClient({
      companyName,
      companyShortName,
      gstNo,
      billingAddress,
      billingCategory,
      keyClient,
      qstClientCreator: req?.user?._id || req.body.employeeId,
      cse,
      zone,
    });

    const savedClient = await newClient.save({ session });

    const createdEmployees = [];

    for (const contact of contacts) {
      const tempPassword = generateSimplePassword(10);
      // or hash if needed
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      const newEmployee = new Employee({
        name: contact.contactPerson,
        email: contact.email.toLowerCase(),
        phoneNumber: contact.mobileNo,
        password: hashedPassword,
        role: "qstClient",
        associatedClient: savedClient._id,
      });

      const savedEmployee = await newEmployee.save({ session });
      createdEmployees.push({
        employee: savedEmployee,
        tempPassword,
      });

      // Send welcome email
      const html = welcomeTemplateOfQSTClientsTemplate(
        savedEmployee.name,
        savedEmployee.email,
        tempPassword,
        `${(process.env.FRONTEND_URL || process.env.CLIENT_BASE_URL || "").replace(/\/api\/?$/, "")}/login`,
      );
      try {
        await sendEmail({
          to: savedEmployee.email,
          subject: `Login credentials for ${savedEmployee.name}`,
          html,
        });
      } catch (err) {
        console.error(
          `Email sending failed to ${savedEmployee.email}:`,
          err.message,
        );
      }
    }

    // Save employee references to client
    savedClient.contactEmployeeIds = createdEmployees.map(
      (item) => item.employee._id,
    );
    await savedClient.save({ session });

    // Handle project creation
    let savedProject = null;
    if (projectName) {
      const newProject = new Project({
        qstClient: savedClient._id,
        projectName,
        description: description || "",
        startDate: startDate || null,
        endDate: endDate || null,
      });

      savedProject = await newProject.save({ session });

      savedClient.projects.push(savedProject._id);
      await savedClient.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    const response = {
      success: true,
      message: projectName
        ? "Client, contacts, and project created successfully"
        : "Client and contacts created successfully",
      client: {
        _id: savedClient._id,
        companyName: savedClient.companyName,
        companyShortName: savedClient.companyShortName,
        gstNo: savedClient.gstNo,
        keyClient: savedClient.keyClient,
        billingCategory: savedClient.billingCategory,
        billingAddress: savedClient.billingAddress,
        cse: savedClient.cse,
        zone: savedClient.zone,
      },
      contacts: createdEmployees.map((item) => ({
        _id: item.employee._id,
        name: item.employee.name,
        email: item.employee.email,
        phoneNumber: item.employee.phoneNumber,
        // DO NOT include tempPassword in production
      })),
    };

    if (savedProject) {
      response.project = {
        _id: savedProject._id,
        projectName: savedProject.projectName,
        description: savedProject.description,
        qstClient: savedProject.qstClient,
      };
    }

    // ── Fire-and-forget: forward new client to secondary .NET system ──────────
    (() => {
      const dotNetUrl = 'https://www.algotrack.in/AlgoCRMAPI/api/company';
      if (!dotNetUrl) {
        console.warn("[SecondSystem] DOTNET_SYSTEM_URL not set – skipping client forward");
        return;
      }

      // Populate zone, cse, creator in background (non-blocking)
      QstClient.findById(savedClient._id)
        .populate("cse", "name")
        .populate("zone", "zone city")
        .populate("qstClientCreator", "name")
        .then((populatedClient) => {
          if (!populatedClient) return;

          const payload = {
            qstClientId: populatedClient._id,
            companyName: populatedClient.companyName || "",
            companyShortName: populatedClient.companyShortName || "",
            gstNo: populatedClient.gstNo || "",
            billingAddress: populatedClient.billingAddress || "",
            billingCategory: populatedClient.billingCategory || "",
            keyClient: populatedClient.keyClient || false,

            // Populated fields
            cseName: populatedClient.cse?.name || "",
            cseId: populatedClient.cse?._id || "",
            zone: populatedClient.zone?.zone || "",
            zoneCity: populatedClient.zone?.city || "",
            creatorId: populatedClient.qstClientCreator?._id || "",
            creatorName: populatedClient.qstClientCreator?.name || "",

            // Contacts from req.body (not saved in model)
            contacts: (contacts || []).map((c) => ({
              contactPerson: c.contactPerson || "",
              email: c.email || "",
              mobileNo: c.mobileNo || "",
            })),

            // Project if created
            projectName: projectName || "",
            createdAt: populatedClient.createdAt || null,
          };

          console.log("[SecondSystem] Client payload being sent:", JSON.stringify(payload, null, 2));

          return fetch(dotNetUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
        })
        .then((r) => { if (r) console.log(`[SecondSystem] Client forwarded – status ${r.status}`); })
        .catch((err) => console.error("[SecondSystem] Failed to forward client:", err.message));
    })();
    // ─────────────────────────────────────────────────────────────────────────

    return res.status(201).json(response);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error creating client:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating client",
      error: error.message,
    });
  }
};

// Simple 10-character password generator
function generateSimplePassword(length = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$&";
  let password = "";

  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return password;
}

// exports.updateQSTClient = async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const {
//       companyName,
//       companyShortName,
//       gstNo,
//       billingAddress,
//       contacts,
//       projectName,
//       billingCategory,
//       description,
//       startDate,
//       endDate,
//     } = req.body;
//     const { clientId } = req.params;

//     console.log(billingCategory.req.params);

//     // Validate minimum
//     if (!companyShortName || !contacts || contacts.length === 0) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(400).json({
//         success: false,
//         message: "Company short name and at least one contact are required.",
//       });
//     }

//     if (!billingCategory) {
//        await session.abortTransaction();
//       session.endSession();
//       return res.status(400).json({
//         success: false,
//         message: "QSTClient category is required",
//       });
//     }

//     const client = await QstClient.findById(clientId).session(session);
//     if (!client) {
//       await session.abortTransaction();
//       session.endSession();
//       return res
//         .status(404)
//         .json({ success: false, message: "Client not found" });
//     }
//   console.log(billingCategory);

//     // Update client fields
//     client.companyName = companyName;
//     client.companyShortName = companyShortName;
//     client.gstNo = gstNo;
//     client.billingAddress = billingAddress;
//     client.billingCategory = billingCategory;
// console.log("hh",billingCategory);

//     // Clear old employees (optional: soft-delete instead)
//     await Employee.deleteMany({ associatedClient: client._id }).session(
//       session
//     );
//     client.contactEmployeeIds = [];

//     // Create new employees
//     const createdEmployees = [];
//     for (const contact of contacts) {
//       const tempPassword = generateSimplePassword(10);

//       const newEmployee = new Employee({
//         name: contact.contactPerson,
//         email: contact.email.toLowerCase(),
//         phoneNumber: contact.mobileNo,
//         password: tempPassword, // Consider hashing it
//         role: "qstClient",
//         associatedClient: client._id,
//       });

//       const savedEmployee = await newEmployee.save({ session });
//       client.contactEmployeeIds.push(savedEmployee._id);
//       createdEmployees.push(savedEmployee);
//     }

//     // Handle project update or creation
//     let savedProject = null;
//     if (projectName) {
//       // Check if project exists or create new
//       let project = await Project.findOne({ qstClient: client._id }).session(
//         session
//       );
//       if (!project) {
//         project = new Project({
//           qstClient: client._id,
//           projectName,
//           description: description || "",
//           startDate: startDate || null,
//           endDate: endDate || null,
//         });
//       } else {
//         project.projectName = projectName;
//         project.description = description;
//         project.startDate = startDate;
//         project.endDate = endDate;
//       }
//       savedProject = await project.save({ session });
//       if (!client.projects.includes(savedProject._id)) {
//         client.projects.push(savedProject._id);
//       }
//     }

//     await client.save({ session });
//     await session.commitTransaction();
//     session.endSession();

//     res.status(200).json({
//       success: true,
//       message: "Client updated successfully",
//       clientId: client._id,
//     });
//   } catch (error) {
//     await session.abortTransaction();
//     session.endSession();
//     console.error("Error updating client:", error);
//     res.status(500).json({
//       success: false,
//       message: "Error updating client",
//       error: error.message,
//     });
//   }
// };

exports.getAlltheQstClientForShowInTable = async (req, res) => {
  try {
    const search = req.query.search || "";
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = {};

    if (search) {
      const searchConditions = [
        { companyName: { $regex: search, $options: "i" } },
        { companyShortName: { $regex: search, $options: "i" } },
        { gstNo: { $regex: search, $options: "i" } },
        { billingAddress: { $regex: search, $options: "i" } },
      ];

      // Check if the search string is a valid ObjectId
      if (mongoose.Types.ObjectId.isValid(search)) {
        searchConditions.push({ _id: search });
      }

      filter.$or = searchConditions;
    }

    // Get total count of documents
    const totalItems = await QstClient.countDocuments(filter);

    // If searching and on page > 1 but no results on current page
    if (search && page > 1 && skip >= totalItems) {
      // Return first page results instead
      const adjustedSkip = 0;
      const adjustedPage = 1;

      const qstClients = await QstClient.find(filter)
        .populate({
          path: "qstClientCreator",
          select: "name email",
        })
        .populate({
          path: "projects",
          select: "projectName description",
        })
        .populate({
          path: "contactEmployeeIds",
          select: "name email phoneNumber",
        })
        .populate({ path: "cse", select: "name" })
        .populate({ path: "zone", select: "zone" })
        .sort({ createdAt: -1 })
        .skip(adjustedSkip)
        .limit(limit);

      return res.status(200).json({
        success: true,
        count: qstClients.length,
        totalItems,
        currentPage: adjustedPage,
        totalPages: Math.ceil(totalItems / limit),
        message: "QST clients fetched for table view",
        data: qstClients,
      });
    }

    // Normal query
    const qstClients = await QstClient.find(filter)
      .populate({
        path: "qstClientCreator",
        select: "name email",
      })
      .populate({
        path: "projects",
        select: "projectName description",
      })
      .populate({
        path: "contactEmployeeIds",
        select: "name email phoneNumber",
      })
      .populate({ path: "cse", select: "name" })
      .populate({ path: "zone", select: "zone" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      success: true,
      count: qstClients.length,
      totalItems,
      currentPage: page,
      totalPages: Math.ceil(totalItems / limit),
      message: "QST clients fetched for table view",
      data: qstClients,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching QST clients for table",
      error: error.message,
    });
  }
};

// Use to show clients in dropdownOPtions (don't apply any filter or other things)
exports.getAllQstClients = async (req, res) => {
  try {
    // const search = req.query.search || "";

    const qstClients = await QstClient.find({
      // companyShortName: { $regex: search, $options: "i" }, // Case-insensitive search
    })
      .populate({
        path: "qstClientCreator",
        select: "name email",
      })
      .populate({
        path: "projects",
        select: "projectName description startDate endDate",
      })
      .populate({
        path: "contactEmployeeIds",
        select: "name email phoneNumber",
      })
      .populate({ path: "cse", select: "name" })
      .populate({ path: "zone", select: "zone" })
      .sort({ createdAt: -1, companyShortName: 1 });

    // Sort by createdAt descending
    // .sort({ companyShortName: 1 }); // 1 for ascending order (A-Z)

    res.status(200).json({
      success: true,
      count: qstClients.length,
      message: "Get All qstClient with creator infrmation",
      data: qstClients,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching QST clients",
      error: error.message,
    });
  }
};

// DELETE QST Client by ID
exports.deleteQSTClientById = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const clientId = req.params.id;

    // 1. Find the client
    const client = await QstClient.findById(clientId).session(session);
    if (!client) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    // 2. Check for open tickets (using both client ID and name for backward compatibility)
    const openTicket = await Ticket.findOne({
      $and: [
        {
          $or: [
            { qstClientName: clientId },
            { qstClientName: client.clientName }, // If you store name as reference
          ],
        },
        { isTicketClosed: false },
      ],
    }).session(session);

    if (openTicket) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete client - there are open tickets associated with this client",
        ticketId: openTicket._id, // Optional: return the open ticket ID for reference
      });
    }

    // 3. Check for projects with open tickets
    const projects = await Project.find({ qstClient: clientId }).session(
      session,
    );
    for (const project of projects) {
      const projectOpenTicket = await Ticket.findOne({
        $or: [
          { qstProjectID: project._id },
          { qstClientProjectName: project.projectName },
        ],
        isTicketClosed: false,
      }).session(session);

      if (projectOpenTicket) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `Cannot delete client - project ${project.projectName} has open tickets`,
          projectId: project._id,
          ticketId: projectOpenTicket._id,
        });
      }
    }

    // 4. Check for charge rates associated with this client
    const existingChargeRates = await customerChargeRateListModel
      .findOne({
        qstClient: clientId,
      })
      .session(session);

    if (existingChargeRates) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete client - there are charge rates associated with this client",
      });
    }

    // 5. Delete associated records
    await Employee.deleteMany({
      _id: { $in: client.contactEmployeeIds },
    }).session(session);

    await Project.deleteMany({
      qstClient: client._id,
    }).session(session);

    // 5. Delete the client
    await QstClient.findByIdAndDelete(client._id).session(session);

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: "Client and all associated records deleted successfully",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("Error deleting client:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete client",
      error: error.message,
    });
  }
};
// exports.deleteQSTClientById = async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const clientId = req.params.id;

//     const client = await QstClient.findById(clientId).session(session);
//     if (!client) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(404).json({
//         success: false,
//         message: "Client not found",
//       });
//     }

//     // Delete associated employees
//     await Employee.deleteMany({
//       _id: { $in: client.contactEmployeeIds },
//     }).session(session);

//     // Delete associated projects (optional – if applicable)
//     await Project.deleteMany({ qstClient: client._id }).session(session);

//     // Delete the client
//     await QstClient.findByIdAndDelete(client._id).session(session);

//     await session.commitTransaction();
//     session.endSession();

//     res.status(200).json({
//       success: true,
//       message: "Client and associated records deleted successfully",
//     });
//   } catch (error) {
//     await session.abortTransaction();
//     session.endSession();

//     console.error("Error deleting client:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to delete client",
//       error: error.message,
//     });
//   }
// };

exports.exportQstClients = async (req, res) => {
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

    const qstClients = await QstClient.find({
      createdAt: {
        $gte: from,
        $lte: to,
      },
    })
      .populate({
        path: "qstClientCreator",
        select: "name email",
      })
      .populate({
        path: "projects",
        select: "projectName description startDate endDate",
      })
      .populate({
        path: "contactEmployeeIds",
        select: "name email phoneNumber",
      })
      .populate({ path: "cse", select: "name" })
      .populate({ path: "zone", select: "zone" })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: qstClients.length,
      message: "Filtered QST clients fetched successfully",
      data: qstClients,
    });
  } catch (error) {
    console.error("Error fetching filtered QST clients:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// exports.updateSingleQSTClient = async (req, res) => {

//   const { id } = req.params;
//   const {
//     companyName,
//     companyShortName,
//     gstNo,
//     billingAddress,
//     billingCategory,
//     keyClient,
//     employeeId, // optional, for tracking
//   } = req.body;

//   try {
//     if (!companyName || !companyShortName) {
//       return res.status(400).json({
//         success: false,
//         message: "Company name and short name are required.",
//       });
//     }

//     const client = await QstClient.findById(id);
//     if (!client) {
//       return res.status(404).json({
//         success: false,
//         message: "Client not found.",
//       });
//     }

//      if (!billingCategory) {
//       return res.status(400).json({
//         success: false,
//         message: "billing category is required",
//       });
//     }

//     client.companyName = companyName.trim();
//     client.companyShortName = companyShortName.trim();
//     client.gstNo = gstNo || "";
//     client.billingAddress = billingAddress || "";
//     client.keyClient = keyClient;
//     client.billingCategory = billingCategory;

//     await client.save();

//     return res.status(200).json({
//       success: true,
//       message: "Client updated successfully.",
//       client,
//     });
//   } catch (error) {
//     console.error("Error updating client:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Error updating client.",
//       error: error.message,
//     });
//   }
// };

// exports.getClientDashboardStats = async (req, res) => {
//   try {
//     const { id: clientId } = req.params;
//     const currentDate = new Date();
//     currentDate.setHours(0, 0, 0, 0); // start of the day

//     const client = await QstClient.findById(clientId)
//      .populate({
//         path: "projects",
//         select: "projectName description",
//       })
//     .lean();
//     if (!client) {
//       return res.status(404).json({ message: "Client not found" });
//     }

//     const stats = await Ticket.aggregate([
//       { $match: { qstClientName: new mongoose.Types.ObjectId(clientId) } },
//       {
//         $facet: {
//           totalTickets: [{ $count: "count" }],
//           openTickets: [
//             { $match: { isTicketClosed: false } },
//             { $count: "count" }
//           ],
//           closedTickets: [
//             { $match: { isTicketClosed: true } },
//             { $count: "count" }
//           ],
//           delayedTickets: [
//             {
//               $match: {
//                 isTicketClosed: false,
//                 dueDate: { $lt: currentDate }
//               }
//             },
//             { $count: "count" }
//           ],
//           uniqueProjects: [
//             {
//               $group: {
//                 _id: "$qstClientProjectName",
//                 ticketCount: { $sum: 1 }
//               }
//             },
//             {
//               $project: {
//                 projectName: "$_id",
//                 ticketCount: 1,
//                 _id: 0
//               }
//             }
//           ]
//         }
//       }
//     ]);

//     const result = stats[0];

// const response = {
//   client: {
//     id: client._id,
//     companyName: client.companyName,
//     companyShortName: client.companyShortName
//   },
//   stats: {
//     totalTickets: result.totalTickets[0]?.count || 0,
//     openTickets: result.openTickets[0]?.count || 0,
//     closedTickets: result.closedTickets[0]?.count || 0,
//     delayedTickets: result.delayedTickets[0]?.count || 0,
//     totalProjects: client.projects.length,
//     projects: client.projects.map((proj) => {
//       const ticketInfo = result.uniqueProjects.find(
//         p => p.projectName?.toString() === proj._id.toString()
//       );
//       return {
//         _id: proj._id,
//         projectName: proj.projectName,
//         description: proj.description,
//         ticketCount: ticketInfo?.ticketCount || 0
//       };
//     })
//   }
// };

//     res.status(200).json(response);
//   } catch (error) {
//     console.error("Error fetching client dashboard stats:", error.message);
//     res.status(500).json({ message: "Server Error" });
//   }
// };

//   try {
//     const { clientId } = req.params;
//     const currentDate = new Date();
//     currentDate.setHours(0, 0, 0, 0); // Set to start of day for comparison

//     // Validate client exists
//     const client = await QstClient.findById(clientId).lean();
//     if (!client) {
//       return res.status(404).json({ message: "Client not found" });
//     }

//     // Single aggregation query to get all stats
//     const stats = await Ticket.aggregate([
//       { $match: { qstClientName: mongoose.Types.ObjectId(clientId) } },
//       {
//         $facet: {
//           totalTickets: [{ $count: "count" }],
//           openTickets: [
//             { $match: { isTicketClosed: false } },
//             { $count: "count" }
//           ],
//           closedTickets: [
//             { $match: { isTicketClosed: true } },
//             { $count: "count" }
//           ],
//           delayedTickets: [
//             {
//               $match: {
//                 isTicketClosed: false,
//                 dueDate: { $lt: currentDate }
//               }
//             },
//             { $count: "count" }
//           ],
//           uniqueProjects: [
//             {
//               $group: {
//                 _id: null,
//                 projects: { $addToSet: "$qstClientProjectName" }
//               }
//             },
//             { $project: { count: { $size: "$projects" } } }
//           ]
//         }
//       }
//     ]);

//     // Extract results from aggregation
//     const result = stats[0];
//     const totalProjects = result.uniqueProjects[0]?.count || 0;

//     // Prepare response
//     const response = {
//       client: {
//         id: client._id,
//         companyName: client.companyName,
//         companyShortName: client.companyShortName
//       },
//       stats: {
//         totalTickets: result.totalTickets[0]?.count || 0,
//         openTickets: result.openTickets[0]?.count || 0,
//         closedTickets: result.closedTickets[0]?.count || 0,
//         delayedTickets: result.delayedTickets[0]?.count || 0,
//         totalProjects,
//         // projects: result.uniqueProjects[0]?.projects || [] // Uncomment if you need project names
//       }
//     };

//     res.status(200).json(response);
//   } catch (error) {
//     console.error("Error fetching client dashboard stats:", error.message);
//     res.status(500).json({ message: "Server Error" });
//   }
// };

exports.updateSingleQSTClient = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const {
      companyName,
      companyShortName,
      gstNo,
      billingAddress,
      billingCategory,
      keyClient,
      contacts,
      employeeId,
      zone,
      cse,
    } = req.body;

    if (!companyName || !companyShortName) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Company name and short name are required.",
      });
    }

    if (!billingCategory) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Billing category is required",
      });
    }

    // Validate contacts if provided
    if (contacts && contacts.length > 0) {
      const emails = new Set();

      for (const contact of contacts) {
        if (!contact.contactPerson || !contact.email || !contact.mobileNo) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message:
              "Each contact must have contactPerson, email, and mobileNo",
          });
        }

        if (emails.has(contact.email.toLowerCase())) {
          await session.abortTransaction();
          session.endSession();
          return res.status(400).json({
            success: false,
            message: `Duplicate email ${contact.email} found in contacts`,
          });
        }
        emails.add(contact.email.toLowerCase());
      }
    }

    const client = await QstClient.findById(id).session(session);
    if (!client) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: "Client not found.",
      });
    }

    // Check for duplicate company name (excluding current client)
    const existingClient = await QstClient.findOne({
      companyName: companyName.trim(),
      _id: { $ne: id },
    }).session(session);

    if (existingClient) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Client with company name "${companyName}" already exists`,
      });
    }

    // Update client basic info
    client.companyName = companyName.trim();
    client.companyShortName = companyShortName.trim();
    client.gstNo = gstNo || "";
    client.billingAddress = billingAddress || "";
    client.keyClient = keyClient;
    client.billingCategory = billingCategory;
    client.qstClientCreator = employeeId || client.qstClientCreator;
    client.zone = zone;
    client.cse = cse;

    // Handle contacts if provided
    if (contacts && contacts.length > 0) {
      // Get current contact employee IDs (only those that actually exist)
      const currentContactIds = client.contactEmployeeIds || [];
      const validCurrentContactIds = [];

      // Verify which contact IDs actually exist in the Employee collection
      for (const empId of currentContactIds) {
        const exists = await Employee.exists({ _id: empId }).session(session);
        if (exists) {
          validCurrentContactIds.push(empId);
        }
      }

      // Update client with only valid contact IDs
      client.contactEmployeeIds = validCurrentContactIds;

      // Create arrays to track contacts to add, update, and remove
      const contactsToAdd = [];
      const contactsToUpdate = [];
      const existingContactEmails = new Set();

      // First, identify which contacts are new and which exist
      for (const contact of contacts) {
        // Check if this contact already exists in the database
        const existingEmployee = await Employee.findOne({
          email: contact.email.toLowerCase(),
          associatedClient: client._id,
        }).session(session);

        if (existingEmployee) {
          // Contact exists, update it
          existingEmployee.name = contact.contactPerson;
          existingEmployee.phoneNumber = contact.mobileNo;
          contactsToUpdate.push(existingEmployee);
          existingContactEmails.add(contact.email.toLowerCase());
        } else {
          // New contact to add
          contactsToAdd.push(contact);
        }
      }

      // Identify contacts to remove (those not in the new contacts list)
      const contactsToRemove = [];
      const currentEmployees = await Employee.find({
        _id: { $in: validCurrentContactIds },
        associatedClient: client._id,
      }).session(session);

      for (const employee of currentEmployees) {
        if (!existingContactEmails.has(employee.email.toLowerCase())) {
          contactsToRemove.push(employee);
        }
      }

      // Remove contacts that are no longer needed
      for (const employee of contactsToRemove) {
        // Remove employee reference from client
        client.contactEmployeeIds = client.contactEmployeeIds.filter(
          (id) => id.toString() !== employee._id.toString(),
        );

        // Mark as inactive instead of deleting (recommended)
        employee.isActive = false;
        await employee.save({ session });
      }

      // Update existing contacts
      for (const employee of contactsToUpdate) {
        await employee.save({ session });
      }

      // Add new contacts
      const newEmployees = [];
      for (const contact of contactsToAdd) {
        const tempPassword = generateSimplePassword(10);
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        const newEmployee = new Employee({
          name: contact.contactPerson,
          email: contact.email.toLowerCase(),
          phoneNumber: contact.mobileNo,
          password: hashedPassword,
          role: "qstClient",
          associatedClient: client._id,
          isActive: true,
        });

        const savedEmployee = await newEmployee.save({ session });
        newEmployees.push({
          employee: savedEmployee,
          tempPassword,
        });

        // Add to client's contact list
        client.contactEmployeeIds.push(savedEmployee._id);

        // Send welcome email
        const html = welcomeTemplateOfQSTClientsTemplate(
          savedEmployee.name,
          savedEmployee.email,
          tempPassword,
          `${(process.env.FRONTEND_URL || process.env.CLIENT_BASE_URL || "").replace(/\/api\/?$/, "")}/login`,
        );

        try {
          await sendEmail({
            to: savedEmployee.email,
            subject: `Login credentials for ${savedEmployee.name}`,
            html,
          });
        } catch (err) {
          console.error(
            `Email sending failed to ${savedEmployee.email}:`,
            err.message,
          );
        }
      }
    }

    await client.save({ session });
    await session.commitTransaction();
    session.endSession();

    // Populate the client with contact details for response
    const updatedClient = await QstClient.findById(id)
      .populate("contactEmployeeIds", "name email phoneNumber")
      .lean();

    return res.status(200).json({
      success: true,
      message: "Client updated successfully.",
      client: updatedClient,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error updating client:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating client.",
      error: error.message,
    });
  }
};

exports.getClientByqstUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    // Validate userId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    // Find the employee/user
    const user = await Employee.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if user has an associated client
    if (!user.associatedClient) {
      return res.status(404).json({
        success: false,
        message: "No client associated with this user",
      });
    }

    // Find the client
    const client = await QstClient.findById(user.associatedClient);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Associated client not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Client retrieved successfully",
      data: client,
    });
  } catch (error) {
    console.error("Error fetching client by user:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.getMainData = async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const search = req.query.search || "";

    const skip = (page - 1) * limit;

    // 🔍 Optional search
    let query = {};
    if (search) {
      // Find clients matching companyName
      const clients = await QstClient.find({
        $or: [
          { companyName: { $regex: search, $options: "i" } },
          { companyShortName: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      const clientIds = clients.map((c) => c._id);

      query = {
        $or: [
          { registrationNumber: { $regex: search, $options: "i" } },
          { server: { $regex: search, $options: "i" } },
          { assetType: { $regex: search, $options: "i" } },
          { company: { $in: clientIds } },
        ],
      };
    }

    // 🔢 Total count
    const total = await MainDataModel.countDocuments(query);

    // 📄 Paginated data
    const mainData = await MainDataModel.find(query)
      .populate("company")
      .populate("simDetails")
      .populate("deviceDetails")
      .populate("accessoryDetails")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    if (!mainData || mainData.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No main data found",
        data: [],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    }

    res.status(200).json({
      success: true,
      message: "Main data fetched successfully",
      data: mainData,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching main data",
      error: error.message,
    });
  }
};

exports.updateMainData = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      company,
      registrationNumber,
      referType,
      assetType,
      server,
      simDetails,
      deviceDetails,
      accessoryDetails,
    } = req.body;

    const updateFields = {};
    if (company) updateFields.company = company;
    if (registrationNumber !== undefined)
      updateFields.registrationNumber = registrationNumber;
    if (referType !== undefined) updateFields.referType = referType;
    if (assetType !== undefined) updateFields.assetType = assetType;
    if (server !== undefined) updateFields.server = server;
    if (simDetails !== undefined) updateFields.simDetails = simDetails;
    if (deviceDetails !== undefined) updateFields.deviceDetails = deviceDetails;
    if (accessoryDetails !== undefined)
      updateFields.accessoryDetails = accessoryDetails;

    const updatedData = await MainDataModel.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true },
    );

    if (!updatedData) {
      return res.status(404).json({
        success: false,
        message: "Main data not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Main data updated successfully",
      data: updatedData,
    });
  } catch (error) {
    console.error("Error updating main data:", error);
    res.status(500).json({
      success: false,
      message: "Error updating main data",
      error: error.message,
    });
  }
};

exports.deleteMainData = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedData = await MainDataModel.findByIdAndDelete(id);

    if (!deletedData) {
      return res.status(404).json({
        success: false,
        message: "Main data not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Main data deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting main data:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting main data",
      error: error.message,
    });
  }
};
