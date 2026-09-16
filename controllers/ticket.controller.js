const Ticket = require("../models/ticket.model");
const DeletedTicketLog = require("../models/deletedTicketLog.model");
const QstClient = require("../models/qstClient.model");
const Employee = require("../models/employee.model");
const Technician = require("../models/technician.model");
const Project = require("../models/project.model");
const Task = require("../models/task.model");
const Device = require("../models/device.model");
const State = require("../models/state.model");
const mongoose = require("mongoose");
const AWS = require("aws-sdk");
const dayjs = require("dayjs");
const generateTicketSKUId = require("../utils/TicketSkuIdGenerator");
const getTicketSKUIdGenerator = require("../utils/TicketSkuIdGenerator");
const generateTechnicianAssignmentEmail = require("../emailTemplates/TechnicianFileUploadTemplate");
const sendEmail = require("../utils/SendEmail");
// const DueDateChangeLog = require("../models/DueDateChangeLog.model");
const securityCodeModel = require("../models/securityCode.model");
const DueDateChangeLog = require("../models/DueDateChangeLog.model");
const DefectiveItemSwap = require("../models/defectiveItemSwap.model");
const MainData = require("../models/mainData.model");
// const {deleteFromS3 } = require('../utils/S3Utils');
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const createTicket = async (req, res) => {
  // console.log(req.body);
  try {
    const {
      qstClient = undefined, // Now expects ID
      location,
      taskType = undefined, // Now expects ID
      deviceType = undefined, // Now expects ID
      vehicleNumbers,
      oldVehicleNumbers,
      newVehicleNumbers,
      noOfVehicles,
      description,
      remark,
      assignee = undefined, // Now expects ID
      projectName,
      qstClientTicketNo,
      technician: rawTechnician = undefined, // Already expects ID
      imeiNumber,
      simNumber,
      issueFound,
      resolution,
      techCharges,
      materialCharges,
      courierCharges,
      techConveyance,
      customerConveyance,
      ticketStatus,
      techAccountNumber,
      techIfscCode,
      accountHolder,
      state,
      subjectLine,
      totalTechCharges,
      customerCharges,
      totalCustomerCharges,
      ticketClosureReason,
      dueDate,
      qstProjectID,
      ticketAvailabilityDate,
      registrationNumber
      // here we get all file urls which uploaded during ticket creation
    } = req.body;


    console.log("☑️☑️☑️ :", req.body);
    // handle empty string come for objectId
    const technician = rawTechnician === "" ? undefined : rawTechnician;

    let issueFoundRef = undefined;
    let resolutionRef = undefined;

    // console.log(vehicleNumbers, "vehicalNumbers");
    // console.log(oldVehicleNumbers, "oldVehicleNumbers");
    // console.log(newVehicleNumbers, "newVehicleNumbers");

    // Validate required fields
    const requiredFields = {
      qstClient,
      location,
      taskType,
      assignee,
      state,
      ticketStatus,
      dueDate,
      description,
    };

    const missingFields = Object.entries(requiredFields)
      .filter(([key, value]) => !value)
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required field(s): ${missingFields.join(", ")}`,
      });
    }

    // if (new Date(dueDate) < new Date()) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Due date must be in the future",
    //   });
    // }

    const isPastDate = (date) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Reset today's time to 00:00:00

      const due = new Date(date);
      due.setHours(0, 0, 0, 0); // Reset due date time to 00:00:00

      return due < today;
    };

    if (isPastDate(dueDate)) {
      return res.status(400).json({
        success: false,
        message: "Due date must be today or in the future",
      });
    }

    let attachments = [];

    // Case 1: If it's a string (malformed JSON)
    if (typeof req.body.attachments === "string") {
      try {
        attachments = JSON.parse(req.body.attachments);
      } catch (e) {
        console.error("Failed to parse attachments:", e.message);
        return res
          .status(400)
          .json({ success: false, message: "Invalid attachments format" });
      }
    }
    // Case 2: If it's already an array (correct format)
    else if (Array.isArray(req.body.attachments)) {
      attachments = req.body.attachments;
    }
    // Case 3: Invalid format (neither string nor array)
    else {
      console.error("Invalid attachments type:", typeof req.body.attachments);
      return res
        .status(400)
        .json({ success: false, message: "Attachments must be an array" });
    }

    // console.log("Final attachments:", attachments); // Should now contain the files

    // Handle empty strings for all ObjectId fields
    const cleanObjectIdField = (value) => {
      if (value === "" || value === null || value === undefined) {
        return undefined;
      }
      return value;
    };

    const handleReferenceField = (value) => {
      if (value === undefined || value === null || value === "") {
        return null;
      }
      return value;
    };

    // Verify references exist (no need to fetch full documents)
    const [clientExists, assigneeExists, taskExists, deviceExists, techExists] =
      await Promise.all([
        QstClient.exists({ _id: cleanObjectIdField(qstClient) }),
        Employee.exists({ _id: cleanObjectIdField(assignee) }),
        Task.exists({ _id: cleanObjectIdField(taskType) }),
        deviceType
          ? Device.exists({ _id: cleanObjectIdField(deviceType) })
          : Promise.resolve(true),
        technician
          ? Technician.findById(technician).select("email name _id")
          : Promise.resolve(null),
      ]);

    // Add check only when technician is provided
    if (technician && !techExists) {
      return res
        .status(404)
        .json({ success: false, message: "Technician not found" });
    }
    if (!assigneeExists)
      return res
        .status(404)
        .json({ success: false, message: "Assignee not found" });
    if (!taskExists)
      return res
        .status(404)
        .json({ success: false, message: "Task type not found" });
    if (deviceType && !deviceExists)
      return res
        .status(404)
        .json({ success: false, message: "Device type not found" });

    // Validate project ID if provided
    if (qstProjectID) {
      const projectExists = await mongoose
        .model("Project")
        .exists({ _id: qstProjectID });
      if (!projectExists) {
        return res.status(400).json({
          success: false,
          message: "Invalid Project ID: Project does not exist.",
        });
      }
    }

    // Handle vehicle numbers
    let vehicleNumbersArray = [];
    let oldVehicleNumbersArray = [];
    let newVehicleNumbersArray = [];
    let isReinstallation = false;

    let taskTypeDoc = await Task.findById(taskType);
    const isServiceTask = taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("service");

    if (isServiceTask) {
      // Handle service task specific logic
      issueFoundRef = handleReferenceField(issueFound);
      resolutionRef = handleReferenceField(resolution);
    }

    if (
      taskTypeDoc &&
      taskTypeDoc.taskName.toLowerCase().includes("reinstallation")
    ) {
      isReinstallation = true;
      oldVehicleNumbersArray = Array.isArray(oldVehicleNumbers)
        ? oldVehicleNumbers
        : oldVehicleNumbers
          ? oldVehicleNumbers.split(",").map((v) => v.trim())
          : [];

      newVehicleNumbersArray = Array.isArray(newVehicleNumbers)
        ? newVehicleNumbers
        : newVehicleNumbers
          ? newVehicleNumbers.split(",").map((v) => v.trim())
          : [];

      if (oldVehicleNumbersArray.length !== newVehicleNumbersArray.length) {
        return res.status(400).json({
          success: false,
          message: "Old and New Vehicle Numbers must have the same count",
        });
      }
    } else {
      vehicleNumbersArray = Array.isArray(vehicleNumbers)
        ? vehicleNumbers
        : vehicleNumbers
          ? vehicleNumbers.split(",").map((v) => v.trim())
          : [];
    }

    // console.log('Raw attachments:', req.body.attachments);
    // console.log('Parsed attachments:', attachments);
    // console.log('Type of parsed:', typeof attachments);
    // console.log('Is array?', Array.isArray(attachments));

    // console.log(newVehicleNumbersArray, "NewvehicleNumbersArray");
    // console.log(vehicleNumbersArray, "vehicleNumbersArray");

    // console.log(req.body?.employeeId);
    // Create the ticket
    const newTicket = new Ticket({
      qstClientName: cleanObjectIdField(qstClient),
      taskType: cleanObjectIdField(taskType),
      deviceType: cleanObjectIdField(deviceType),
      location,
      dueDate: new Date(dueDate),
      ticketAvailabilityDate: new Date(ticketAvailabilityDate),
      technician: technician || undefined,
      oldVehicleNumber: isReinstallation ? oldVehicleNumbersArray : [],
      registrationNumber: registrationNumber || '',
      vehicleNumbers: isReinstallation
        ? newVehicleNumbersArray.map((newNumber, index) => ({
          vehicleNumber: newNumber, // ✅ FIXED HERE
          isResinstalationTypeNewVehicalNumber: true,
        }))
        : vehicleNumbersArray.map((number) => ({
          vehicleNumber: number, // ✅ FIXED HERE
          isResinstalationTypeNewVehicalNumber: false,
        })),
      noOfVehicles: isReinstallation
        ? oldVehicleNumbersArray.length
        : vehicleNumbersArray.length,
      description,
      remark,
      assignee: cleanObjectIdField(assignee),
      qstProjectID: qstProjectID || undefined,
      qstClientTicketNumber: qstClientTicketNo,
      qstClientProjectName: projectName,
      imeiNumbers: imeiNumber,
      simNumbers: simNumber,
      issueFound,
      resolution,
      issueFoundRef,
      resolutionRef,
      technicianCharges: parseFloat(techCharges) || 0,
      materialCharges: parseFloat(materialCharges) || 0,
      courierCharges: parseFloat(courierCharges) || 0,
      techConveyance: parseFloat(techConveyance) || 0,
      customerConveyance: parseFloat(customerConveyance) || 0,
      ticketStatus: ticketStatus,
      techAccountNumber,
      techIFSCCode: techIfscCode,
      accountHolderName: accountHolder,
      state,
      subjectLine,
      totalTechCharges: parseFloat(totalTechCharges) || 0,
      customerCharges: parseFloat(customerCharges) || 0,
      totalCustomerCharges: parseFloat(totalCustomerCharges) || 0,
      reasonForTicketClosure: ticketClosureReason,
      creator: req.body.user || req.body?.employeeId,

      attachedFiles: attachments.map(
        (file) =>
          `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${file.key}`
      ),
    });

    // ------------- Ticket skuId addition and retry methos ------------------
    // Retry logic for ticket saving

    const generateTicketSKUId = await getTicketSKUIdGenerator();
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 100; // Small delay between retries
    let savedTicket;
    let attempts = 0;
    let lastError = null;
    while (attempts < MAX_RETRIES) {
      try {
        // Generate new SKU for each attempt
        const ticketWithSKU = {
          ...newTicket.toObject(), // Convert to plain object to avoid mongoose doc issues
          ticketSKUId: await generateTicketSKUId(),
        };

        savedTicket = await new Ticket(ticketWithSKU).save();
        break; // Exit loop if successful
      } catch (error) {
        if (error.code === 11000 && error.keyPattern?.ticketSKUId) {
          // Duplicate SKU error, try again
          attempts++;
          if (attempts >= MAX_RETRIES) {
            // Prepare a specific error for SKU generation failure
            const skuError = new Error(
              "Failed to generate unique ticket ID after multiple attempts. Please try again."
            );
            skuError.isSKUGenerationError = true;
            throw skuError;
          }
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
          continue;
        }
        // For other errors, break the loop and throw
        throw error;
      }
    }
    // -----------------------------------------------------

    // Send email to technician if assigned

    console.log(techExists);
    if (technician && techExists && techExists.email) {
      try {
        // Generate security code
        const securityCode = Math.floor(
          100000 + Math.random() * 900000
        ).toString();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

        // Save security code
        await securityCodeModel.create({
          securityCode: securityCode,
          ticketId: savedTicket._id,
          technicianId: technician,
          expiresAt,
        });

        const emailContent = generateTechnicianAssignmentEmail(
          savedTicket.toObject(),
          techExists,
          securityCode // Pass the security code to the email generator
        );

        console.log(techExists.email, "5555555555555555");

        await sendEmail({
          to: techExists.email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        });

        console.log(
          `Notification email sent to technician: ${techExists.email}`
        );
      } catch (emailError) {
        console.error(
          "Failed to send technician assignment email:",
          emailError
        );
        // Don't fail the ticket creation if email fails
      }
    }

    // Populate references for the response
    const populatedTicket = await Ticket.findById(savedTicket._id)
      .populate("qstClientName", "companyShortName companyName gstNo billingCategory billingAddress")
      .populate("assignee", "name")
      .populate("taskType", "taskName")
      .populate("deviceType", "deviceName")
      .populate("technician", "name")
      .populate("creator", "name")
      .populate("qstProjectID", "projectName");

    // ── Fire-and-forget: forward to secondary .NET system ──────────────────
    (() => {
      const dotNetUrl = 'https://www.algotrack.in/AlgoCRMAPI/api/ticket';

      if (!dotNetUrl) {
        console.warn("[SecondSystem] DOTNET_SYSTEM_URL not set – skipping forward");
        return;
      }

      // Base payload from populated ticket (names, not ObjectIds)
      const basePayload = buildDotNetPayload(populatedTicket);

      // Extra fields from req.body — only include if they have a real value
      const addIfPresent = (obj, key, value) => {
        if (value !== undefined && value !== null && value !== "") {
          obj[key] = value;
        }
      };

      const extraFields = {};
      addIfPresent(extraFields, "assetType", req.body.assetType);
      addIfPresent(extraFields, "deviceId", req.body.deviceId);
      addIfPresent(extraFields, "deviceName", req.body.deviceName);
      addIfPresent(extraFields, "deviceManufacturer", req.body.deviceManufacturer);
      addIfPresent(extraFields, "deviceModel", req.body.deviceModel);
      addIfPresent(extraFields, "simProvider", req.body.simProvider);
      addIfPresent(extraFields, "server", req.body.server);
      addIfPresent(extraFields, "referType", req.body.referType);
      addIfPresent(extraFields, "isActivated", req.body.isActivated);
      addIfPresent(extraFields, "mobileNumber", req.body.mobileNumber);

      // Technician — only include ID if actually assigned
      if (populatedTicket.technician?._id) {
        extraFields.technicianId = populatedTicket.technician._id;
        extraFields.technicianName = populatedTicket.technician.name || "";
      }

      const payload = { ...basePayload, ...extraFields };

      console.log("[SecondSystem] Payload being sent to .NET system:", JSON.stringify(payload, null, 2));
      fetch(dotNetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(async (r) => {
          const bodyText = await r.text();
          if (r.ok) {
            console.log(`[SecondSystem] Forwarded ticket ${savedTicket._id} – status ${r.status}`);
          } else {
            console.error(`[SecondSystem] ERROR forwarding ticket ${savedTicket._id} – status ${r.status}`);
            console.error("[SecondSystem] Error body:", bodyText);
            console.error("[SecondSystem] Payload that caused the error:", JSON.stringify(payload, null, 2));
          }
        })
        .catch((err) => console.error("[SecondSystem] Failed to forward ticket:", err.message));
    })();
    // ───────────────────────────────────────────────────────────────────────

    res.status(201).json({
      success: true,
      message: "Ticket created successfully",
      data: populatedTicket,
    });
  } catch (error) {
    console.error("Error creating ticket:", error);
    if (error.isSKUGenerationError) {
      res.status(statusCode).json({
        success: false,
        message: message,
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
};


// ─── Helper: build a human-readable payload for the .NET system ───────────────
const buildDotNetPayload = (ticket) => ({
  ticketSKUId: ticket.ticketSKUId,
  qstClientId: ticket.qstClientName?._id || "",
  clientName: ticket.qstClientName?.companyShortName || ticket.qstClientNameString || "",
  clientFullName: ticket.qstClientName?.companyName || "",
  taskType: ticket.taskType?.taskName || ticket.taskTypeString || "",
  deviceType: ticket.deviceType?.deviceName || ticket.devicetypeNameString || "",
  assigneeName: ticket.assignee?.name || ticket.assigneeNameString || "",
  assigneeId: ticket.assignee?._id || "",
  technicianName: ticket.technician?.name || ticket.technicianNameString || "",
  creatorId: ticket.creator?._id || "",   // employeeId who created the ticket
  creatorName: ticket.creator?.name || "",
  projectName: ticket.qstProjectID?.projectName || ticket.qstClientProjectName || "",
  qstClientTicketNumber: ticket.qstClientTicketNumber || "",
  location: ticket.location || "",
  state: ticket.state || "",
  subjectLine: ticket.subjectLine || "",
  description: ticket.description || "",
  remark: ticket.remark || "",
  registrationNumber: ticket.registrationNumber || "",
  vehicleNumbers: (ticket.vehicleNumbers || []).map((v) => v.vehicleNumber),
  noOfVehicles: ticket.noOfVehicles || 0,
  ticketStatus: ticket.ticketStatus || "",
  dueDate: ticket.dueDate || null,
  ticketAvailabilityDate: ticket.ticketAvailabilityDate || null,
  mobileNumber: ticket.mobile || "",
  imeiNumbers: ticket.imeiNumbers || [],
  simNumbers: ticket.simNumbers || [],
  issueFound: ticket.issueFound || "",
  resolution: ticket.resolution || "",
  totalTechCharges: ticket.totalTechCharges || 0,
  totalCustomerCharges: ticket.totalCustomerCharges || 0,
  createdAt: ticket.createdAt || null,

  // --- Technician Work & Operations History ---

  // 1. Vehicle progress (Technician Image Uploads, Videos, and "isDone" flag)
  vehicleOperations: (ticket.vehicleNumbers || []).map(v => ({
    vehicleNumber: v.vehicleNumber,
    isDone: v.isDone || false,
    images: v.images || [],
    videoURL: v.videoURL || "",
    isReinstallationNewVehicle: v.isResinstalationTypeNewVehicalNumber || false
  })),

  // 2. Soft Close Details
  softClose: {
    isSoftClosed: ticket.softCloseByTechnician || false,
    date: ticket.softCloseByTechnicianDate || null,
    reason: ticket.softCloseByTechnicianComment?.reason || ticket.softCloseByTechnicianComment || ""
  },

  // 3. Swap Histories (including CSE Rejections/Approvals & Defect Images)
  swapHistories: (ticket.spareSwaps || []).map(swap => ({
    vehicleNumber: swap.vehicleNumber,
    itemType: swap.itemType,
    defectDescription: swap.defectDescription || "",
    defectImages: swap.defectImages || [],
    swapDate: swap.swapDate || null,

    // CSE Approval Workflow captures rejections
    cseApprovalStatus: swap.cseApprovalStatus || "pending",
    cseApprovalDate: swap.cseApprovalDate || null,
    cseComments: swap.cseComments || "",

    defectiveItemModel: swap.defectiveItemModel,
    defectiveItemSerialNumber: swap.defectiveItemSerialNumber || "",
    spareItemModel: swap.spareItemModel,
    spareItemSerialNumber: swap.spareItemSerialNumber || ""
  })),

  // 4. Initial attachment files (when ticket created)
  initialAttachments: ticket.attachedFiles || [],
});

// ─── Helper: build the CSE-close-specific payload for the .NET system ─────────
// Re-fetches the ticket fresh from DB to guarantee the latest per-vehicle data
// (isDone, images, etc.) set by the technician, then queries MainData live to
// get post-swap IMEI, SIM, deviceType, and Temperature for each vehicle.
const buildCseClosePayload = async (ticket) => {
  // ── Step 1: Re-fetch the ticket from DB to get the latest vehicleNumbers state
  // (isDone and other fields may have been updated by technician AFTER the ticket
  //  object was first populated for the CSE close flow)
  const freshTicket = await Ticket.findById(ticket._id).lean();
  const vehicleNumbers = freshTicket?.vehicleNumbers || ticket.vehicleNumbers || [];

  console.log("🔄 [SecondSystem] Re-fetched ticket vehicleNumbers (latest isDone):",
    vehicleNumbers.map((v) => ({ vehicleNumber: v.vehicleNumber, isDone: v.isDone })));

  // ── Step 2: Query MainData live — already reflects post-swap device/SIM/accessory
  const clientId = ticket.qstClientName?._id || ticket.qstClientName;
  const vehicleNums = vehicleNumbers.map((v) => v.vehicleNumber);

  const query = { registrationNumber: { $in: vehicleNums } };
  if (clientId) query.company = clientId;

  const mainDataRecords = await MainData.find(query)
    .populate("deviceDetails", "deviceId deviceType deviceModel")
    .populate("simDetails", "simNumber mobileNumber")
    .populate("accessoryDetails", "accessoryType accessoryId");

  console.log("➡️➡️➡️ Main Records : ", mainDataRecords);

  // Diagnostic: how many total MainData records exist for this client?
  const totalForClient = clientId ? await MainData.countDocuments({ company: clientId }) : "unknown (no clientId)";
  console.log(`[SecondSystem] MainData for client ${clientId}: ${totalForClient} total record(s) in DB.`);
  console.log(`[SecondSystem] MainData lookup: searched ${vehicleNums.length} vehicle(s) [${vehicleNums.join(", ")}], found ${mainDataRecords.length} match(es).`);
  if (mainDataRecords.length < vehicleNums.length) {
    const found = mainDataRecords.map((r) => r.registrationNumber);
    const missing = vehicleNums.filter((v) => !found.includes(v));
    console.warn(`[SecondSystem] No MainData record for: ${missing.join(", ")} — IMEI/SIM/deviceType will be empty for these.`);
  }

  // ── Step 3: Build lookup map: registrationNumber → MainData record
  const mainDataMap = {};
  for (const record of mainDataRecords) {
    mainDataMap[record.registrationNumber] = record;
  }

  return {
    ticketSKUId: ticket.ticketSKUId,
    qstClientId: ticket.qstClientName?._id || "",
    clientName: ticket.qstClientName?.companyShortName || ticket.qstClientNameString || "",
    clientFullName: ticket.qstClientName?.companyName || "",
    taskType: ticket.taskType?.taskName || ticket.taskTypeString || "",
    assigneeName: ticket.assignee?.name || ticket.assigneeNameString || "",
    assigneeId: ticket.assignee?._id || "",
    technicianName: ticket.technician?.name || ticket.technicianNameString || "",
    technicianId: ticket.technician?._id || "",
    creatorId: ticket.creator?._id || "",
    creatorName: ticket.creator?.name || "",
    projectName: ticket.qstProjectID?.projectName || ticket.qstClientProjectName || "",
    qstClientTicketNumber: ticket.qstClientTicketNumber || "",
    location: ticket.location || "",
    state: ticket.state || "",
    subjectLine: ticket.subjectLine || "",
    description: ticket.description || "",
    remark: ticket.remark || "",
    ticketStatus: ticket.ticketStatus || "",
    dueDate: ticket.dueDate || null,
    ticketAvailabilityDate: ticket.ticketAvailabilityDate || null,
    totalTechCharges: ticket.totalTechCharges || 0,
    totalCustomerCharges: ticket.totalCustomerCharges || 0,
    createdAt: ticket.createdAt || null,

    // ── Per-vehicle operations
    // isDone   → from freshTicket (latest technician mark)
    // imei/sim/deviceType/Temperature → from MainData (post-swap, live)
    vehicleOperations: vehicleNumbers.map((v) => {
      console.log("☑️☑️☑️ VehicleNumbers (fresh) : ", { vehicleNumber: v.vehicleNumber, isDone: v.isDone });
      const md = mainDataMap[v.vehicleNumber] || {};
      const device = md.deviceDetails || {};
      const sim = md.simDetails || {};
      const accessories = md.accessoryDetails || [];
      const hasTemperature = accessories.some(
        (acc) => acc.accessoryType && acc.accessoryType.toLowerCase().includes("temperature")
      );

      return {
        vehicleNumber: v.vehicleNumber,
        imei: device.deviceId || "",
        sim: sim.simNumber || "",
        deviceType: device.deviceType || device.deviceModel || "",
        Temperature: hasTemperature,
        isDone: v.isDone ?? false,      // ← from freshTicket, not stale caller snapshot
        images: v.images || [],
        videoURL: v.videoURL || "",
      };
    }),
  };
};

// ─── POST /send-ticket-data-on-second-system ──────────────────────────────────
// Accepts { ticketId } → populates ticket → POSTs human-readable payload to .NET
const sendTicketDataOnSecondSystem = async (req, res) => {
  try {
    const { ticketId } = req.body;
    if (!ticketId) {
      return res.status(400).json({ success: false, message: "ticketId is required" });
    }

    const ticket = await Ticket.findById(ticketId)
      .populate("qstClientName", "companyShortName companyName")
      .populate("assignee", "name")
      .populate("taskType", "taskName")
      .populate("deviceType", "deviceName")
      .populate("technician", "name")
      .populate("creator", "name")
      .populate("qstProjectID", "projectName");

    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }

    const dotNetUrl = 'https://your-dotnet-api.com/api/receive-ticket';
    if (!dotNetUrl) {
      return res.status(500).json({ success: false, message: "DOTNET_SYSTEM_URL is not configured on the server" });
    }

    const payload = buildDotNetPayload(ticket);

    const dotNetResponse = await fetch(dotNetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const responseText = await dotNetResponse.text();

    if (!dotNetResponse.ok) {
      return res.status(502).json({
        success: false,
        message: "Second system returned an error",
        status: dotNetResponse.status,
        body: responseText,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ticket data forwarded to second system successfully",
      sentPayload: payload,
      secondSystemResponse: responseText,
    });
  } catch (error) {
    console.error("[sendTicketDataOnSecondSystem] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};


// const createNewTicket = async (req, res) => {
//   try {
//     const {
//       // Customer Information (NEW)
//       customerName,
//       mobile,
//       email,
//       pincode,
//       detailedAddress,

//       // Dashcam Information (NEW)
//       dashcamBrand,
//       dashcamType,

//       // Vehicle Information (NEW)
//       vehicleMake,
//       vehicleModel,
//       price,
//       paymentGateway,

//       // Existing fields
//       qstClient = "68fa34baad4d8a1b9653277d", // Fixed D2C client
//       location,
//       taskType,
//       deviceType,
//       vehicleNumbers,
//       oldVehicleNumbers,
//       newVehicleNumbers,
//       noOfVehicles,
//       description,
//       assignee = "684697ddb417aaccbbf3a715", // Fixed assignee
//       qstClientTicketNo,
//       technician: rawTechnician,
//       imeiNumber,
//       simNumber,
//       issueFound,
//       resolution,
//       state,
//       dueDate,
//       qstProjectID,
//       ticketAvailabilityDate,
//       subjectLine,
//       // Fixed status
//       ticketStatus = "technician not yet assigned"
//     } = req.body;

//     // Handle empty string for technician
//     const technician = rawTechnician === "" ? undefined : rawTechnician;

//     let issueFoundRef = undefined;
//     let resolutionRef = undefined;

//     // Validate required fields
//     const requiredFields = {
//       customerName,
//       mobile,
//       location,
//       taskType,
//       state,
//       dueDate,
//     };

//     const missingFields = Object.entries(requiredFields)
//       .filter(([key, value]) => !value)
//       .map(([key]) => key);

//     if (missingFields.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: `Missing required field(s): ${missingFields.join(", ")}`,
//       });
//     }

//     // Validate due date
//     const isPastDate = (date) => {
//       const today = new Date();
//       today.setHours(0, 0, 0, 0);
//       const due = new Date(date);
//       due.setHours(0, 0, 0, 0);
//       return due < today;
//     };

//     if (isPastDate(dueDate)) {
//       return res.status(400).json({
//         success: false,
//         message: "Due date must be today or in the future",
//       });
//     }

//     // Handle file attachments
//     let attachments = [];
//     if (typeof req.body.attachments === "string") {
//       try {
//         attachments = JSON.parse(req.body.attachments);
//       } catch (e) {
//         console.error("Failed to parse attachments:", e.message);
//         return res.status(400).json({ 
//           success: false, 
//           message: "Invalid attachments format" 
//         });
//       }
//     } else if (Array.isArray(req.body.attachments)) {
//       attachments = req.body.attachments;
//     }

//     // Handle file uploads from multipart form data
//     const attachedFiles = req.files ? req.files.map(file => file.filename) : [];

//     // Clean object ID fields
//     const cleanObjectIdField = (value) => {
//       if (value === "" || value === null || value === undefined) {
//         return undefined;
//       }
//       return value;
//     };

//     const handleReferenceField = (value) => {
//       if (value === undefined || value === null || value === "") {
//         return null;
//       }
//       return value;
//     };

//     // Verify references exist
//     const [clientExists, assigneeExists, taskExists, deviceExists, techExists] =
//       await Promise.all([
//         QstClient.exists({ _id: cleanObjectIdField(qstClient) }),
//         Employee.exists({ _id: cleanObjectIdField(assignee) }),
//         Task.exists({ _id: cleanObjectIdField(taskType) }),
//         deviceType
//           ? Device.exists({ _id: cleanObjectIdField(deviceType) })
//           : Promise.resolve(true),
//         technician
//           ? Technician.findById(technician).select("email name _id")
//           : Promise.resolve(null),
//       ]);

//     // Validate references
//     if (!clientExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "QST Client not found" 
//       });
//     }
//     if (!assigneeExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Assignee not found" 
//       });
//     }
//     if (!taskExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Task type not found" 
//       });
//     }
//     if (deviceType && !deviceExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Device type not found" 
//       });
//     }
//     if (technician && !techExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Technician not found" 
//       });
//     }

//     // Validate project ID if provided
//     if (qstProjectID) {
//       const projectExists = await mongoose
//         .model("Project")
//         .exists({ _id: qstProjectID });
//       if (!projectExists) {
//         return res.status(400).json({
//           success: false,
//           message: "Invalid Project ID: Project does not exist.",
//         });
//       }
//     }

//     // Handle vehicle numbers based on task type
//     let vehicleNumbersArray = [];
//     let oldVehicleNumbersArray = [];
//     let newVehicleNumbersArray = [];
//     let isReinstallation = false;

//     const taskTypeDoc = await Task.findById(taskType);
//     const isServiceTask = taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("service");
//     const isReinstallTask = taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("reinstallation");

//     if (isServiceTask) {
//       // Handle service task specific logic
//       issueFoundRef = handleReferenceField(issueFound);
//       resolutionRef = handleReferenceField(resolution);
//     }

//     if (isReinstallTask) {
//       isReinstallation = true;
//       oldVehicleNumbersArray = Array.isArray(oldVehicleNumbers)
//         ? oldVehicleNumbers
//         : oldVehicleNumbers
//         ? oldVehicleNumbers.split(",").map((v) => v.trim())
//         : [];

//       newVehicleNumbersArray = Array.isArray(newVehicleNumbers)
//         ? newVehicleNumbers
//         : newVehicleNumbers
//         ? newVehicleNumbers.split(",").map((v) => v.trim())
//         : [];

//       if (oldVehicleNumbersArray.length !== newVehicleNumbersArray.length) {
//         return res.status(400).json({
//           success: false,
//           message: "Old and New Vehicle Numbers must have the same count",
//         });
//       }
//     } else {
//       vehicleNumbersArray = Array.isArray(vehicleNumbers)
//         ? vehicleNumbers
//         : vehicleNumbers
//         ? vehicleNumbers.split(",").map((v) => v.trim())
//         : [];
//     }

//     // Calculate charges
//     const totalCustomerCharges = price ? Number(price) : 0;
//     const totalTechCharges = 0; // Will be calculated when technician is assigned

//     // Get string names for backup fields
//     const clientDoc = await QstClient.findById(qstClient);
//     const assigneeDoc = await Employee.findById(assignee);
//     const taskDoc = await Task.findById(taskType);
//     const deviceDoc = deviceType ? await Device.findById(deviceType) : null;

//     // Create ticket object (without saving yet)
//     const newTicketData = {
//       // Customer information
//       customerName: customerName || '',
//       mobile: mobile || '',
//       email: email || '',
//       pincode: pincode || '',
//       detailedAddress: detailedAddress || '',

//       // Dashcam information
//       dashcamBrand: dashcamBrand || '',
//       dashcamType: dashcamType || '',

//       // Vehicle information
//       vehicleMake: vehicleMake || '',
//       vehicleModel: vehicleModel || '',
//       vehicleNumbers: isReinstallation
//         ? newVehicleNumbersArray.map((newNumber, index) => ({
//             vehicleNumber: newNumber,
//             images: [],
//             videoURL: "",
//             isResinstalationTypeNewVehicalNumber: true,
//           }))
//         : vehicleNumbersArray.map((number) => ({
//             vehicleNumber: number,
//             images: [],
//             videoURL: "",
//             isResinstalationTypeNewVehicalNumber: false,
//           })),
//       oldVehicleNumber: isReinstallation ? oldVehicleNumbersArray : [],
//       noOfVehicles: isReinstallation
//         ? oldVehicleNumbersArray.length
//         : vehicleNumbersArray.length,

//       // Ticket information
//       qstClientName: cleanObjectIdField(qstClient),
//       taskType: cleanObjectIdField(taskType),
//       deviceType: cleanObjectIdField(deviceType),
//       location: location || '',
//       description: description || '',
//       dueDate: new Date(dueDate),
//       ticketAvailabilityDate: ticketAvailabilityDate ? new Date(ticketAvailabilityDate) : null,

//       // Assignment fields
//       assignee: cleanObjectIdField(assignee),
//       technician: technician || undefined,
//       ticketStatus: ticketStatus,

//       // Optional fields
//       qstClientTicketNumber: qstClientTicketNo || '',
//       qstProjectID: qstProjectID || undefined,
//       imeiNumbers: imeiNumber ? [imeiNumber] : [],
//       simNumbers: simNumber ? [simNumber] : [],
//       issueFound: issueFound || '',
//       resolution: resolution || '',
//       issueFoundRef,
//       resolutionRef,
//       state: state || '',

//       // Payment information
//       price: price ? Number(price) : 0,
//       customerCharges: totalCustomerCharges,
//       totalCustomerCharges: totalCustomerCharges,
//       totalTechCharges: totalTechCharges,

//       // System fields
//       subjectLine: subjectLine || `D2C >> ${location} >> ${taskType} >> Qty: ${noOfVehicles || 0}`,
//       attachedFiles: [...attachedFiles, ...attachments],

//       // String backup fields
//       qstClientNameString: clientDoc?.companyShortName || "D2C",
//       assigneeNameString: assigneeDoc?.name || "System Assignee",
//       taskTypeString: taskDoc?.taskName || "",
//       devicetypeNameString: deviceDoc?.deviceName || "",
//       technicianNameString: techExists?.name || "",

//       // Fixed creator (using assignee as creator)
//       creator: cleanObjectIdField(assignee)
//     };

//     // ------------- Ticket skuId addition and retry methods ------------------
//     const generateTicketSKUId = await getTicketSKUIdGenerator();
//     const MAX_RETRIES = 3;
//     const RETRY_DELAY_MS = 100;
//     let savedTicket;
//     let attempts = 0;
//     let lastError = null;

//     while (attempts < MAX_RETRIES) {
//       try {
//         // Generate new SKU for each attempt
//         const ticketWithSKU = {
//           ...newTicketData,
//           ticketSKUId: await generateTicketSKUId(),
//         };

//         savedTicket = await new Ticket(ticketWithSKU).save();
//         break; // Exit loop if successful
//       } catch (error) {
//         if (error.code === 11000 && error.keyPattern?.ticketSKUId) {
//           // Duplicate SKU error, try again
//           attempts++;
//           if (attempts >= MAX_RETRIES) {
//             const skuError = new Error(
//               "Failed to generate unique ticket ID after multiple attempts. Please try again."
//             );
//             skuError.isSKUGenerationError = true;
//             throw skuError;
//           }
//           await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
//           continue;
//         }
//         // For other errors, break the loop and throw
//         throw error;
//       }
//     }
//     // -----------------------------------------------------

//     // Send email to technician if assigned
//     if (technician && techExists && techExists.email) {
//       try {
//         // Generate security code
//         const securityCode = Math.floor(100000 + Math.random() * 900000).toString();
//         const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

//         // Save security code
//         await securityCodeModel.create({
//           securityCode: securityCode,
//           ticketId: savedTicket._id,
//           technicianId: technician,
//           expiresAt,
//         });

//         const emailContent = generateTechnicianAssignmentEmail(
//           savedTicket.toObject(),
//           techExists,
//           securityCode
//         );

//         await sendEmail({
//           to: techExists.email,
//           subject: emailContent.subject,
//           html: emailContent.html,
//           text: emailContent.text,
//         });

//         console.log(`Notification email sent to technician: ${techExists.email}`);
//       } catch (emailError) {
//         console.error("Failed to send technician assignment email:", emailError);
//         // Don't fail the ticket creation if email fails
//       }
//     }

//     // Populate references for the response
//     const populatedTicket = await Ticket.findById(savedTicket._id)
//       .populate("qstClientName", "companyShortName")
//       .populate("assignee", "name")
//       .populate("taskType", "taskName")
//       .populate("deviceType", "deviceName")
//       .populate("technician", "name")
//       .populate("creator", "name")
//       .populate("qstProjectID", "projectName")
//       .populate("issueFoundRef", "issueFoundName")
//       .populate("resolutionRef", "resolutionName");

//     res.status(201).json({
//       success: true,
//       message: "Ticket created successfully",
//       data: populatedTicket,
//     });
//   } catch (error) {
//     console.error("Error creating ticket:", error);
//     if (error.isSKUGenerationError) {
//       res.status(500).json({
//         success: false,
//         message: error.message,
//         error: process.env.NODE_ENV === "development" ? error.message : undefined,
//       });
//     } else {
//       res.status(500).json({
//         success: false,
//         message: "Internal server error",
//         error: process.env.NODE_ENV === "development" ? error.message : undefined,
//       });
//     }
//   }
// };


// new  (updated controller with updated correct stats proper associated filters and search)
// const getAllTickets = async (req, res) => {
//   try {
//     // Get user information from request
//     const user = req.user; // Assuming this is set by auth middleware
//     if (!user || !user.role) {
//       return res.status(401).json({
//         success: false,
//         message: "Unauthorized - User information missing",
//       });
//     }

//     // Check if user has permission to access tickets
//     if (!["admin", "superAdmin", "cse"].includes(user.role)) {
//       return res.status(403).json({
//         success: false,
//         message: "Forbidden - You don't have permission to access tickets",
//       });
//     }
//     // ------------------------------------------
//     const {
//       page = 1,
//       search,
//       status,
//       fromDate,
//       toDate,
//       // dateType = "updatedDate",
//       dateType ,
//       dueDateFilter,
//     } = req.query;
//     // console.log("query", req.query);
//     const limit = parseInt(req.query.limit) || 10;
//     console.log(dateType);

//     const validDateFields = {
//       creationDate: "createdAt",
//       updatedDate: "updatedAt",
//       dueDate: "dueDate",
//     };

//     // const selectedDateField = validDateFields[dateType] || "updatedAt";
//     const filterDateField = validDateFields[dateType] || "updatedAt";
//     const skip = (page - 1) * limit;

//     // Calculate date ranges for stats
//     const now = new Date();
//     const todayStart = new Date();
//     todayStart.setHours(0, 0, 0, 0);
//     const todayEnd = new Date(todayStart);
//     // todayEnd.setHours(23, 59, 59, 999);
//     todayEnd.setDate(todayEnd.getDate() + 1);

//     const tomorrowStart = new Date(todayStart);
//     tomorrowStart.setDate(tomorrowStart.getDate() + 1);
//     const tomorrowEnd = new Date(tomorrowStart);
//     tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
//     // tomorrowEnd.setHours(23, 59, 59, 999); // ✅ FIXED: Same day, end time

//     const dayAfterStart = new Date(tomorrowStart);
//     dayAfterStart.setDate(dayAfterStart.getDate() + 1);
//     const dayAfterEnd = new Date(dayAfterStart);
//     dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);
//     // dayAfterEnd.setHours(23, 59, 59, 999); // ✅ FIXED: Same day, end time

//     // Build the base query
//     let query = {};
//     // Create a base filter for statistics that will be applied to all stats queries
//     let statsBaseFilter = {};
//     // Add role-based filtering
//     if (user.role === "cse") {
//       // For CSE, only show tickets assigned to them
//       query.assignee = user._id; // Assuming assignee field stores user ID
//       statsBaseFilter.assignee = user._id; // Apply same filter to stats
//     }

//     // Add status filter if provided
//     // Updated status filter
//     if (status && status !== "All Tickets") {
//       // (Only ticket closed show when both work done and is ticket close true)
//       if (status === "Closed") {
//         query.$and = [{ ticketStatus: "work done" }, { isTicketClosed: true }];
//       } else if (status === "Open") {
//         query.$and = [
//           // { ticketStatus: { $ne: "work done" } },
//           { isTicketClosed: { $ne: true } },
//         ];
//       } else if (status === "work done") {
//         // New filter for tickets with status "work done" regardless of isTicketClosed
//         query.$and = [
//           { ticketStatus: "work done" },
//           { isTicketClosed: { $ne: true } },
//         ];
//       }
//     }
//     // Add date range filter if provided
//     if (fromDate && toDate) {
//       const startDate = new Date(`${fromDate}T00:00:00.000Z`);
//       const endDate = new Date(`${toDate}T23:59:59.999Z`);

//       // query[selectedDateField] = {
//       //   $gte: startDate,
//       //   $lt: endDate,
//       // };
//       query[filterDateField] = {
//         $gte: startDate,
//         $lt: endDate,
//       };
//     }

//     // Due date filtering logic
//     // if (dueDateFilter) {
//     //   switch (dueDateFilter) {
//     //     case "today":
//     //       query.dueDate = {
//     //         $gte: todayStart,
//     //         $lt: todayEnd,
//     //       };
//     //       break;
//     //     case "tomorrow":
//     //       query.dueDate = {
//     //         $gte: tomorrowStart,
//     //         $lt: tomorrowEnd,
//     //       };
//     //       break;
//     //     case "dayAfterTomorrow":
//     //       query.dueDate = {
//     //         $gte: dayAfterStart,
//     //         $lt: dayAfterEnd,
//     //       };
//     //       break;
//     //     case "delayed":
//     //       query.dueDate = {
//     //         $lt: todayStart,
//     //       };
//     //       break;
//     //   }
//     // }

//     // Due date filtering logic - exclude work done/closed tickets
// if (dueDateFilter) {
//   const dueDateQuery = {
//     $and: [
//       { ticketStatus: { $ne: "work done" } },  // Exclude work done
//       { isTicketClosed: { $ne: true } }        // Exclude closed tickets
//     ]
//   };

//   switch (dueDateFilter) {
//     case "today":
//       dueDateQuery.$and.push({
//         dueDate: { $gte: todayStart, $lt: todayEnd }
//       });
//       break;
//     case "tomorrow":
//       dueDateQuery.$and.push({
//         dueDate: { $gte: tomorrowStart, $lt: tomorrowEnd }
//       });
//       break;
//     case "dayAfterTomorrow":
//       dueDateQuery.$and.push({
//         dueDate: { $gte: dayAfterStart, $lt: dayAfterEnd }
//       });
//       break;
//     case "delayed":
//       dueDateQuery.$and.push({
//         dueDate: { $lt: todayStart }
//       });
//       break;
//   }

//   // Merge with existing query
//   // query = { ...query, ...dueDateQuery };
//    // Merge with existing query
//   if (Object.keys(query).length > 0) {
//     query = { $and: [query, dueDateQuery] };
//   } else {
//     query = dueDateQuery;
//   }
// }

//     // In search when we get exact correct id then it return that items
//     let objectIdMatch = null;
//     if (mongoose.Types.ObjectId.isValid(search.trim())) {
//       objectIdMatch = new mongoose.Types.ObjectId(search.trim());
//     }

//     // Add search functionality
//     if (search) {
//       const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
//       const safeSearch = escapeRegex(search.trim());
//       const searchRegex = new RegExp(safeSearch, "i");


//        const searchConditions = {
//       $or: [
//         { qstClientTicketNumber: searchRegex },
//         // { "assignee.name": searchRegex },
//         { ticketSKUId: searchRegex },
//         { location: searchRegex },
//         { subjectLine: searchRegex },
//         { "vehicleNumbers.vehicleNumber": searchRegex }, // Vehicle number search
//         ...(objectIdMatch ? [{ _id: objectIdMatch }] : []), // <- exact match on _id
//         // Add this new condition to search in referenced employee names
//         {
//           assignee: {
//             $in: await mongoose
//               .model("Employee")
//               .find({ name: searchRegex })
//               .distinct("_id")
//               .exec(),
//           },
//         },
//       ]
//     };


//   // Combine with existing query using $and
//   if (Object.keys(query).length > 0) {
//     query = { $and: [query, searchConditions] };
//   } else {
//     query = searchConditions; 
//   }
//     }

//     // Get statistics counts - updated logic for open/closed tickets
//     // const statsQueries = [
//     //   // Open tickets - neither work-done nor isTicketClosed true
//     //   Ticket.countDocuments({
//     //     ...statsBaseFilter, // Applied role-based filter
//     //     $and: [
//     //       // { ticketStatus: { $ne: "work done" } },
//     //       { isTicketClosed: { $ne: true } },
//     //     ],
//     //   }),

//     //   // Closed tickets - both workDone and  isTicketClosed true
//     //   Ticket.countDocuments({
//     //     ...statsBaseFilter, // Applied role-based filter
//     //     $and: [{ ticketStatus: "work done" }, { isTicketClosed: true }],
//     //   }),

//     //   // Open tickets due today
//     //   Ticket.countDocuments({
//     //     ...statsBaseFilter, // Applied role-based filter
//     //     $and: [
//     //       // { ticketStatus: { $ne: "work done" } },
//     //       { isTicketClosed: { $ne: true } },
//     //       { dueDate: { $gte: todayStart, $lt: todayEnd } },
//     //     ],
//     //   }),

//     //   // Open tickets due tomorrow
//     //   Ticket.countDocuments({
//     //     ...statsBaseFilter, // Applied role-based filter
//     //     $and: [
//     //       // { ticketStatus: { $ne: "work done" } },
//     //       { isTicketClosed: { $ne: true } },
//     //       { dueDate: { $gte: tomorrowStart, $lt: tomorrowEnd } },
//     //     ],
//     //   }),

//     //   // Open tickets due day after tomorrow
//     //   Ticket.countDocuments({
//     //     ...statsBaseFilter, // Applied role-based filter
//     //     $and: [
//     //       // { ticketStatus: { $ne: "work done" } },
//     //       { isTicketClosed: { $ne: true } },
//     //       { dueDate: { $gte: dayAfterStart, $lt: dayAfterEnd } },
//     //     ],
//     //   }),

//     //   // Delayed open tickets (due date passed)
//     //   Ticket.countDocuments({
//     //     ...statsBaseFilter, // Applied role-based filter
//     //     $and: [
//     //       // { ticketStatus: { $ne: "work-done" } },
//     //       { isTicketClosed: { $ne: true } },
//     //       { dueDate: { $lt: todayStart } },
//     //     ],
//     //   }),
//     // ];

//     const statsQueries = [
//   // Open tickets - exclude tickets with work done OR closed
//   Ticket.countDocuments({
//     ...statsBaseFilter,
//     $and: [
//       { ticketStatus: { $ne: "work done" } },  // Exclude work done
//       { isTicketClosed: { $ne: true } }        // Exclude closed tickets
//     ]
//   }),

//   // Closed tickets - include tickets with work done OR closed
//   Ticket.countDocuments({
//     ...statsBaseFilter,
//     $or: [
//       { ticketStatus: "work done" },  // Include work done
//       { isTicketClosed: true }        // Include closed tickets
//     ]
//   }),

//   // Open tickets due today (exclude work done/closed)
//   Ticket.countDocuments({
//     ...statsBaseFilter,
//     $and: [
//       { ticketStatus: { $ne: "work done" } },
//       { isTicketClosed: { $ne: true } },
//       { dueDate: { $gte: todayStart, $lt: todayEnd } }
//     ]
//   }),

//   // Open tickets due tomorrow (exclude work done/closed)
//   Ticket.countDocuments({
//     ...statsBaseFilter,
//     $and: [
//       { ticketStatus: { $ne: "work done" } },
//       { isTicketClosed: { $ne: true } },
//       { dueDate: { $gte: tomorrowStart, $lt: tomorrowEnd } }
//     ]
//   }),

//   // Open tickets due day after tomorrow (exclude work done/closed)
//   Ticket.countDocuments({
//     ...statsBaseFilter,
//     $and: [
//       { ticketStatus: { $ne: "work done" } },
//       { isTicketClosed: { $ne: true } },
//       { dueDate: { $gte: dayAfterStart, $lt: dayAfterEnd } }
//     ]
//   }),

//   // Delayed open tickets (exclude work done/closed)
//   Ticket.countDocuments({
//     ...statsBaseFilter,
//     $and: [
//       { ticketStatus: { $ne: "work done" } },
//       { isTicketClosed: { $ne: true } },
//       { dueDate: { $lt: todayStart } }
//     ]
//   })
// ];

//     const [
//       openCount,
//       closedCount,
//       todayCount,
//       tomorrowCount,
//       dayAfterCount,
//       delayedCount,
//     ] = await Promise.all(statsQueries);

//     // Get total count for pagination
//     const allTotalTicketCounts = await Ticket.countDocuments(query);

//     //get the value of isTechnicianPaymentSuccessDate for ticket id 689dd6c6893372527da66386
//     const ticketId = "689dd6c6893372527da66386";
//     const ticket = await Ticket.findById(ticketId).select("isTechnicianPaymentSuccessDate");
//     // console.log(ticket,"777777777777777777777777777777777777777777777");
//   // Change the sorting logic to use dueDate as default
// const sortCriteria = {};
// if (dateType === "creationDate") {
//   sortCriteria.createdAt = -1; // Newest first for creation date
// } else if (dateType === "updatedDate") {
//   sortCriteria.updatedAt = -1; // Newest first for updated date
// } else {
//   sortCriteria.dueDate = 1; // Default: Oldest first for due date
// }

//     // Get paginated results also send isTechnicianPaymentSuccessDate in below
//     const tickets = await Ticket.find(query)
//       .select("+isTechnicianPaymentSuccessDate +annexturepaid") // Explicitly include the field
//       .populate("qstClientName", "companyShortName")
//       .populate("assignee", "name _id")
//       .populate("taskType", "taskName")
//       .populate("deviceType", "deviceName")
//       .populate("technician", "name")
//       .populate("creator", "name")
//       .populate("qstProjectID", "projectName _id")
//       .sort(sortCriteria) // Use the dynamic sort criteria
//       // .sort(dateType === "dueDate" ? { dueDate: 1 } : { [selectedDateField]: -1 }) // Modified this line
//       // .sort({ [selectedDateField]: -1 })
//       .skip(skip)
//       .limit(limit);

//     let statsss = {
//       open: openCount,
//       closed: closedCount,
//       dueDateCounts: {
//         today: todayCount,
//         tomorrow: tomorrowCount,
//         dayAfterTomorrow: dayAfterCount,
//         delayed: delayedCount,
//       },
//     };
//     console.log(statsss);
//     console.log(allTotalTicketCounts, "jkjkjkjk");

//     res.status(200).json({
//       success: true,

//       stats: {
//         open: openCount,
//         closed: closedCount,
//         dueDateCounts: {
//           today: todayCount,
//           tomorrow: tomorrowCount,
//           dayAfterTomorrow: dayAfterCount,
//           delayed: delayedCount,
//         },
//       },
//       data: tickets,
//       total: allTotalTicketCounts,
//       page: parseInt(page), // current page
//       pages: Math.ceil(allTotalTicketCounts / limit), // total pages
//     });
//   } catch (error) {
//     console.error("Error fetching tickets:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// };




// ------------v3



// const createNewTicket = async (req, res) => {
//   try {
//     const {
//       // New fields from frontend
//       customerName,
//       mobile,
//       email,
//       pincode,
//       detailedAddress,
//       dashcamBrand,
//       dashcamType,
//       vehicleMake,
//       vehicleModel,
//       price,
//       paymentGateway,

//       // Existing fields with fixed values
//       qstClient = "68fa34baad4d8a1b9653277d", // Fixed D2C client
//       location,
//       taskType,
//       deviceType,
//       vehicleNumbers,
//       oldVehicleNumbers,
//       newVehicleNumbers,
//       noOfVehicles,
//       description,
//       remark,
//       assignee = "684697ddb417aaccbbf3a715", // Fixed assignee
//       projectName,
//       qstClientTicketNo,
//       technician: rawTechnician,
//       imeiNumber,
//       simNumber,
//       issueFound,
//       resolution,
//       techCharges,
//       materialCharges,
//       courierCharges,
//       techConveyance,
//       customerConveyance,
//       ticketStatus = "technician not yet assigned", // Fixed status
//       techAccountNumber,
//       techIfscCode,
//       accountHolder,
//       state,
//       subjectLine,
//       totalTechCharges,
//       customerCharges,
//       totalCustomerCharges,
//       ticketClosureReason,
//       dueDate,
//       qstProjectID,
//       ticketAvailabilityDate,
//     } = req.body;

//     // Handle empty string for technician
//     const technician = rawTechnician === "" ? undefined : rawTechnician;

//     let issueFoundRef = undefined;
//     let resolutionRef = undefined;

//     // Validate required fields - updated with new required fields
//     const requiredFields = {
//       customerName,
//       mobile,
//       location,
//       taskType,
//       state,
//       dueDate,
//     };

//     const missingFields = Object.entries(requiredFields)
//       .filter(([key, value]) => !value)
//       .map(([key]) => key);

//     if (missingFields.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: `Missing required field(s): ${missingFields.join(", ")}`,
//       });
//     }

//     // Validate due date (same as your existing logic)
//     const isPastDate = (date) => {
//       const today = new Date();
//       today.setHours(0, 0, 0, 0);
//       const due = new Date(date);
//       due.setHours(0, 0, 0, 0);
//       return due < today;
//     };

//     if (isPastDate(dueDate)) {
//       return res.status(400).json({
//         success: false,
//         message: "Due date must be today or in the future",
//       });
//     }

//     let attachments = [];

//     // Handle attachments (same as your existing logic)
//     if (typeof req.body.attachments === "string") {
//       try {
//         attachments = JSON.parse(req.body.attachments);
//       } catch (e) {
//         console.error("Failed to parse attachments:", e.message);
//         return res.status(400).json({ 
//           success: false, 
//           message: "Invalid attachments format" 
//         });
//       }
//     } else if (Array.isArray(req.body.attachments)) {
//       attachments = req.body.attachments;
//     } else {
//       console.error("Invalid attachments type:", typeof req.body.attachments);
//       return res.status(400).json({ 
//         success: false, 
//         message: "Attachments must be an array" 
//       });
//     }

//     // Handle file uploads from multipart form data
//     const attachedFiles = req.files ? req.files.map(file => file.filename) : [];

//     // Clean object ID fields (same as your existing logic)
//     const cleanObjectIdField = (value) => {
//       if (value === "" || value === null || value === undefined) {
//         return undefined;
//       }
//       return value;
//     };

//     const handleReferenceField = (value) => {
//       if (value === undefined || value === null || value === "") {
//         return null;
//       }
//       return value;
//     };

//     // Verify references exist (same as your existing logic)
//     const [clientExists, assigneeExists, taskExists, deviceExists, techExists] =
//       await Promise.all([
//         QstClient.exists({ _id: cleanObjectIdField(qstClient) }),
//         Employee.exists({ _id: cleanObjectIdField(assignee) }),
//         Task.exists({ _id: cleanObjectIdField(taskType) }),
//         deviceType
//           ? Device.exists({ _id: cleanObjectIdField(deviceType) })
//           : Promise.resolve(true),
//         technician
//           ? Technician.findById(technician).select("email name _id")
//           : Promise.resolve(null),
//       ]);

//     // Validate references (same as your existing logic)
//     if (technician && !techExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Technician not found" 
//       });
//     }
//     if (!assigneeExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Assignee not found" 
//       });
//     }
//     if (!taskExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Task type not found" 
//       });
//     }
//     if (deviceType && !deviceExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Device type not found" 
//       });
//     }

//     // Validate project ID if provided (same as your existing logic)
//     if (qstProjectID) {
//       const projectExists = await mongoose
//         .model("Project")
//         .exists({ _id: qstProjectID });
//       if (!projectExists) {
//         return res.status(400).json({
//           success: false,
//           message: "Invalid Project ID: Project does not exist.",
//         });
//       }
//     }

//     // Handle vehicle numbers - EXACTLY LIKE YOUR WORKING VERSION
//     let vehicleNumbersArray = [];
//     let oldVehicleNumbersArray = [];
//     let newVehicleNumbersArray = [];
//     let isReinstallation = false;

//     let taskTypeDoc = await Task.findById(taskType);
//     const isServiceTask = taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("service");

//     if (isServiceTask) {
//       // Handle service task specific logic
//       issueFoundRef = handleReferenceField(issueFound);
//       resolutionRef = handleReferenceField(resolution);
//     }

//     if (taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("reinstallation")) {
//       isReinstallation = true;
//       oldVehicleNumbersArray = Array.isArray(oldVehicleNumbers)
//         ? oldVehicleNumbers
//         : oldVehicleNumbers
//         ? oldVehicleNumbers.split(",").map((v) => v.trim())
//         : [];

//       newVehicleNumbersArray = Array.isArray(newVehicleNumbers)
//         ? newVehicleNumbers
//         : newVehicleNumbers
//         ? newVehicleNumbers.split(",").map((v) => v.trim())
//         : [];

//       if (oldVehicleNumbersArray.length !== newVehicleNumbersArray.length) {
//         return res.status(400).json({
//           success: false,
//           message: "Old and New Vehicle Numbers must have the same count",
//         });
//       }
//     } else {
//       vehicleNumbersArray = Array.isArray(vehicleNumbers)
//         ? vehicleNumbers
//         : vehicleNumbers
//         ? vehicleNumbers.split(",").map((v) => v.trim())
//         : [];
//     }

//     // Get string names for backup fields
//     const clientDoc = await QstClient.findById(qstClient);
//     const assigneeDoc = await Employee.findById(assignee);
//     const taskDoc = await Task.findById(taskType);
//     const deviceDoc = deviceType ? await Device.findById(deviceType) : null;

//     // Create the ticket object - EXACTLY LIKE YOUR WORKING VERSION
//     const newTicket = new Ticket({
//       // New customer fields
//       customerName: customerName || '',
//       mobile: mobile || '',
//       email: email || '',
//       pincode: pincode || '',
//       detailedAddress: detailedAddress || '',

//       // New dashcam fields
//       dashcamBrand: dashcamBrand || '',
//       dashcamType: dashcamType || '',

//       // New vehicle fields
//       vehicleMake: vehicleMake || '',
//       vehicleModel: vehicleModel || '',
//       price: price ? Number(price) : 0,

//       // Existing ticket fields
//       qstClientName: cleanObjectIdField(qstClient),
//       taskType: cleanObjectIdField(taskType),
//       deviceType: cleanObjectIdField(deviceType),
//       location,
//       dueDate: new Date(dueDate),
//       ticketAvailabilityDate: ticketAvailabilityDate ? new Date(ticketAvailabilityDate) : null,
//       technician: technician || undefined,
//       oldVehicleNumber: isReinstallation ? oldVehicleNumbersArray : [],
//       vehicleNumbers: isReinstallation
//         ? newVehicleNumbersArray.map((newNumber, index) => ({
//             vehicleNumber: newNumber, // ✅ SAME AS YOUR WORKING VERSION
//             isResinstalationTypeNewVehicalNumber: true,
//           }))
//         : vehicleNumbersArray.map((number) => ({
//             vehicleNumber: number, // ✅ SAME AS YOUR WORKING VERSION
//             isResinstalationTypeNewVehicalNumber: false,
//           })),
//       noOfVehicles: isReinstallation
//         ? oldVehicleNumbersArray.length
//         : vehicleNumbersArray.length,
//       description,
//       remark,
//       assignee: cleanObjectIdField(assignee),
//       qstProjectID: qstProjectID || undefined,
//       qstClientTicketNumber: qstClientTicketNo,
//       qstClientProjectName: projectName,
//       imeiNumbers: imeiNumber ? [imeiNumber] : [],
//       simNumbers: simNumber ? [simNumber] : [],
//       issueFound,
//       resolution,
//       issueFoundRef,
//       resolutionRef,
//       technicianCharges: parseFloat(techCharges) || 0,
//       materialCharges: parseFloat(materialCharges) || 0,
//       courierCharges: parseFloat(courierCharges) || 0,
//       techConveyance: parseFloat(techConveyance) || 0,
//       customerConveyance: parseFloat(customerConveyance) || 0,
//       ticketStatus: ticketStatus,
//       techAccountNumber,
//       techIFSCCode: techIfscCode,
//       accountHolderName: accountHolder,
//       state,
//       subjectLine,
//       totalTechCharges: parseFloat(totalTechCharges) || 0,
//       customerCharges: parseFloat(customerCharges) || 0,
//       totalCustomerCharges: parseFloat(totalCustomerCharges) || 0,
//       reasonForTicketClosure: ticketClosureReason,
//       creator: req.body.user || req.body?.employeeId,

//       // String backup fields
//       qstClientNameString: clientDoc?.companyShortName || "D2C",
//       assigneeNameString: assigneeDoc?.name || "System Assignee",
//       taskTypeString: taskDoc?.taskName || "",
//       devicetypeNameString: deviceDoc?.deviceName || "",
//       technicianNameString: techExists?.name || "",

//       attachedFiles: [
//         ...attachedFiles,
//         ...attachments.map(
//           (file) =>
//             `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${file.key}`
//         )
//       ],
//     });

//     // ------------- Ticket skuId addition and retry methods ------------------
//     // Retry logic for ticket saving - SAME AS YOUR WORKING VERSION
//     const generateTicketSKUId = await getTicketSKUIdGenerator();
//     const MAX_RETRIES = 3;
//     const RETRY_DELAY_MS = 100;
//     let savedTicket;
//     let attempts = 0;
//     let lastError = null;

//     while (attempts < MAX_RETRIES) {
//       try {
//         // Generate new SKU for each attempt
//         const ticketWithSKU = {
//           ...newTicket.toObject(), // Convert to plain object to avoid mongoose doc issues
//           ticketSKUId: await generateTicketSKUId(),
//         };

//         savedTicket = await new Ticket(ticketWithSKU).save();
//         break; // Exit loop if successful
//       } catch (error) {
//         if (error.code === 11000 && error.keyPattern?.ticketSKUId) {
//           // Duplicate SKU error, try again
//           attempts++;
//           if (attempts >= MAX_RETRIES) {
//             const skuError = new Error(
//               "Failed to generate unique ticket ID after multiple attempts. Please try again."
//             );
//             skuError.isSKUGenerationError = true;
//             throw skuError;
//           }
//           await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
//           continue;
//         }
//         // For other errors, break the loop and throw
//         throw error;
//       }
//     }
//     // -----------------------------------------------------

//     // Send email to technician if assigned - SAME AS YOUR WORKING VERSION
//     if (technician && techExists && techExists.email) {
//       try {
//         // Generate security code
//         const securityCode = Math.floor(100000 + Math.random() * 900000).toString();
//         const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

//         // Save security code
//         await securityCodeModel.create({
//           securityCode: securityCode,
//           ticketId: savedTicket._id,
//           technicianId: technician,
//           expiresAt,
//         });

//         const emailContent = generateTechnicianAssignmentEmail(
//           savedTicket.toObject(),
//           techExists,
//           securityCode
//         );

//         await sendEmail({
//           to: techExists.email,
//           subject: emailContent.subject,
//           html: emailContent.html,
//           text: emailContent.text,
//         });

//         console.log(`Notification email sent to technician: ${techExists.email}`);
//       } catch (emailError) {
//         console.error("Failed to send technician assignment email:", emailError);
//         // Don't fail the ticket creation if email fails
//       }
//     }

//     // Populate references for the response
//     const populatedTicket = await Ticket.findById(savedTicket._id)
//       .populate("qstClientName", "companyShortName")
//       .populate("assignee", "name")
//       .populate("taskType", "taskName")
//       .populate("deviceType", "deviceName")
//       .populate("technician", "name")
//       .populate("creator", "name")
//       .populate("qstProjectID", "projectName")
//       .populate("issueFoundRef", "issueFoundName")
//       .populate("resolutionRef", "resolutionName");

//     res.status(201).json({
//       success: true,
//       message: "Ticket created successfully",
//       data: populatedTicket,
//     });
//   } catch (error) {
//     console.error("Error creating ticket:", error);
//     if (error.isSKUGenerationError) {
//       res.status(500).json({
//         success: false,
//         message: error.message,
//         error: process.env.NODE_ENV === "development" ? error.message : undefined,
//       });
//     } else {
//       res.status(500).json({
//         success: false,
//         message: "Internal server error",
//         error: process.env.NODE_ENV === "development" ? error.message : undefined,
//       });
//     }
//   }
// };




// const createNewTicket = async (req, res) => {
//   try {
//     const {
//       // New fields from frontend
//       customerName,
//       mobile,
//       email,
//       pincode,
//       detailedAddress,
//       dashcamBrand,
//       dashcamType,
//       vehicleMake,
//       vehicleModel,
//       price,
//       paymentGateway,

//       // Existing fields with fixed values
//       qstClient = "68fa34baad4d8a1b9653277d", // Fixed D2C client
//       location,
//       taskType,
//       deviceType,
//       vehicleNumbers,
//       oldVehicleNumbers,
//       newVehicleNumbers,
//       noOfVehicles,
//       description,
//       remark,
//       assignee = "684697ddb417aaccbbf3a715", // Fixed assignee
//       projectName,
//       qstClientTicketNo,
//       technician: rawTechnician,
//       imeiNumber,
//       simNumber,
//       issueFound,
//       resolution,
//       techCharges,
//       materialCharges,
//       courierCharges,
//       techConveyance,
//       customerConveyance,
//       ticketStatus = "technician not yet assigned", // Fixed status
//       techAccountNumber,
//       techIfscCode,
//       accountHolder,
//       state,
//       subjectLine,
//       totalTechCharges,
//       customerCharges,
//       totalCustomerCharges,
//       ticketClosureReason,
//       dueDate,
//       qstProjectID,
//       ticketAvailabilityDate,
//       attachments,
//       employeeId, // Make sure this is coming from frontend
//     } = req.body;

//     // Handle empty string for technician
//     const technician = rawTechnician === "" ? undefined : rawTechnician;

//     let issueFoundRef = undefined;
//     let resolutionRef = undefined;

//     // Validate required fields
//     const requiredFields = {
//       customerName,
//       mobile,
//       location,
//       taskType,
//       state,
//       dueDate,
//     };

//     const missingFields = Object.entries(requiredFields)
//       .filter(([key, value]) => !value)
//       .map(([key]) => key);

//     if (missingFields.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: `Missing required field(s): ${missingFields.join(", ")}`,
//       });
//     }

//     // Validate due date
//     const isPastDate = (date) => {
//       const today = new Date();
//       today.setHours(0, 0, 0, 0);
//       const due = new Date(date);
//       due.setHours(0, 0, 0, 0);
//       return due < today;
//     };

//     if (isPastDate(dueDate)) {
//       return res.status(400).json({
//         success: false,
//         message: "Due date must be today or in the future",
//       });
//     }

//     // Handle attachments
//     let finalAttachments = [];
//     if (attachments === undefined || attachments === null) {
//       finalAttachments = [];
//     } else if (typeof attachments === "string") {
//       try {
//         finalAttachments = JSON.parse(attachments);
//         if (!Array.isArray(finalAttachments)) {
//           finalAttachments = [];
//         }
//       } catch (e) {
//         console.error("Failed to parse attachments:", e.message);
//         finalAttachments = [];
//       }
//     } else if (Array.isArray(attachments)) {
//       finalAttachments = attachments;
//     } else {
//       console.warn("Unexpected attachments type:", typeof attachments);
//       finalAttachments = [];
//     }

//     console.log("Processed attachments:", finalAttachments);

//     // Handle file uploads from multipart form data
//     const attachedFiles = req.files ? req.files.map(file => file.filename) : [];

//     // Clean object ID fields
//     const cleanObjectIdField = (value) => {
//       if (value === "" || value === null || value === undefined) {
//         return undefined;
//       }
//       return value;
//     };

//     const handleReferenceField = (value) => {
//       if (value === undefined || value === null || value === "") {
//         return null;
//       }
//       return value;
//     };

//     // FIX 1: Set creator - use employeeId from frontend or default to assignee
//     const creator = cleanObjectIdField(employeeId) || cleanObjectIdField(assignee);

//     // Verify references exist including creator
//     const [clientExists, assigneeExists, taskExists, deviceExists, techExists, creatorExists] =
//       await Promise.all([
//         QstClient.exists({ _id: cleanObjectIdField(qstClient) }),
//         Employee.exists({ _id: cleanObjectIdField(assignee) }),
//         Task.exists({ _id: cleanObjectIdField(taskType) }),
//         deviceType
//           ? Device.exists({ _id: cleanObjectIdField(deviceType) })
//           : Promise.resolve(true),
//         technician
//           ? Technician.findById(technician).select("email name _id")
//           : Promise.resolve(null),
//         Employee.exists({ _id: creator }), // Verify creator exists
//       ]);

//     // Validate references
//     if (technician && !techExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Technician not found" 
//       });
//     }
//     if (!assigneeExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Assignee not found" 
//       });
//     }
//     if (!taskExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Task type not found" 
//       });
//     }
//     if (deviceType && !deviceExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Device type not found" 
//       });
//     }
//     if (!creatorExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Creator not found" 
//       });
//     }

//     // Validate project ID if provided
//     if (qstProjectID) {
//       const projectExists = await mongoose
//         .model("Project")
//         .exists({ _id: qstProjectID });
//       if (!projectExists) {
//         return res.status(400).json({
//           success: false,
//           message: "Invalid Project ID: Project does not exist.",
//         });
//       }
//     }

//     // Handle vehicle numbers - FIX 2: Ensure vehicle numbers are properly formatted
//     let vehicleNumbersArray = [];
//     let oldVehicleNumbersArray = [];
//     let newVehicleNumbersArray = [];
//     let isReinstallation = false;

//     let taskTypeDoc = await Task.findById(taskType);
//     const isServiceTask = taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("service");

//     if (isServiceTask) {
//       // Handle service task specific logic
//       issueFoundRef = handleReferenceField(issueFound);
//       resolutionRef = handleReferenceField(resolution);
//     }

//     if (taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("reinstallation")) {
//       isReinstallation = true;
//       oldVehicleNumbersArray = Array.isArray(oldVehicleNumbers)
//         ? oldVehicleNumbers
//         : oldVehicleNumbers
//         ? oldVehicleNumbers.split(",").map((v) => v.trim()).filter(v => v) // Filter out empty strings
//         : [];

//       newVehicleNumbersArray = Array.isArray(newVehicleNumbers)
//         ? newVehicleNumbers
//         : newVehicleNumbers
//         ? newVehicleNumbers.split(",").map((v) => v.trim()).filter(v => v) // Filter out empty strings
//         : [];

//       if (oldVehicleNumbersArray.length !== newVehicleNumbersArray.length) {
//         return res.status(400).json({
//           success: false,
//           message: "Old and New Vehicle Numbers must have the same count",
//         });
//       }
//     } else {
//       vehicleNumbersArray = Array.isArray(vehicleNumbers)
//         ? vehicleNumbers
//         : vehicleNumbers
//         ? vehicleNumbers.split(",").map((v) => v.trim()).filter(v => v) // Filter out empty strings
//         : [];
//     }

//     // FIX 3: Ensure vehicle numbers objects have required vehicleNumber field
//     const formattedVehicleNumbers = isReinstallation
//       ? newVehicleNumbersArray
//           .filter(vehicle => vehicle && vehicle.trim() !== '') // Filter out empty vehicles
//           .map((newNumber, index) => ({
//             vehicleNumber: newNumber.trim(), // Ensure it's a non-empty string
//             images: [],
//             videoURL: "",
//             isResinstalationTypeNewVehicalNumber: true,
//           }))
//       : vehicleNumbersArray
//           .filter(vehicle => vehicle && vehicle.trim() !== '') // Filter out empty vehicles
//           .map((number) => ({
//             vehicleNumber: number.trim(), // Ensure it's a non-empty string
//             images: [],
//             videoURL: "",
//             isResinstalationTypeNewVehicalNumber: false,
//           }));

//     // Get string names for backup fields
//     const clientDoc = await QstClient.findById(qstClient);
//     const assigneeDoc = await Employee.findById(assignee);
//     const taskDoc = await Task.findById(taskType);
//     const deviceDoc = deviceType ? await Device.findById(deviceType) : null;
//     const creatorDoc = await Employee.findById(creator);

//     // Create the ticket object
//     const newTicket = new Ticket({
//       // New customer fields
//       customerName: customerName || '',
//       mobile: mobile || '',
//       email: email || '',
//       pincode: pincode || '',
//       detailedAddress: detailedAddress || '',

//       // New dashcam fields
//       dashcamBrand: dashcamBrand || '',
//       dashcamType: dashcamType || '',

//       // New vehicle fields
//       vehicleMake: vehicleMake || '',
//       vehicleModel: vehicleModel || '',
//       price: price ? Number(price) : 0,

//       // Existing ticket fields
//       qstClientName: cleanObjectIdField(qstClient),
//       taskType: cleanObjectIdField(taskType),
//       deviceType: cleanObjectIdField(deviceType),
//       location,
//       dueDate: new Date(dueDate),
//       ticketAvailabilityDate: ticketAvailabilityDate ? new Date(ticketAvailabilityDate) : null,
//       technician: technician || undefined,
//       oldVehicleNumber: isReinstallation ? oldVehicleNumbersArray : [],
//       vehicleNumbers: formattedVehicleNumbers, // Use the properly formatted array
//       noOfVehicles: isReinstallation
//         ? oldVehicleNumbersArray.length
//         : vehicleNumbersArray.length,
//       description,
//       remark,
//       assignee: cleanObjectIdField(assignee),
//       qstProjectID: qstProjectID || undefined,
//       qstClientTicketNumber: qstClientTicketNo,
//       qstClientProjectName: projectName,
//       imeiNumbers: imeiNumber ? [imeiNumber] : [],
//       simNumbers: simNumber ? [simNumber] : [],
//       issueFound,
//       resolution,
//       issueFoundRef,
//       resolutionRef,
//       technicianCharges: parseFloat(techCharges) || 0,
//       materialCharges: parseFloat(materialCharges) || 0,
//       courierCharges: parseFloat(courierCharges) || 0,
//       techConveyance: parseFloat(techConveyance) || 0,
//       customerConveyance: parseFloat(customerConveyance) || 0,
//       ticketStatus: ticketStatus,
//       techAccountNumber,
//       techIFSCCode: techIfscCode,
//       accountHolderName: accountHolder,
//       state,
//       subjectLine,
//       totalTechCharges: parseFloat(totalTechCharges) || 0,
//       customerCharges: parseFloat(customerCharges) || 0,
//       totalCustomerCharges: parseFloat(totalCustomerCharges) || 0,
//       reasonForTicketClosure: ticketClosureReason,

//       // FIX 4: Set the creator field
//       creator: creator,

//       // String backup fields
//       qstClientNameString: clientDoc?.companyShortName || "D2C",
//       assigneeNameString: assigneeDoc?.name || "System Assignee",
//       taskTypeString: taskDoc?.taskName || "",
//       devicetypeNameString: deviceDoc?.deviceName || "",
//       technicianNameString: techExists?.name || "",
//       creatorNameString: creatorDoc?.name || "", // Add creator name string

//       // Handle file attachments
//       attachedFiles: [
//         ...attachedFiles,
//         ...finalAttachments.map(
//           (file) =>
//             `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${file.key}`
//         )
//       ],
//     });

//     // Rest of your SKU ID generation and save logic remains the same...
//     const generateTicketSKUId = await getTicketSKUIdGenerator();
//     const MAX_RETRIES = 3;
//     const RETRY_DELAY_MS = 100;
//     let savedTicket;
//     let attempts = 0;

//     while (attempts < MAX_RETRIES) {
//       try {
//         const ticketWithSKU = {
//           ...newTicket.toObject(),
//           ticketSKUId: await generateTicketSKUId(),
//         };

//         savedTicket = await new Ticket(ticketWithSKU).save();
//         break;
//       } catch (error) {
//         if (error.code === 11000 && error.keyPattern?.ticketSKUId) {
//           attempts++;
//           if (attempts >= MAX_RETRIES) {
//             const skuError = new Error(
//               "Failed to generate unique ticket ID after multiple attempts. Please try again."
//             );
//             skuError.isSKUGenerationError = true;
//             throw skuError;
//           }
//           await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
//           continue;
//         }
//         throw error;
//       }
//     }

//     // Send email to technician if assigned
//     if (technician && techExists && techExists.email) {
//       try {
//         const securityCode = Math.floor(100000 + Math.random() * 900000).toString();
//         const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

//         await securityCodeModel.create({
//           securityCode: securityCode,
//           ticketId: savedTicket._id,
//           technicianId: technician,
//           expiresAt,
//         });

//         const emailContent = generateTechnicianAssignmentEmail(
//           savedTicket.toObject(),
//           techExists,
//           securityCode
//         );

//         await sendEmail({
//           to: techExists.email,
//           subject: emailContent.subject,
//           html: emailContent.html,
//           text: emailContent.text,
//         });

//         console.log(`Notification email sent to technician: ${techExists.email}`);
//       } catch (emailError) {
//         console.error("Failed to send technician assignment email:", emailError);
//       }
//     }

//     // Populate references for the response
//     const populatedTicket = await Ticket.findById(savedTicket._id)
//       .populate("qstClientName", "companyShortName")
//       .populate("assignee", "name")
//       .populate("taskType", "taskName")
//       .populate("deviceType", "deviceName")
//       .populate("technician", "name")
//       .populate("creator", "name")
//       .populate("qstProjectID", "projectName")
//       .populate("issueFoundRef", "issueFoundName")
//       .populate("resolutionRef", "resolutionName");

//     res.status(201).json({
//       success: true,
//       message: "Ticket created successfully",
//       data: populatedTicket,
//     });
//   } catch (error) {
//     console.error("Error creating ticket:", error);
//     if (error.isSKUGenerationError) {
//       res.status(500).json({
//         success: false,
//         message: error.message,
//         error: process.env.NODE_ENV === "development" ? error.message : undefined,
//       });
//     } else {
//       res.status(500).json({
//         success: false,
//         message: "Internal server error",
//         error: process.env.NODE_ENV === "development" ? error.message : undefined,
//       });
//     }
//   }
// };


// [[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]

// const createNewTicket = async (req, res) => {
//   try {
//     const {
//       // New fields from frontend
//       customerName,
//       mobile,
//       email,
//       pincode,
//       detailedAddress,
//       dashcamBrand,
//       dashcamType,
//       vehicleMake,
//       vehicleModel,
//       price,
//       paymentGateway,

//       // Existing fields with fixed values
//       qstClient = "68fa34baad4d8a1b9653277d", // Fixed D2C client
//       location,
//       taskType,
//       deviceType,
//       vehicleNumbers,
//       oldVehicleNumbers,
//       newVehicleNumbers,
//       noOfVehicles,
//       description,
//       remark,
//       assignee = "684697ddb417aaccbbf3a715", // Fixed assignee
//       projectName,
//       qstClientTicketNo,
//       technician: rawTechnician,
//       imeiNumber,
//       simNumber,
//       issueFound,
//       resolution,
//       techCharges,
//       materialCharges,
//       courierCharges,
//       techConveyance,
//       customerConveyance,
//       ticketStatus = "technician not yet assigned", // Fixed status
//       techAccountNumber,
//       techIfscCode,
//       accountHolder,
//       state,
//       subjectLine,
//       totalTechCharges,
//       customerCharges,
//       totalCustomerCharges,
//       ticketClosureReason,
//       dueDate,
//       qstProjectID,
//       ticketAvailabilityDate,
//       attachments,
//       employeeId,
//     } = req.body;

//     // Handle empty string for technician
//     const technician = rawTechnician === "" ? undefined : rawTechnician;

//     let issueFoundRef = undefined;
//     let resolutionRef = undefined;

//     // Validate required fields
//     const requiredFields = {
//       customerName,
//       mobile,
//       location,
//       taskType,
//       state,
//       dueDate,
//     };

//     const missingFields = Object.entries(requiredFields)
//       .filter(([key, value]) => !value)
//       .map(([key]) => key);

//     if (missingFields.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: `Missing required field(s): ${missingFields.join(", ")}`,
//       });
//     }

//     // Validate due date
//     const isPastDate = (date) => {
//       const today = new Date();
//       today.setHours(0, 0, 0, 0);
//       const due = new Date(date);
//       due.setHours(0, 0, 0, 0);
//       return due < today;
//     };

//     if (isPastDate(dueDate)) {
//       return res.status(400).json({
//         success: false,
//         message: "Due date must be today or in the future",
//       });
//     }

//     // Handle attachments
//     let finalAttachments = [];
//     if (attachments === undefined || attachments === null) {
//       finalAttachments = [];
//     } else if (typeof attachments === "string") {
//       try {
//         finalAttachments = JSON.parse(attachments);
//         if (!Array.isArray(finalAttachments)) {
//           finalAttachments = [];
//         }
//       } catch (e) {
//         console.error("Failed to parse attachments:", e.message);
//         finalAttachments = [];
//       }
//     } else if (Array.isArray(attachments)) {
//       finalAttachments = attachments;
//     } else {
//       console.warn("Unexpected attachments type:", typeof attachments);
//       finalAttachments = [];
//     }

//     console.log("Processed attachments:", finalAttachments);

//     // Handle file uploads from multipart form data
//     const attachedFiles = req.files ? req.files.map(file => file.filename) : [];

//     // Clean object ID fields
//     const cleanObjectIdField = (value) => {
//       if (value === "" || value === null || value === undefined) {
//         return undefined;
//       }
//       return value;
//     };

//     const handleReferenceField = (value) => {
//       if (value === undefined || value === null || value === "") {
//         return null;
//       }
//       return value;
//     };

//     // Set creator - use employeeId from frontend or default to assignee
//     const creator = cleanObjectIdField(employeeId) || cleanObjectIdField(assignee);

//     // Verify references exist including creator
//     const [clientExists, assigneeExists, taskExists, deviceExists, techExists, creatorExists] =
//       await Promise.all([
//         QstClient.exists({ _id: cleanObjectIdField(qstClient) }),
//         Employee.exists({ _id: cleanObjectIdField(assignee) }),
//         Task.exists({ _id: cleanObjectIdField(taskType) }),
//         deviceType
//           ? Device.exists({ _id: cleanObjectIdField(deviceType) })
//           : Promise.resolve(true),
//         technician
//           ? Technician.findById(technician).select("email name _id")
//           : Promise.resolve(null),
//         Employee.exists({ _id: creator }),
//       ]);

//     // Validate references
//     if (technician && !techExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Technician not found" 
//       });
//     }
//     if (!assigneeExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Assignee not found" 
//       });
//     }
//     if (!taskExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Task type not found" 
//       });
//     }
//     if (deviceType && !deviceExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Device type not found" 
//       });
//     }
//     if (!creatorExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Creator not found" 
//       });
//     }

//     // Validate project ID if provided
//     if (qstProjectID) {
//       const projectExists = await mongoose
//         .model("Project")
//         .exists({ _id: qstProjectID });
//       if (!projectExists) {
//         return res.status(400).json({
//           success: false,
//           message: "Invalid Project ID: Project does not exist.",
//         });
//       }
//     }

//     // Handle vehicle numbers
//     let vehicleNumbersArray = [];
//     let oldVehicleNumbersArray = [];
//     let newVehicleNumbersArray = [];
//     let isReinstallation = false;

//     let taskTypeDoc = await Task.findById(taskType);
//     const isServiceTask = taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("service");

//     if (isServiceTask) {
//       // Handle service task specific logic
//       issueFoundRef = handleReferenceField(issueFound);
//       resolutionRef = handleReferenceField(resolution);
//     }

//     if (taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("reinstallation")) {
//       isReinstallation = true;
//       oldVehicleNumbersArray = Array.isArray(oldVehicleNumbers)
//         ? oldVehicleNumbers
//         : oldVehicleNumbers
//         ? oldVehicleNumbers.split(",").map((v) => v.trim()).filter(v => v)
//         : [];

//       newVehicleNumbersArray = Array.isArray(newVehicleNumbers)
//         ? newVehicleNumbers
//         : newVehicleNumbers
//         ? newVehicleNumbers.split(",").map((v) => v.trim()).filter(v => v)
//         : [];

//       if (oldVehicleNumbersArray.length !== newVehicleNumbersArray.length) {
//         return res.status(400).json({
//           success: false,
//           message: "Old and New Vehicle Numbers must have the same count",
//         });
//       }
//     } else {
//       vehicleNumbersArray = Array.isArray(vehicleNumbers)
//         ? vehicleNumbers
//         : vehicleNumbers
//         ? vehicleNumbers.split(",").map((v) => v.trim()).filter(v => v)
//         : [];
//     }

//     // Debug vehicle numbers
//     console.log("Raw vehicleNumbers:", vehicleNumbers);
//     console.log("Type of vehicleNumbers:", typeof vehicleNumbers);
//     console.log("Is array?", Array.isArray(vehicleNumbers));

//     // FIXED: Proper vehicle numbers formatting
//     const formatVehicleNumbers = (vehicles, isReinstall = false) => {
//       if (!vehicles || !Array.isArray(vehicles)) {
//         return [];
//       }

//       return vehicles
//         .map(vehicle => {
//           // If vehicle is already an object with vehicleNumber
//           if (typeof vehicle === 'object' && vehicle.vehicleNumber) {
//             return {
//               vehicleNumber: String(vehicle.vehicleNumber).trim(),
//               images: vehicle.images || [],
//               videoURL: vehicle.videoURL || "",
//               isResinstalationTypeNewVehicalNumber: isReinstall
//             };
//           }
//           // If vehicle is a simple string
//           else if (typeof vehicle === 'string') {
//             return {
//               vehicleNumber: vehicle.trim(),
//               images: [],
//               videoURL: "",
//               isResinstalationTypeNewVehicalNumber: isReinstall
//             };
//           }
//           // If vehicle is any other type, convert to string
//           else {
//             return {
//               vehicleNumber: String(vehicle).trim(),
//               images: [],
//               videoURL: "",
//               isResinstalationTypeNewVehicalNumber: isReinstall
//             };
//           }
//         })
//         .filter(vehicle => vehicle.vehicleNumber && vehicle.vehicleNumber.trim() !== '');
//     };

//     // Use the fixed formatting function
//     const formattedVehicleNumbers = isReinstallation
//       ? formatVehicleNumbers(newVehicleNumbersArray, true)
//       : formatVehicleNumbers(vehicleNumbersArray, false);

//     console.log("Formatted vehicle numbers:", formattedVehicleNumbers);

//     // Get string names for backup fields
//     const clientDoc = await QstClient.findById(qstClient);
//     const assigneeDoc = await Employee.findById(assignee);
//     const taskDoc = await Task.findById(taskType);
//     const deviceDoc = deviceType ? await Device.findById(deviceType) : null;
//     const creatorDoc = await Employee.findById(creator);

//     // Create the ticket object
//     const newTicket = new Ticket({
//       // New customer fields
//       customerName: customerName || '',
//       mobile: mobile || '',
//       email: email || '',
//       pincode: pincode || '',
//       detailedAddress: detailedAddress || '',

//       // New dashcam fields
//       dashcamBrand: dashcamBrand || '',
//       dashcamType: dashcamType || '',

//       // New vehicle fields
//       vehicleMake: vehicleMake || '',
//       vehicleModel: vehicleModel || '',
//       price: price ? Number(price) : 0,

//       // Existing ticket fields
//       qstClientName: cleanObjectIdField(qstClient),
//       taskType: cleanObjectIdField(taskType),
//       deviceType: cleanObjectIdField(deviceType),
//       location,
//       dueDate: new Date(dueDate),
//       ticketAvailabilityDate: ticketAvailabilityDate ? new Date(ticketAvailabilityDate) : null,
//       technician: technician || undefined,
//       oldVehicleNumber: isReinstallation ? oldVehicleNumbersArray : [],
//       vehicleNumbers: formattedVehicleNumbers,
//       noOfVehicles: formattedVehicleNumbers.length,
//       description,
//       remark,
//       assignee: cleanObjectIdField(assignee),
//       qstProjectID: qstProjectID || undefined,
//       qstClientTicketNumber: qstClientTicketNo,
//       qstClientProjectName: projectName,
//       imeiNumbers: imeiNumber ? [imeiNumber] : [],
//       simNumbers: simNumber ? [simNumber] : [],
//       issueFound,
//       resolution,
//       issueFoundRef,
//       resolutionRef,
//       technicianCharges: parseFloat(techCharges) || 0,
//       materialCharges: parseFloat(materialCharges) || 0,
//       courierCharges: parseFloat(courierCharges) || 0,
//       techConveyance: parseFloat(techConveyance) || 0,
//       customerConveyance: parseFloat(customerConveyance) || 0,
//       ticketStatus: ticketStatus,
//       techAccountNumber,
//       techIFSCCode: techIfscCode,
//       accountHolderName: accountHolder,
//       state,
//       subjectLine,
//       totalTechCharges: parseFloat(totalTechCharges) || 0,
//       customerCharges: parseFloat(customerCharges) || 0,
//       totalCustomerCharges: parseFloat(totalCustomerCharges) || 0,
//       reasonForTicketClosure: ticketClosureReason,

//       // Set the creator field
//       creator: creator,

//       // String backup fields
//       qstClientNameString: clientDoc?.companyShortName || "D2C",
//       assigneeNameString: assigneeDoc?.name || "System Assignee",
//       taskTypeString: taskDoc?.taskName || "",
//       devicetypeNameString: deviceDoc?.deviceName || "",
//       technicianNameString: techExists?.name || "",
//       creatorNameString: creatorDoc?.name || "",

//       // Handle file attachments
//       attachedFiles: [
//         ...attachedFiles,
//         ...finalAttachments.map(
//           (file) =>
//             `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${file.key}`
//         )
//       ],
//     });

//     // ------------- Ticket skuId addition and retry methods ------------------
//     const generateTicketSKUId = await getTicketSKUIdGenerator();
//     const MAX_RETRIES = 3;
//     const RETRY_DELAY_MS = 100;
//     let savedTicket;
//     let attempts = 0;

//     while (attempts < MAX_RETRIES) {
//       try {
//         const ticketWithSKU = {
//           ...newTicket.toObject(),
//           ticketSKUId: await generateTicketSKUId(),
//         };

//         savedTicket = await new Ticket(ticketWithSKU).save();
//         break;
//       } catch (error) {
//         if (error.code === 11000 && error.keyPattern?.ticketSKUId) {
//           attempts++;
//           if (attempts >= MAX_RETRIES) {
//             const skuError = new Error(
//               "Failed to generate unique ticket ID after multiple attempts. Please try again."
//             );
//             skuError.isSKUGenerationError = true;
//             throw skuError;
//           }
//           await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
//           continue;
//         }
//         throw error;
//       }
//     }

//     // Send email to technician if assigned
//     if (technician && techExists && techExists.email) {
//       try {
//         const securityCode = Math.floor(100000 + Math.random() * 900000).toString();
//         const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

//         await securityCodeModel.create({
//           securityCode: securityCode,
//           ticketId: savedTicket._id,
//           technicianId: technician,
//           expiresAt,
//         });

//         const emailContent = generateTechnicianAssignmentEmail(
//           savedTicket.toObject(),
//           techExists,
//           securityCode
//         );

//         await sendEmail({
//           to: techExists.email,
//           subject: emailContent.subject,
//           html: emailContent.html,
//           text: emailContent.text,
//         });

//         console.log(`Notification email sent to technician: ${techExists.email}`);
//       } catch (emailError) {
//         console.error("Failed to send technician assignment email:", emailError);
//       }
//     }

//     // Populate references for the response
//     const populatedTicket = await Ticket.findById(savedTicket._id)
//       .populate("qstClientName", "companyShortName")
//       .populate("assignee", "name")
//       .populate("taskType", "taskName")
//       .populate("deviceType", "deviceName")
//       .populate("technician", "name")
//       .populate("creator", "name")
//       .populate("qstProjectID", "projectName")
//       .populate("issueFoundRef", "issueFoundName")
//       .populate("resolutionRef", "resolutionName");

//     res.status(201).json({
//       success: true,
//       message: "Ticket created successfully",
//       data: populatedTicket,
//     });
//   } catch (error) {
//     console.error("Error creating ticket:", error);
//     if (error.isSKUGenerationError) {
//       res.status(500).json({
//         success: false,
//         message: error.message,
//         error: process.env.NODE_ENV === "development" ? error.message : undefined,
//       });
//     } else {
//       res.status(500).json({
//         success: false,
//         message: "Internal server error",
//         error: process.env.NODE_ENV === "development" ? error.message : undefined,
//       });
//     }
//   }
// };

//  [[[[[[[[[[[[[[[[[[[[[[]]]]]]]]]]]]]]]]]]]]]]


// const createNewTicket = async (req, res) => {
//   try {
//     const {
//       // New fields from frontend
//       customerName,
//       mobile,
//       email,
//       pincode,
//       detailedAddress,
//       dashcamBrand,
//       dashcamType,
//       vehicleMake,
//       vehicleModel,
//       price,
//       paymentGateway,

//       // Existing fields with fixed values
//       qstClient = "68fa34baad4d8a1b9653277d", // Fixed D2C client
//       location,
//       taskType,
//       deviceType,
//       vehicleNumbers,
//       oldVehicleNumbers,
//       newVehicleNumbers,
//       noOfVehicles,
//       description,
//       remark,
//       assignee, // Will be auto-assigned
//       // assignee = "684697ddb417aaccbbf3a715", // Fixed assignee
//       projectName,
//       qstClientTicketNo,
//       technician: rawTechnician,
//       imeiNumber,
//       simNumber,
//       issueFound,
//       resolution,
//       techCharges,
//       materialCharges,
//       courierCharges,
//       techConveyance,
//       customerConveyance,
//       ticketStatus = "technician not yet assigned", // Fixed status
//       techAccountNumber,
//       techIfscCode,
//       accountHolder,
//       state,
//       subjectLine,
//       totalTechCharges,
//       customerCharges,
//       totalCustomerCharges,
//       ticketClosureReason,
//       dueDate,
//       qstProjectID,
//       ticketAvailabilityDate,
//       attachments,
//       employeeId,
//     } = req.body;

//     // Handle empty string for technician
//     const technician = rawTechnician === "" ? undefined : rawTechnician;

//     let issueFoundRef = undefined;
//     let resolutionRef = undefined;

//     // Validate required fields
//     const requiredFields = {
//       customerName,
//       mobile,
//       location,
//       taskType,
//       state,
//       dueDate,
//     };

//     const missingFields = Object.entries(requiredFields)
//       .filter(([key, value]) => !value)
//       .map(([key]) => key);

//     if (missingFields.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: `Missing required field(s): ${missingFields.join(", ")}`,
//       });
//     }

//     // Validate due date
//     const isPastDate = (date) => {
//       const today = new Date();
//       today.setHours(0, 0, 0, 0);
//       const due = new Date(date);
//       due.setHours(0, 0, 0, 0);
//       return due < today;
//     };

//     if (isPastDate(dueDate)) {
//       return res.status(400).json({
//         success: false,
//         message: "Due date must be today or in the future",
//       });
//     }

//     // ============ AUTO-ASSIGNMENT LOGIC ============
// // Get state name from database for assignment
// const stateData = await State.findById(state).select("name");
// if (!stateData) {
//   return res.status(400).json({
//     success: false,
//     message: "Invalid state ID",
//   });
// }
// const stateName = stateData.name;

// // Auto-assign employee based on state and workload
// const assignedEmployee = await findBestEmployeeForState(state, dueDate);

// if (!assignedEmployee) {
//   return res.status(400).json({
//     success: false,
//     message: "No available employees for the selected state",
//   });
// }

// // Use the auto-assigned employee
// const autoAssignedEmployeeId = assignedEmployee._id;
// const autoAssignedEmployeeName = assignedEmployee.name;

// console.log(`Auto-assigned employee: ${autoAssignedEmployeeName} for state: ${stateName}`);
// // ============ END AUTO-ASSIGNMENT LOGIC ============

//     // Handle attachments
//     let finalAttachments = [];
//     if (attachments === undefined || attachments === null) {
//       finalAttachments = [];
//     } else if (typeof attachments === "string") {
//       try {
//         finalAttachments = JSON.parse(attachments);
//         if (!Array.isArray(finalAttachments)) {
//           finalAttachments = [];
//         }
//       } catch (e) {
//         console.error("Failed to parse attachments:", e.message);
//         finalAttachments = [];
//       }
//     } else if (Array.isArray(attachments)) {
//       finalAttachments = attachments;
//     } else {
//       console.warn("Unexpected attachments type:", typeof attachments);
//       finalAttachments = [];
//     }

//     console.log("Processed attachments:", finalAttachments);

//     // Handle file uploads from multipart form data
//     const attachedFiles = req.files ? req.files.map(file => file.filename) : [];

//     // Clean object ID fields
//     const cleanObjectIdField = (value) => {
//       if (value === "" || value === null || value === undefined) {
//         return undefined;
//       }
//       return value;
//     };

//     const handleReferenceField = (value) => {
//       if (value === undefined || value === null || value === "") {
//         return null;
//       }
//       return value;
//     };

//     // Set creator - use employeeId from frontend or default to assignee
//     // const creator = cleanObjectIdField(employeeId) || cleanObjectIdField(assignee);
//     const creator = cleanObjectIdField(employeeId) || autoAssignedEmployeeId;

//     // Verify references exist including creator
//     // const [clientExists, assigneeExists, taskExists, deviceExists, techExists, creatorExists] =
//     //   await Promise.all([
//     //     QstClient.exists({ _id: cleanObjectIdField(qstClient) }),
//     //     Employee.exists({ _id: cleanObjectIdField(assignee) }),
//     //     Task.exists({ _id: cleanObjectIdField(taskType) }),
//     //     deviceType
//     //       ? Device.exists({ _id: cleanObjectIdField(deviceType) })
//     //       : Promise.resolve(true),
//     //     technician
//     //       ? Technician.findById(technician).select("email name _id")
//     //       : Promise.resolve(null),
//     //     Employee.exists({ _id: creator }),
//     //   ]);

//     const [clientExists, assigneeExists, taskExists, deviceExists, techExists, creatorExists] =
//   await Promise.all([
//     QstClient.exists({ _id: cleanObjectIdField(qstClient) }),
//     Employee.exists({ _id: autoAssignedEmployeeId }), // Use auto-assigned employee
//     Task.exists({ _id: cleanObjectIdField(taskType) }),
//     deviceType
//       ? Device.exists({ _id: cleanObjectIdField(deviceType) })
//       : Promise.resolve(true),
//     technician
//       ? Technician.findById(technician).select("email name _id")
//       : Promise.resolve(null),
//     Employee.exists({ _id: creator }),
//   ]);

//     // Validate references
//     if (technician && !techExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Technician not found" 
//       });
//     }
//     if (!assigneeExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Assignee not found" 
//       });
//     }
//     if (!taskExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Task type not found" 
//       });
//     }
//     if (deviceType && !deviceExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Device type not found" 
//       });
//     }
//     if (!creatorExists) {
//       return res.status(404).json({ 
//         success: false, 
//         message: "Creator not found" 
//       });
//     }

//     // Validate project ID if provided
//     if (qstProjectID) {
//       const projectExists = await mongoose
//         .model("Project")
//         .exists({ _id: qstProjectID });
//       if (!projectExists) {
//         return res.status(400).json({
//           success: false,
//           message: "Invalid Project ID: Project does not exist.",
//         });
//       }
//     }

//     // Handle vehicle numbers
//     let vehicleNumbersArray = [];
//     let oldVehicleNumbersArray = [];
//     let newVehicleNumbersArray = [];
//     let isReinstallation = false;

//     let taskTypeDoc = await Task.findById(taskType);
//     const isServiceTask = taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("service");

//     if (isServiceTask) {
//       // Handle service task specific logic
//       issueFoundRef = handleReferenceField(issueFound);
//       resolutionRef = handleReferenceField(resolution);
//     }

//     if (taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("reinstallation")) {
//       isReinstallation = true;
//       oldVehicleNumbersArray = Array.isArray(oldVehicleNumbers)
//         ? oldVehicleNumbers
//         : oldVehicleNumbers
//         ? oldVehicleNumbers.split(",").map((v) => v.trim()).filter(v => v)
//         : [];

//       newVehicleNumbersArray = Array.isArray(newVehicleNumbers)
//         ? newVehicleNumbers
//         : newVehicleNumbers
//         ? newVehicleNumbers.split(",").map((v) => v.trim()).filter(v => v)
//         : [];

//       if (oldVehicleNumbersArray.length !== newVehicleNumbersArray.length) {
//         return res.status(400).json({
//           success: false,
//           message: "Old and New Vehicle Numbers must have the same count",
//         });
//       }
//     } else {
//       vehicleNumbersArray = Array.isArray(vehicleNumbers)
//         ? vehicleNumbers
//         : vehicleNumbers
//         ? vehicleNumbers.split(",").map((v) => v.trim()).filter(v => v)
//         : [];
//     }

//     // Debug vehicle numbers
//     console.log("Raw vehicleNumbers:", vehicleNumbers);
//     console.log("Type of vehicleNumbers:", typeof vehicleNumbers);
//     console.log("Is array?", Array.isArray(vehicleNumbers));

//     // FIXED: Proper vehicle numbers formatting
//     const formatVehicleNumbers = (vehicles, isReinstall = false) => {
//       if (!vehicles || !Array.isArray(vehicles)) {
//         return [];
//       }

//       return vehicles
//         .map(vehicle => {
//           // If vehicle is already an object with vehicleNumber
//           if (typeof vehicle === 'object' && vehicle.vehicleNumber) {
//             return {
//               vehicleNumber: String(vehicle.vehicleNumber).trim(),
//               images: vehicle.images || [],
//               videoURL: vehicle.videoURL || "",
//               isResinstalationTypeNewVehicalNumber: isReinstall
//             };
//           }
//           // If vehicle is a simple string
//           else if (typeof vehicle === 'string') {
//             return {
//               vehicleNumber: vehicle.trim(),
//               images: [],
//               videoURL: "",
//               isResinstalationTypeNewVehicalNumber: isReinstall
//             };
//           }
//           // If vehicle is any other type, convert to string
//           else {
//             return {
//               vehicleNumber: String(vehicle).trim(),
//               images: [],
//               videoURL: "",
//               isResinstalationTypeNewVehicalNumber: isReinstall
//             };
//           }
//         })
//         .filter(vehicle => vehicle.vehicleNumber && vehicle.vehicleNumber.trim() !== '');
//     };

//     // Use the fixed formatting function
//     const formattedVehicleNumbers = isReinstallation
//       ? formatVehicleNumbers(newVehicleNumbersArray, true)
//       : formatVehicleNumbers(vehicleNumbersArray, false);

//     console.log("Formatted vehicle numbers:", formattedVehicleNumbers);

//     // Get string names for backup fields
//     const clientDoc = await QstClient.findById(qstClient);
//     // const assigneeDoc = await Employee.findById(assignee);
//     const assigneeDoc = await Employee.findById(autoAssignedEmployeeId); // Use auto-assigned employee
//     const taskDoc = await Task.findById(taskType);
//     const deviceDoc = deviceType ? await Device.findById(deviceType) : null;
//     const creatorDoc = await Employee.findById(creator);

//     // Create the ticket object
//     const newTicket = new Ticket({
//       // New customer fields
//       customerName: customerName || '',
//       mobile: mobile || '',
//       email: email || '',
//       pincode: pincode || '',
//       detailedAddress: detailedAddress || '',

//       // New dashcam fields
//       dashcamBrand: dashcamBrand || '',
//       dashcamType: dashcamType || '',

//       // New vehicle fields
//       vehicleMake: vehicleMake || '',
//       vehicleModel: vehicleModel || '',
//       price: price ? Number(price) : 0,

//       // Existing ticket fields
//       qstClientName: cleanObjectIdField(qstClient),
//       taskType: cleanObjectIdField(taskType),
//       deviceType: cleanObjectIdField(deviceType),
//       location,
//       dueDate: new Date(dueDate),
//       ticketAvailabilityDate: ticketAvailabilityDate ? new Date(ticketAvailabilityDate) : null,
//       technician: technician || undefined,
//       oldVehicleNumber: isReinstallation ? oldVehicleNumbersArray : [],
//       vehicleNumbers: formattedVehicleNumbers,
//       noOfVehicles: formattedVehicleNumbers.length,
//       description,
//       remark,
//       // assignee: cleanObjectIdField(assignee),
//       assignee: autoAssignedEmployeeId, // Use auto-assigned employee
//       qstProjectID: qstProjectID || undefined,
//       qstClientTicketNumber: qstClientTicketNo,
//       qstClientProjectName: projectName,
//       imeiNumbers: imeiNumber ? [imeiNumber] : [],
//       simNumbers: simNumber ? [simNumber] : [],
//       issueFound,
//       resolution,
//       issueFoundRef,
//       resolutionRef,
//       technicianCharges: parseFloat(techCharges) || 0,
//       materialCharges: parseFloat(materialCharges) || 0,
//       courierCharges: parseFloat(courierCharges) || 0,
//       techConveyance: parseFloat(techConveyance) || 0,
//       customerConveyance: parseFloat(customerConveyance) || 0,
//       ticketStatus: ticketStatus,
//       techAccountNumber,
//       techIFSCCode: techIfscCode,
//       accountHolderName: accountHolder,
//       state: stateName, // Use state name from database
//       // state,
//       subjectLine,
//       totalTechCharges: parseFloat(totalTechCharges) || 0,
//       customerCharges: parseFloat(customerCharges) || 0,
//       totalCustomerCharges: parseFloat(totalCustomerCharges) || 0,
//       reasonForTicketClosure: ticketClosureReason,

//       // Set the creator field
//       creator: creator,

//       // String backup fields
//       qstClientNameString: clientDoc?.companyShortName || "D2C",
//       // assigneeNameString: assigneeDoc?.name || "System Assignee",
//       assigneeNameString: autoAssignedEmployeeName || "System Assignee", // Use auto-assigned employee name directly
//       taskTypeString: taskDoc?.taskName || "",
//       devicetypeNameString: deviceDoc?.deviceName || "",
//       technicianNameString: techExists?.name || "",
//       creatorNameString: creatorDoc?.name || "",

//       // Auto-assignment flag
//   autoAssigned: true, // Flag to indicate auto-assignment

//       // Handle file attachments
//       attachedFiles: [
//         ...attachedFiles,
//         ...finalAttachments.map(
//           (file) =>
//             `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${file.key}`
//         )
//       ],
//     });

//     // ------------- Ticket skuId addition and retry methods ------------------
//     const generateTicketSKUId = await getTicketSKUIdGenerator();
//     const MAX_RETRIES = 3;
//     const RETRY_DELAY_MS = 100;
//     let savedTicket;
//     let attempts = 0;

//     while (attempts < MAX_RETRIES) {
//       try {
//         const ticketWithSKU = {
//           ...newTicket.toObject(),
//           ticketSKUId: await generateTicketSKUId(),
//         };

//         savedTicket = await new Ticket(ticketWithSKU).save();
//         break;
//       } catch (error) {
//         if (error.code === 11000 && error.keyPattern?.ticketSKUId) {
//           attempts++;
//           if (attempts >= MAX_RETRIES) {
//             const skuError = new Error(
//               "Failed to generate unique ticket ID after multiple attempts. Please try again."
//             );
//             skuError.isSKUGenerationError = true;
//             throw skuError;
//           }
//           await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
//           continue;
//         }
//         throw error;
//       }
//     }

//     // Send email to technician if assigned
//     if (technician && techExists && techExists.email) {
//       try {
//         const securityCode = Math.floor(100000 + Math.random() * 900000).toString();
//         const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

//         await securityCodeModel.create({
//           securityCode: securityCode,
//           ticketId: savedTicket._id,
//           technicianId: technician,
//           expiresAt,
//         });

//         const emailContent = generateTechnicianAssignmentEmail(
//           savedTicket.toObject(),
//           techExists,
//           securityCode
//         );

//         await sendEmail({
//           to: techExists.email,
//           subject: emailContent.subject,
//           html: emailContent.html,
//           text: emailContent.text,
//         });

//         console.log(`Notification email sent to technician: ${techExists.email}`);
//       } catch (emailError) {
//         console.error("Failed to send technician assignment email:", emailError);
//       }
//     }

//     // Populate references for the response
//     const populatedTicket = await Ticket.findById(savedTicket._id)
//       .populate("qstClientName", "companyShortName")
//       .populate("assignee", "name")
//       .populate("taskType", "taskName")
//       .populate("deviceType", "deviceName")
//       .populate("technician", "name")
//       .populate("creator", "name")
//       .populate("qstProjectID", "projectName")
//       .populate("issueFoundRef", "issueFoundName")
//       .populate("resolutionRef", "resolutionName");

//     res.status(201).json({
//       success: true,
//       message: "Ticket created successfully",
//       data: populatedTicket,
//     });
//   } catch (error) {
//     console.error("Error creating ticket:", error);
//     if (error.isSKUGenerationError) {
//       res.status(500).json({
//         success: false,
//         message: error.message,
//         error: process.env.NODE_ENV === "development" ? error.message : undefined,
//       });
//     } else {
//       res.status(500).json({
//         success: false,
//         message: "Internal server error",
//         error: process.env.NODE_ENV === "development" ? error.message : undefined,
//       });
//     }
//   }
// };




const createNewTicket = async (req, res) => {
  try {
    const {
      // New fields from frontend
      customerName,
      mobile,
      email,
      pincode,
      detailedAddress,
      dashcamBrand,
      dashcamType,
      vehicleMake,
      vehicleModel,
      price,
      paymentGateway,
      // NEW: Terms agreement
      agreedToTerms,
      vehicleRegistrationNumber,

      // Existing fields with fixed values
      // qstClient = "68fa34baad4d8a1b9653277d", // Fixed D2C client  in our side 
      qstClient = "69021b71982bf50d1f5ff489", // Fixed D2C client
      location,
      taskType,
      deviceType,
      vehicleNumbers,
      oldVehicleNumbers,
      newVehicleNumbers,
      noOfVehicles,
      description,
      remark,
      projectName,
      qstClientTicketNo,
      technician: rawTechnician,
      imeiNumber,
      simNumber,
      issueFound,
      resolution,
      techCharges,
      materialCharges,
      courierCharges,
      techConveyance,
      customerConveyance,
      ticketStatus = "technician not yet assigned", // Fixed status
      techAccountNumber,
      techIfscCode,
      accountHolder,
      state,
      subjectLine,
      totalTechCharges,
      customerCharges,
      totalCustomerCharges,
      ticketClosureReason,
      dueDate,
      qstProjectID,
      ticketAvailabilityDate,
      attachments,
      employeeId,
      isPaymentReceived,
    } = req.body;

    console.log("Ticket generation incoming data : ", req.body);

    // Handle empty string for technician
    const technician = rawTechnician === "" ? undefined : rawTechnician;

    let issueFoundRef = undefined;
    let resolutionRef = undefined;

    // Validate required fields
    const requiredFields = {
      customerName,
      mobile,
      location,
      taskType,
      state,
      dueDate,
    };

    const missingFields = Object.entries(requiredFields)
      .filter(([key, value]) => !value)
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required field(s): ${missingFields.join(", ")}`,
      });
    }

    // Validate terms agreement
    if (!agreedToTerms) {
      return res.status(400).json({
        success: false,
        message: "You must agree to the Terms & Conditions to create a ticket",
      });
    }

    // Validate due date
    const isPastDate = (date) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const due = new Date(date);
      due.setHours(0, 0, 0, 0);
      return due < today;
    };

    if (isPastDate(dueDate)) {
      return res.status(400).json({
        success: false,
        message: "Due date must be today or in the future",
      });
    }

    // ============ FIXED ASSIGNEE LOGIC ============
    const fixedAssigneeId = "6899bcdf7b75e685d0b89436"; // this is for local
    // const fixedAssigneeId = "68a4118fe7c3c6445b715271"; // this is for live

    // Verify the fixed assignee exists
    const fixedAssigneeExists = await Employee.exists({ _id: fixedAssigneeId });
    if (!fixedAssigneeExists) {
      return res.status(400).json({
        success: false,
        message: "Fixed assignee not found in system",
      });
    }

    // Get assignee details
    const fixedAssigneeDoc = await Employee.findById(fixedAssigneeId);
    const fixedAssigneeName = fixedAssigneeDoc?.name || "Fixed Assignee";

    console.log(`Using fixed assignee: ${fixedAssigneeName} (${fixedAssigneeId})`);
    // ============ END FIXED ASSIGNEE LOGIC ============

    // Handle attachments
    let finalAttachments = [];
    if (attachments === undefined || attachments === null) {
      finalAttachments = [];
    } else if (typeof attachments === "string") {
      try {
        finalAttachments = JSON.parse(attachments);
        if (!Array.isArray(finalAttachments)) {
          finalAttachments = [];
        }
      } catch (e) {
        console.error("Failed to parse attachments:", e.message);
        finalAttachments = [];
      }
    } else if (Array.isArray(attachments)) {
      finalAttachments = attachments;
    } else {
      console.warn("Unexpected attachments type:", typeof attachments);
      finalAttachments = [];
    }

    console.log("Processed attachments:", finalAttachments);

    // Handle file uploads from multipart form data
    const attachedFiles = req.files ? req.files.map(file => file.filename) : [];

    // Clean object ID fields
    const cleanObjectIdField = (value) => {
      if (value === "" || value === null || value === undefined) {
        return undefined;
      }
      return value;
    };

    const handleReferenceField = (value) => {
      if (value === undefined || value === null || value === "") {
        return null;
      }
      return value;
    };

    // Set creator - use employeeId from frontend or default to fixed assignee
    const creator = cleanObjectIdField(employeeId) || fixedAssigneeId;

    // Get state name from database
    // const stateData = await State.findById(state).select("name");
    // if (!stateData) {
    //   return res.status(400).json({
    //     success: false,
    //     message: "Invalid state ID",
    //   });
    // }
    // const stateName = stateData.name;

    // State is now sent as string name like "BIHAR", "DELHI" etc.
    // We'll store it directly without looking up in State collection
    const stateName = state ? String(state).trim().toUpperCase() : '';

    // Validate state name is provided
    if (!stateName) {
      return res.status(400).json({
        success: false,
        message: "State is required",
      });
    }

    console.log(`Using state name: ${stateName}`);

    // Verify references exist including creator
    const [clientExists, taskExists, deviceExists, techExists, creatorExists] =
      await Promise.all([
        QstClient.exists({ _id: cleanObjectIdField(qstClient) }),
        Task.exists({ _id: cleanObjectIdField(taskType) }),
        deviceType
          ? Device.exists({ _id: cleanObjectIdField(deviceType) })
          : Promise.resolve(true),
        technician
          ? Technician.findById(technician).select("email name _id")
          : Promise.resolve(null),
        Employee.exists({ _id: creator }),
      ]);

    // Validate references
    if (technician && !techExists) {
      return res.status(404).json({
        success: false,
        message: "Technician not found"
      });
    }
    if (!taskExists) {
      return res.status(404).json({
        success: false,
        message: "Task type not found"
      });
    }
    if (deviceType && !deviceExists) {
      return res.status(404).json({
        success: false,
        message: "Device type not found"
      });
    }
    if (!creatorExists) {
      return res.status(404).json({
        success: false,
        message: "Creator not found"
      });
    }

    // Validate project ID if provided
    if (qstProjectID) {
      const projectExists = await mongoose
        .model("Project")
        .exists({ _id: qstProjectID });
      if (!projectExists) {
        return res.status(400).json({
          success: false,
          message: "Invalid Project ID: Project does not exist.",
        });
      }
    }

    // Handle vehicle numbers
    let vehicleNumbersArray = [];
    let oldVehicleNumbersArray = [];
    let newVehicleNumbersArray = [];
    let isReinstallation = false;

    let taskTypeDoc = await Task.findById(taskType);
    const isServiceTask = taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("service");

    if (isServiceTask) {
      // Handle service task specific logic
      issueFoundRef = handleReferenceField(issueFound);
      resolutionRef = handleReferenceField(resolution);
    }

    if (taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("reinstallation")) {
      isReinstallation = true;
      oldVehicleNumbersArray = Array.isArray(oldVehicleNumbers)
        ? oldVehicleNumbers
        : oldVehicleNumbers
          ? oldVehicleNumbers.split(",").map((v) => v.trim()).filter(v => v)
          : [];

      newVehicleNumbersArray = Array.isArray(newVehicleNumbers)
        ? newVehicleNumbers
        : newVehicleNumbers
          ? newVehicleNumbers.split(",").map((v) => v.trim()).filter(v => v)
          : [];

      if (oldVehicleNumbersArray.length !== newVehicleNumbersArray.length) {
        return res.status(400).json({
          success: false,
          message: "Old and New Vehicle Numbers must have the same count",
        });
      }
    } else {
      vehicleNumbersArray = Array.isArray(vehicleNumbers)
        ? vehicleNumbers
        : vehicleNumbers
          ? vehicleNumbers.split(",").map((v) => v.trim()).filter(v => v)
          : [];
    }

    // Debug vehicle numbers
    console.log("Raw vehicleNumbers:", vehicleNumbers);
    console.log("Type of vehicleNumbers:", typeof vehicleNumbers);
    console.log("Is array?", Array.isArray(vehicleNumbers));

    // FIXED: Proper vehicle numbers formatting
    const formatVehicleNumbers = (vehicles, isReinstall = false) => {
      if (!vehicles || !Array.isArray(vehicles)) {
        return [];
      }

      return vehicles
        .map(vehicle => {
          // If vehicle is already an object with vehicleNumber
          if (typeof vehicle === 'object' && vehicle.vehicleNumber) {
            return {
              vehicleNumber: String(vehicle.vehicleNumber).trim(),
              images: vehicle.images || [],
              videoURL: vehicle.videoURL || "",
              isResinstalationTypeNewVehicalNumber: isReinstall
            };
          }
          // If vehicle is a simple string
          else if (typeof vehicle === 'string') {
            return {
              vehicleNumber: vehicle.trim(),
              images: [],
              videoURL: "",
              isResinstalationTypeNewVehicalNumber: isReinstall
            };
          }
          // If vehicle is any other type, convert to string
          else {
            return {
              vehicleNumber: String(vehicle).trim(),
              images: [],
              videoURL: "",
              isResinstalationTypeNewVehicalNumber: isReinstall
            };
          }
        })
        .filter(vehicle => vehicle.vehicleNumber && vehicle.vehicleNumber.trim() !== '');
    };

    // Use the fixed formatting function
    const formattedVehicleNumbers = isReinstallation
      ? formatVehicleNumbers(newVehicleNumbersArray, true)
      : formatVehicleNumbers(vehicleNumbersArray, false);

    console.log("Formatted vehicle numbers:", formattedVehicleNumbers);

    // Get string names for backup fields
    const clientDoc = await QstClient.findById(qstClient);
    const taskDoc = await Task.findById(taskType);
    const deviceDoc = deviceType ? await Device.findById(deviceType) : null;
    const creatorDoc = await Employee.findById(creator);

    // 🆕 Calculate payment details
    // let paymentDetails = null;
    // if (paymentGateway) {
    //   const ticketPrice = price ? Number(price) : 0;
    //   paymentDetails = {
    //     paymentGateway: paymentGateway || null,
    //     originalAmount: ticketPrice,
    //     amountPaid: ticketPrice,
    //     razorpay_payment_id: null,
    //     razorpay_order_id: null,
    //     razorpay_signature: null,
    //     isPaymentReceived,
    //   };
    // }


    // 🆕 Calculate payment details - FIXED VERSION
    let paymentDetails = null;

    // Debug what we're receiving
    console.log("🔍 Payment Debug - Received:", {
      paymentGateway: paymentGateway,
      isPaymentReceived: isPaymentReceived,
      typeOfIsPaymentReceived: typeof isPaymentReceived
    });

    if (paymentGateway) {
      const ticketPrice = price ? Number(price) : 0;

      // Handle different possible values for isPaymentReceived
      let paymentReceivedStatus = false;

      if (isPaymentReceived === true) {
        paymentReceivedStatus = true;
      } else if (isPaymentReceived === "true") {
        paymentReceivedStatus = true;
      } else if (isPaymentReceived === 1) {
        paymentReceivedStatus = true;
      } else if (isPaymentReceived === "1") {
        paymentReceivedStatus = true;
      }
      // All other cases remain false

      console.log(`💰 Final Payment Status: ${paymentReceivedStatus ? 'RECEIVED' : 'NOT RECEIVED'}`);

      paymentDetails = {
        paymentGateway: paymentGateway,
        originalAmount: ticketPrice,
        amountPaid: paymentReceivedStatus ? ticketPrice : 0,
        razorpay_payment_id: null,
        razorpay_order_id: null,
        razorpay_signature: null,
        isPaymentReceived: paymentReceivedStatus,
      };
    } else {
      console.log("💳 No payment gateway - creating unpaid ticket");
    }

    // Create the ticket object
    const newTicket = new Ticket({
      // New customer fields
      customerName: customerName || '',
      mobile: mobile || '',
      email: email || '',
      pincode: pincode || '',
      detailedAddress: detailedAddress || '',

      // New dashcam fields
      dashcamBrand: dashcamBrand || '',
      dashcamType: dashcamType || '',

      // New vehicle fields
      vehicleMake: vehicleMake || '',
      vehicleModel: vehicleModel || '',
      price: price ? Number(price) : 0,
      vehicleRegistrationNumber: vehicleRegistrationNumber || '',
      // Existing ticket fields
      qstClientName: cleanObjectIdField(qstClient),
      taskType: cleanObjectIdField(taskType),
      deviceType: cleanObjectIdField(deviceType),
      location,
      dueDate: new Date(dueDate),
      ticketAvailabilityDate: ticketAvailabilityDate ? new Date(ticketAvailabilityDate) : null,
      technician: technician || undefined,
      oldVehicleNumber: isReinstallation ? oldVehicleNumbersArray : [],
      vehicleNumbers: formattedVehicleNumbers,
      noOfVehicles: formattedVehicleNumbers.length,
      description,
      remark,
      // NEW: Terms & Conditions Agreement
      agreedToTerms: agreedToTerms || false,
      termsAgreedAt: agreedToTerms ? new Date() : null,
      assignee: fixedAssigneeId, // Use fixed assignee
      qstProjectID: qstProjectID || undefined,
      qstClientTicketNumber: qstClientTicketNo,
      qstClientProjectName: projectName,
      imeiNumbers: imeiNumber ? [imeiNumber] : [],
      simNumbers: simNumber ? [simNumber] : [],
      issueFound,
      resolution,
      issueFoundRef,
      resolutionRef,
      technicianCharges: parseFloat(techCharges) || 0,
      materialCharges: parseFloat(materialCharges) || 0,
      courierCharges: parseFloat(courierCharges) || 0,
      techConveyance: parseFloat(techConveyance) || 0,
      customerConveyance: parseFloat(customerConveyance) || 0,
      ticketStatus: ticketStatus,
      techAccountNumber,
      techIFSCCode: techIfscCode,
      accountHolderName: accountHolder,
      state: stateName, // Use state name from database
      subjectLine,
      totalTechCharges: parseFloat(totalTechCharges) || 0,
      customerCharges: parseFloat(customerCharges) || 0,
      totalCustomerCharges: parseFloat(totalCustomerCharges) || 0,
      reasonForTicketClosure: ticketClosureReason,

      // Set the creator field
      creator: creator,

      // String backup fields
      qstClientNameString: clientDoc?.companyShortName || "D2C",
      assigneeNameString: fixedAssigneeName, // Use fixed assignee name
      taskTypeString: taskDoc?.taskName || "",
      devicetypeNameString: deviceDoc?.deviceName || "",
      technicianNameString: techExists?.name || "",
      creatorNameString: creatorDoc?.name || "",
      // 🆕 Payment details
      paymentDetails: paymentDetails,
      // Handle file attachments
      attachedFiles: [
        ...attachedFiles,
        ...finalAttachments.map(
          (file) =>
            `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${file.key}`
        )
      ],
    });

    // ------------- Ticket skuId addition and retry methods ------------------
    const generateTicketSKUId = await getTicketSKUIdGenerator();
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 100;
    let savedTicket;
    let attempts = 0;

    while (attempts < MAX_RETRIES) {
      try {
        const ticketWithSKU = {
          ...newTicket.toObject(),
          ticketSKUId: await generateTicketSKUId(),
        };

        savedTicket = await new Ticket(ticketWithSKU).save();
        break;


      } catch (error) {
        if (error.code === 11000 && error.keyPattern?.ticketSKUId) {
          attempts++;
          if (attempts >= MAX_RETRIES) {
            const skuError = new Error(
              "Failed to generate unique ticket ID after multiple attempts. Please try again."
            );
            skuError.isSKUGenerationError = true;
            throw skuError;
          }
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
        throw error;
      }
    }
    console.log("BEFORE SENDING EMAIL BLOCK")
    // 📨 Send email confirmation to customer (if email provided)
    if (email) {
      try {
        const emailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <p>Dear ${customerName || "Customer"},</p>

        <p>Thanks for chosing AlgoMatix !!!</p>

        <p>We have received your request for ${taskTypeDoc?.taskName || "N/A"} of ${dashcamBrand} ${dashcamType}.</p>

        <div style="background-color: #f8f9fa; padding: 10px; border-left: 4px solid #007bff; margin: 15px 0;">
        <p style="margin: 0;"><strong>Service Amount: ${price || "N/A"}</strong></p>
        </div>

        <p>Our support team will contact you within 2 working hours. If you have any queries, you can also get in touch with them at 8169021148 or write to us at support@quikservtechnologies.com</p>

        <p>Thanks,</p>

        <p>Team <strong>AlgoMatix</strong></p>

        <br/>
        <p style="font-size: 0.9em; color: #777;">This is an automated email. Please do not reply.</p>
      </div>
    `;

        await sendEmail({
          to: email,
          subject: `AlgoMatix Dashcam installation ticket - ${savedTicket.ticketSKUId}`,
          html: emailHtml,
          text: `Dear ${customerName || "Customer"}`,
        });

        console.log(`✅ Confirmation email sent to customer: ${email}`);
      } catch (emailError) {
        console.error("❌ Failed to send confirmation email:", emailError);
      }
    }

    console.log("AFTER EMAIL BLOCK")


    // Send email to technician if assigned
    if (technician && techExists && techExists.email) {
      try {
        const securityCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await securityCodeModel.create({
          securityCode: securityCode,
          ticketId: savedTicket._id,
          technicianId: technician,
          expiresAt,
        });

        const emailContent = generateTechnicianAssignmentEmail(
          savedTicket.toObject(),
          techExists,
          securityCode
        );

        await sendEmail({
          to: techExists.email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        });

        console.log(`Notification email sent to technician: ${techExists.email}`);
      } catch (emailError) {
        console.error("Failed to send technician assignment email:", emailError);
      }
    }

    // Populate references for the response
    const populatedTicket = await Ticket.findById(savedTicket._id)
      .populate("qstClientName", "companyShortName companyName")
      .populate("assignee", "name")
      .populate("taskType", "taskName")
      .populate("deviceType", "deviceName")
      .populate("technician", "name")
      .populate("creator", "name")
      .populate("qstProjectID", "projectName")
      .populate("issueFoundRef", "issueFoundName")
      .populate("resolutionRef", "resolutionName");

    res.status(201).json({
      success: true,
      message: "Ticket created successfully",
      data: populatedTicket,
    });
  } catch (error) {
    console.error("Error creating ticket:", error);
    if (error.isSKUGenerationError) {
      res.status(500).json({
        success: false,
        message: error.message,
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }
};

// module.exports = { createNewTicket };

// module.exports = { createNewTicket };

// module.exports = { createNewTicket };
// module.exports = { createNewTicket };
const getAllTickets = async (req, res) => {
  try {
    // Get user information from request
    const user = req.user; // Assuming this is set by auth middleware
    if (!user || !user.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized - User information missing",
      });
    }

    // Check if user has permission to access tickets
    if (!["admin", "superAdmin", "cse"].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden - You don't have permission to access tickets",
      });
    }
    // ------------------------------------------
    const {
      page = 1,
      search,
      status,
      fromDate,
      toDate,
      // dateType = "updatedDate",
      dateType,
      dueDateFilter,
    } = req.query;
    // console.log("query", req.query);
    const limit = parseInt(req.query.limit) || 10;
    console.log(dateType);

    const validDateFields = {
      creationDate: "createdAt",
      updatedDate: "updatedAt",
      dueDate: "dueDate",
    };

    // const selectedDateField = validDateFields[dateType] || "updatedAt";
    const filterDateField = validDateFields[dateType] || "updatedAt";
    const skip = (page - 1) * limit;

    // Calculate date ranges for stats
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    // todayEnd.setHours(23, 59, 59, 999);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
    // tomorrowEnd.setHours(23, 59, 59, 999); // ✅ FIXED: Same day, end time

    const dayAfterStart = new Date(tomorrowStart);
    dayAfterStart.setDate(dayAfterStart.getDate() + 1);
    const dayAfterEnd = new Date(dayAfterStart);
    dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);
    // dayAfterEnd.setHours(23, 59, 59, 999); // ✅ FIXED: Same day, end time

    // Build the base query
    let query = {};
    // Create a base filter for statistics that will be applied to all stats queries
    let statsBaseFilter = {};
    // Add role-based filtering
    if (user.role === "cse") {
      // For CSE, only show tickets assigned to them
      query.assignee = user._id; // Assuming assignee field stores user ID
      statsBaseFilter.assignee = user._id; // Apply same filter to stats
    }

    // Add status filter if provided
    // Updated status filter
    if (status && status !== "All Tickets") {
      // (Only ticket closed show when both work done and is ticket close true)
      if (status === "Closed") {
        query.$and = [{ ticketStatus: "work done" }, { isTicketClosed: true }];
      } else if (status === "Open") {
        query.$and = [
          // { ticketStatus: { $ne: "work done" } },
          { isTicketClosed: { $ne: true } },
        ];
      } else if (status === "work done") {
        // New filter for tickets with status "work done" regardless of isTicketClosed
        query.$and = [
          { ticketStatus: "work done" },
          { isTicketClosed: { $ne: true } },
        ];
      }
    }
    // Add date range filter if provided
    if (fromDate && toDate) {
      const startDate = new Date(`${fromDate}T00:00:00.000Z`);
      const endDate = new Date(`${toDate}T23:59:59.999Z`);

      // query[selectedDateField] = {
      //   $gte: startDate,
      //   $lt: endDate,
      // };
      query[filterDateField] = {
        $gte: startDate,
        $lt: endDate,
      };
    }



    // Due date filtering logic - exclude work done/closed tickets
    if (dueDateFilter && dueDateFilter !== 'null' && dueDateFilter !== 'undefined') {
      if (dueDateFilter === "replaced") {
        // Fetch all ticket IDs that have at least one swap
        const swappedTicketIds = await DefectiveItemSwap.distinct("ticketId");
        const replacedQuery = { _id: { $in: swappedTicketIds } };
        if (Object.keys(query).length > 0) {
          query = { $and: [query, replacedQuery] };
        } else {
          query = replacedQuery;
        }
      } else if (dueDateFilter === "softClose") {
        query.softCloseByTechnician = true;
      } else if (dueDateFilter === "techWorkNotDone") {
        // Tickets that are open AND have at least one vehicle with isDone = false
        const techWorkNotDoneQuery = {
          $and: [
            { isTicketClosed: { $ne: true } },
            { ticketStatus: { $ne: "work done" } },
            { "vehicleNumbers.isDone": false }
          ]
        };
        if (Object.keys(query).length > 0) {
          query = { $and: [query, techWorkNotDoneQuery] };
        } else {
          query = techWorkNotDoneQuery;
        }
      } else {
        const dueDateQuery = {
          $and: [
            { ticketStatus: { $ne: "work done" } },  // Exclude work done
            { isTicketClosed: { $ne: true } }        // Exclude closed tickets
          ]
        };

        switch (dueDateFilter) {
          case "today":
            dueDateQuery.$and.push({
              dueDate: { $gte: todayStart, $lt: todayEnd }
            });
            break;
          case "tomorrow":
            dueDateQuery.$and.push({
              dueDate: { $gte: tomorrowStart, $lt: tomorrowEnd }
            });
            break;
          case "dayAfterTomorrow":
            dueDateQuery.$and.push({
              dueDate: { $gte: dayAfterStart, $lt: dayAfterEnd }
            });
            break;
          case "delayed":
            dueDateQuery.$and.push({
              dueDate: { $lt: todayStart }
            });
            break;
        }

        // Merge with existing query
        if (Object.keys(query).length > 0) {
          query = { $and: [query, dueDateQuery] };
        } else {
          query = dueDateQuery;
        }
      }
    }

    // In search when we get exact correct id then it return that items
    let objectIdMatch = null;
    if (mongoose.Types.ObjectId.isValid(search.trim())) {
      objectIdMatch = new mongoose.Types.ObjectId(search.trim());
    }

    // Add search functionality
    if (search) {
      const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const safeSearch = escapeRegex(search.trim());
      const searchRegex = new RegExp(safeSearch, "i");


      const searchConditions = {
        $or: [
          { qstClientTicketNumber: searchRegex },
          // { "assignee.name": searchRegex },
          { ticketSKUId: searchRegex },
          { location: searchRegex },
          { description: searchRegex },
          { subjectLine: searchRegex },
          { "vehicleNumbers.vehicleNumber": searchRegex }, // Vehicle number search
          ...(objectIdMatch ? [{ _id: objectIdMatch }] : []), // <- exact match on _id
          // Add this new condition to search in referenced employee names
          {
            assignee: {
              $in: await mongoose
                .model("Employee")
                .find({ name: searchRegex })
                .distinct("_id")
                .exec(),
            },
          },

          {
            technician: {
              $in: await mongoose
                .model("Technician") // <-- use your actual Technician model name here
                .find({ nickName: searchRegex })
                .distinct("_id")
                .exec(),
            },
          },
        ]
      };


      // Combine with existing query using $and
      if (Object.keys(query).length > 0) {
        query = { $and: [query, searchConditions] };
      } else {
        query = searchConditions;
      }
    }

    const statsQueries = [
      // Open tickets - exclude tickets with work done OR closed
      Ticket.countDocuments({
        ...statsBaseFilter,
        $and: [
          { ticketStatus: { $ne: "work done" } },  // Exclude work done
          { isTicketClosed: { $ne: true } }        // Exclude closed tickets
        ]
      }),

      // Closed tickets - include tickets with work done OR closed
      Ticket.countDocuments({
        ...statsBaseFilter,
        $or: [
          { ticketStatus: "work done" },  // Include work done
          { isTicketClosed: true }        // Include closed tickets
        ]
      }),

      // Open tickets due today (exclude work done/closed)
      Ticket.countDocuments({
        ...statsBaseFilter,
        $and: [
          { ticketStatus: { $ne: "work done" } },
          { isTicketClosed: { $ne: true } },
          { dueDate: { $gte: todayStart, $lt: todayEnd } }
        ]
      }),

      // Open tickets due tomorrow (exclude work done/closed)
      Ticket.countDocuments({
        ...statsBaseFilter,
        $and: [
          { ticketStatus: { $ne: "work done" } },
          { isTicketClosed: { $ne: true } },
          { dueDate: { $gte: tomorrowStart, $lt: tomorrowEnd } }
        ]
      }),

      // Open tickets due day after tomorrow (exclude work done/closed)
      Ticket.countDocuments({
        ...statsBaseFilter,
        $and: [
          { ticketStatus: { $ne: "work done" } },
          { isTicketClosed: { $ne: true } },
          { dueDate: { $gte: dayAfterStart, $lt: dayAfterEnd } }
        ]
      }),

      // Delayed open tickets (exclude work done/closed)
      Ticket.countDocuments({
        ...statsBaseFilter,
        $and: [
          { ticketStatus: { $ne: "work done" } },
          { isTicketClosed: { $ne: true } },
          { dueDate: { $lt: todayStart } }
        ]
      }),

      // Replaced tickets - tickets with at least one swap
      DefectiveItemSwap.distinct("ticketId").then(ids =>
        Ticket.countDocuments({ ...statsBaseFilter, _id: { $in: ids } })
      ),

      // Soft Close tickets
      Ticket.countDocuments({ ...statsBaseFilter, softCloseByTechnician: true }),

      // Tech Work Not Done - open tickets with at least one vehicle where isDone = false
      Ticket.countDocuments({
        ...statsBaseFilter,
        $and: [
          { isTicketClosed: { $ne: true } },
          { ticketStatus: { $ne: "work done" } },
          { "vehicleNumbers.isDone": false }
        ]
      }),
    ];

    const [
      openCount,
      closedCount,
      todayCount,
      tomorrowCount,
      dayAfterCount,
      delayedCount,
      replacedCount,
      softCloseCount,
      techWorkNotDoneCount,
    ] = await Promise.all(statsQueries);

    // Get total count for pagination
    const allTotalTicketCounts = await Ticket.countDocuments(query);

    //get the value of isTechnicianPaymentSuccessDate for ticket id 689dd6c6893372527da66386
    const ticketId = "689dd6c6893372527da66386";
    const ticket = await Ticket.find().select("isTechnicianPaymentSuccessDate");
    // console.log("Tickets", ticket);
    // Change the sorting logic to use dueDate as default
    const sortCriteria = {};
    if (dateType === "creationDate") {
      sortCriteria.createdAt = -1; // Newest first for creation date
    } else if (dateType === "updatedDate") {
      sortCriteria.updatedAt = -1; // Newest first for updated date
    } else {
      sortCriteria.dueDate = 1; // Default: Oldest first for due date
    }

    // Get paginated results also send isTechnicianPaymentSuccessDate in below
    const tickets = await Ticket.find(query)
      .select("+isTechnicianPaymentSuccessDate +annexturepaid") // Explicitly include the field
      .populate("qstClientName", "companyShortName companyName")
      .populate("assignee", "name _id")
      .populate("taskType", "taskName")
      .populate("deviceType", "deviceName")
      .populate("technician", "name nickName beneficiaryId")
      .populate("creator", "name")
      .populate("qstProjectID", "projectName _id")
      .populate("softCloseByTechnicianComment")
      // .populate("issueFoundRef", "issueFoundName")
      // .populate("resolutionRef", "ResolutionName")
      .sort(sortCriteria) // Use the dynamic sort criteria
      // .sort(dateType === "dueDate" ? { dueDate: 1 } : { [selectedDateField]: -1 }) // Modified this line
      // .sort({ [selectedDateField]: -1 })
      .skip(skip)
      .limit(limit);



    // const tickets = await Ticket.aggregate([
    //   { $match: query },
    //   { $sort: sortCriteria },
    //   { $skip: skip },
    //   { $limit: limit },

    //   {
    //     $lookup: {
    //       from: "maindatas",
    //       let: { regNos: "$vehicleNumbers.vehicleNumber" },
    //       pipeline: [
    //         { $match: { $expr: { $in: ["$registrationNumber", "$$regNos"] } } },

    //         // ✅ Sim populate + remove statusHistory
    //         {
    //           $lookup: {
    //             from: "simmasters",
    //             localField: "simDetails",
    //             foreignField: "_id",
    //             as: "simDetails",
    //             pipeline: [
    //               { $project: { statusHistory: 0, __v: 0 } } // ✅ HERE
    //             ],
    //           },
    //         },
    //         { $unwind: { path: "$simDetails", preserveNullAndEmptyArrays: true } },

    //         // ✅ Device populate + remove statusHistory
    //         {
    //           $lookup: {
    //             from: "devicemasters",
    //             localField: "deviceDetails",
    //             foreignField: "_id",
    //             as: "deviceDetails",
    //             pipeline: [
    //               { $project: { statusHistory: 0, __v: 0 } } // ✅ HERE
    //             ],
    //           },
    //         },
    //         { $unwind: { path: "$deviceDetails", preserveNullAndEmptyArrays: true } },

    //         // ✅ Accessories populate + remove statusHistory
    //         {
    //           $lookup: {
    //             from: "accessorymasters",
    //             localField: "accessoryDetails",
    //             foreignField: "_id",
    //             as: "accessoryDetails",
    //             pipeline: [
    //               { $project: { statusHistory: 0, __v: 0 } } // ✅ HERE
    //             ],
    //           },
    //         },

    //         // (optional) also remove statusHistory from MainData if it ever exists there
    //         { $project: { __v: 0 } },
    //       ],
    //       as: "attachedMainData",
    //     },
    //   },

    //   // ✅ merge into vehicleNumbers
    //   {
    //     $addFields: {
    //       vehicleNumbers: {
    //         $map: {
    //           input: "$vehicleNumbers",
    //           as: "v",
    //           in: {
    //             $mergeObjects: [
    //               "$$v",
    //               {
    //                 mainData: {
    //                   $first: {
    //                     $filter: {
    //                       input: "$attachedMainData",
    //                       as: "m",
    //                       cond: { $eq: ["$$m.registrationNumber", "$$v.vehicleNumber"] },
    //                     },
    //                   },
    //                 },
    //               },
    //             ],
    //           },
    //         },
    //       },
    //     },
    //   },

    //   // optional: remove attachedMainData since you already merged it
    //   { $project: { attachedMainData: 0 } },
    // ]);



    let statsss = {
      open: openCount,
      closed: closedCount,
      dueDateCounts: {
        today: todayCount,
        tomorrow: tomorrowCount,
        dayAfterTomorrow: dayAfterCount,
        delayed: delayedCount,
      },
    };
    console.log(statsss);
    console.log(allTotalTicketCounts, "jkjkjkjk");

    res.status(200).json({
      success: true,

      stats: {
        open: openCount,
        closed: closedCount,
        dueDateCounts: {
          today: todayCount,
          tomorrow: tomorrowCount,
          dayAfterTomorrow: dayAfterCount,
          delayed: delayedCount,
          replaced: replacedCount,
          softClose: softCloseCount,
          techWorkNotDone: techWorkNotDoneCount,
        },
      },
      data: tickets,
      total: allTotalTicketCounts,
      page: parseInt(page), // current page
      pages: Math.ceil(allTotalTicketCounts / limit), // total pages
    });
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};



const getClosedTicketsSummaryforNeft = async (req, res) => {
  try {
    const search = req.query.search || "";
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build query
    const query = {
      isTicketClosed: true,
      ticketStatus: "work done",
      isTechnicianPaymentSuccess: false,
      ...(search && { ticketSKUId: { $regex: search, $options: "i" } })
    };

    // Get total count
    const total = await Ticket.countDocuments(query);

    // Only get tickets where isTicketClosed is true
    const tickets = await Ticket.find(query)
      .select("_id technician totalTechCharges ticketSKUId ") // select only required fields
      .populate("technician", "name beneficiaryId") // populate only name of technician
      .populate("assignee", "name") // populate only name of technician

      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    const totalPages = Math.ceil(total / limit);

    res.status(200).json({
      success: true,
      count: tickets.length,
      data: tickets,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        // hasNext: page < totalPages,
        // hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching closed tickets summary:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


const exportClosedTicketsSummaryforNeft = async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "fromDate and toDate are required in query",
      });
    }

    const from = dayjs(fromDate).startOf("day").toDate();
    const to = dayjs(toDate).endOf("day").toDate();

    const tickets = await Ticket.find({
      isTicketClosed: true,
      ticketStatus: "work done",
      isTechnicianPaymentSuccess: false,
      ticketAvailabilityDate: { $gte: from, $lte: to },
    })
      .select("_id technician totalTechCharges createdAt ticketSKUId ticketAvailabilityDate")
      .populate("technician", "name beneficiaryId nickName") // add other fields if needed   
      .populate("assignee", "name")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: tickets.length,
      data: tickets,
    });
  } catch (error) {
    console.error("Error exporting NEFT summary:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getTicketById = async (req, res) => {
  try {
    const { ticketId } = req.params;

    // Validate ticket ID
    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID format",
      });
    }

    // Find the ticket and populate all referenced fields
    const ticket = await Ticket.findById(ticketId)
      .populate("qstClientName", "companyShortName companyName _id")
      .populate("taskType", "taskName _id")
      .populate("deviceType", "deviceName _id")
      .populate("assignee", "name _id")
      .populate("technician", "name nickName accountNumber ifscCode _id")
      .populate("creator", "name _id")
      .populate("issueFoundRef", "issueFoundName _id")
      .populate("resolutionRef", "ResolutionName _id")
      .lean(); // Convert to plain JavaScript object

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Transform the data to match the frontend needs
    const transformedTicket = {
      ...ticket,
      // For reinstallation tickets, separate old and new vehicle numbers
      oldVehicleNumber: ticket.oldVehicleNumber || [],
      vehicleNumbers: ticket.vehicleNumbers.map((v) => ({
        ...v,
        // For reinstallation tickets, identify which are new vehicle numbers
        isResinstalationTypeNewVehicalNumber:
          v.isResinstalationTypeNewVehicalNumber || false,
      })),
      // Combine all financial fields in consistent naming
      technicianCharges: ticket.technicianCharges,
      techIFSCCode: ticket.techIFSCCode,
      techAccountNumber: ticket.techAccountNumber,
      accountHolderName: ticket.accountHolderName,
      // Combine arrays into comma-separated strings for display
      imeiNumbers: ticket.imeiNumbers || [],
      simNumbers: ticket.simNumbers || [],
      // Ensure all fields have proper defaults
      attachedFiles: ticket.attachedFiles || [],
    };

    res.status(200).json({
      success: true,
      message: "Ticket retrieved successfully",
      data: transformedTicket,
    });
  } catch (error) {
    console.error("Error fetching ticket:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching ticket",
      error: error.message,
    });
  }
};

// const deleteTicketById = async (req, res) => {
//   try {
//     const { ticketId } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(ticketId)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid ticket ID format",
//       });
//     }

//     const deletedTicket = await Ticket.findByIdAndDelete(ticketId);

//     if (!deletedTicket) {
//       return res.status(404).json({
//         success: false,
//         message: "Ticket not found",
//       });
//     }

//     res.status(200).json({
//       success: true,
//       message: "Ticket deleted successfully",
//     });
//   } catch (error) {
//     console.error("Error deleting ticket:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// };


const deleteTicketById = async (req, res) => {
  try {
    const { ticketId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID format",
      });
    }

    // Step 1: Find the ticket before deleting
    const ticket = await Ticket.findById(ticketId)
      .populate("qstClientName")
      .populate("taskType")
      .populate("deviceType")
      .populate("technician")
      .populate("assignee")
      .populate("qstProjectID")
      .populate("creator")
      .populate({
        path: "DueDateChangeLog",
        populate: { path: "changedBy", select: "name email" } // also populate who changed due dates
      });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Step 2: Log the deleted ticket snapshot
    await DeletedTicketLog.create({
      ticketId: ticket._id,
      ticketData: ticket.toObject(), // full snapshot
      deletedBy: req.user._id,       // assuming auth middleware sets req.user
      deletedByName: req.user.name,  // snapshot of name
    });

    // Step 3: Delete the ticket
    await Ticket.findByIdAndDelete(ticketId);

    res.status(200).json({
      success: true,
      message: "Ticket deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting ticket:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


// const updateTicket = async (req, res) => {
//   try {
//     const { ticketId } = req.params;
//     // console.log("Request body:", req.body);

//     // Validate ticket ID
//     if (!mongoose.Types.ObjectId.isValid(ticketId)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid ticket ID format",
//       });
//     }

//     // Get the existing ticket
//     const existingTicket = await Ticket.findById(ticketId);
//     if (!existingTicket) {
//       return res.status(404).json({
//         success: false,
//         message: "Ticket not found",
//       });
//     }

//     const {
//       qstClient = undefined,
//       location,
//       taskType = undefined,
//       deviceType = undefined,
//       vehicleNumbers,
//       oldVehicleNumbers,
//       newVehicleNumbers,
//       noOfVehicles,
//       description,
//       remark,
//       assignee,
//       projectName,
//       qstClientTicketNo,
//       technician: rawTechnician = undefined,
//       imeiNumber,
//       simNumber,
//       issueFound,
//       resolution,
//       techCharges,
//       materialCharges,
//       courierCharges,
//       techConveyance,
//       customerConveyance,
//       ticketStatus,
//       techAccountNumber,
//       techIfscCode,
//       accountHolder,
//       state,
//       subjectLine,
//       totalTechCharges,
//       customerCharges,
//       totalCustomerCharges,
//       ticketClosureReason,
//       dueDate,
//       qstProjectID,
//       ticketAvailabilityDate,
//       dueDateChangeReason,


//       filesToDelete = [], // it is ticket level files
//     } = req.body;
//     console.log(dueDateChangeReason, "777777777777777777777777777777777777");
//     console.log(dueDate, "8888888888888888888888888777777");
//     // handle empty string come for objectId
//     const technician = rawTechnician === "" ? undefined : rawTechnician;

//     // Handle empty strings for issueFound and resolution
//     const issueFoundRef = issueFound === "" ? undefined : issueFound;
//     const resolutionRef = resolution === "" ? undefined : resolution;

//     // Validate required fields
//     // Validate required fields
//     const requiredFields = {
//       qstClient,
//       location,
//       taskType,
//       assignee,
//       state,
//       ticketStatus,
//       dueDate,
//     };

//     const missingFields = Object.entries(requiredFields)
//       .filter(([key, value]) => !value)
//       .map(([key]) => key);

//     if (missingFields.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: `Missing required field(s): ${missingFields.join(", ")}`,
//       });
//     }

//     // if (new Date(dueDate) < new Date()) {
//     //   return res.status(400).json({
//     //     success: false,
//     //     message: "Due date must be in the future",
//     //   });
//     // }

//     const isPastDate = (date) => {
//       const today = new Date();
//       today.setHours(0, 0, 0, 0); // Reset today's time to 00:00:00

//       const due = new Date(date);
//       due.setHours(0, 0, 0, 0); // Reset due date time to 00:00:00

//       return due < today;
//     };
//     if (!(ticketStatus === "work done")) {
//       if (isPastDate(dueDate)) {
//         return res.status(400).json({
//           success: false,
//           message: "Due date must be today or in the future",
//         });
//       }
//     }

//     // Validate qstProjectID if provided
//     if (qstProjectID && !mongoose.Types.ObjectId.isValid(qstProjectID)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid project ID format",
//       });
//     }

//     // Handle empty strings for all ObjectId fields
//     const cleanObjectIdField = (value) => {
//       if (value === "" || value === null || value === undefined) {
//         return undefined;
//       }

//       return value;
//     };


//     console.log(deviceType, "hhhh");


//     // Verify references exist
//     const [
//       ticketExists,
//       clientDoc,
//       assigneeExists,
//       taskDoc,
//       deviceExists,
//       techExists,
//       projectExists,
//     ] = await Promise.all([
//       Ticket.exists({ _id: ticketId }),
//       QstClient.findById(cleanObjectIdField(qstClient)),  // Get the document instead of just exists
//       // Employee.exists({ _id: cleanObjectIdField(assignee) }),
//       Employee.findById(cleanObjectIdField(assignee)),  // Get the document
//       Task.findById(cleanObjectIdField(taskType)),       // Get the document instead of just exists
//       // deviceType
//       //   ? Device.exists({ _id: cleanObjectIdField(deviceType) })
//       //   : Promise.resolve(true),
//       deviceType
//         ? Device.findById(cleanObjectIdField(deviceType))  // Get the document
//         : Promise.resolve(null),  // Resolve with null if no deviceType
//       // technician
//       //   ? Technician.exists({ _id: technician })
//       //   : Promise.resolve(true),
//       technician
//         ? Technician.findById(cleanObjectIdField(technician))  // Get the document
//         : Promise.resolve(null),  // Resolve with null if no technician
//       qstProjectID
//         ? Project.exists({ _id: qstProjectID })
//         : Promise.resolve(true), // If no project ID provided, resolve as true
//     ]);

//     if (!ticketExists)
//       return res
//         .status(404)
//         .json({ success: false, message: "Ticket not found" });
//     if (!clientDoc)
//       return res
//         .status(404)
//         .json({ success: false, message: "QST Client not found" });
//     if (!assigneeExists)
//       return res
//         .status(404)
//         .json({ success: false, message: "Assignee not found" });
//     if (!taskDoc)
//       return res
//         .status(404)
//         .json({ success: false, message: "Task type not found" });
//     if (deviceType && !deviceExists)
//       return res
//         .status(404)
//         .json({ success: false, message: "Device type not found" });
//     if (technician && !techExists)
//       return res
//         .status(404)
//         .json({ success: false, message: "Technician not found" });
//     if (qstProjectID && !projectExists)
//       // Only check if project ID was provided
//       return res
//         .status(404)
//         .json({ success: false, message: "Project not found" });

//     // Add this validation check for ticketClosureReason when status is "work not done"
//     if (ticketStatus === "work not done" && !ticketClosureReason) {
//       return res.status(400).json({
//         success: false,
//         message:
//           "Ticket closure reason is required when status is 'work not done'",
//       });
//     }


//     // Get task type to determine if it's reinstallation
//     const taskTypeDoc = await Task.findById(taskType);

//     const isReinstallation =
//       taskTypeDoc &&
//       taskTypeDoc.taskName.toLowerCase().includes("reinstallation");

//     // Handle vehicle numbers based on task type
//     let vehicleNumbersArray = [];
//     let oldVehicleNumbersArray = [];
//     let newVehicleNumbersArray = [];

//     if (isReinstallation) {
//       oldVehicleNumbersArray = Array.isArray(oldVehicleNumbers)
//         ? oldVehicleNumbers
//         : oldVehicleNumbers
//           ? oldVehicleNumbers.split(",").map((v) => v.trim())
//           : [];

//       newVehicleNumbersArray = Array.isArray(newVehicleNumbers)
//         ? newVehicleNumbers
//         : newVehicleNumbers
//           ? newVehicleNumbers.split(",").map((v) => v.trim())
//           : [];

//       if (oldVehicleNumbersArray.length !== newVehicleNumbersArray.length) {
//         return res.status(400).json({
//           success: false,
//           message: "Old and New Vehicle Numbers must have the same count",
//         });
//       }
//     } else {
//       vehicleNumbersArray = Array.isArray(vehicleNumbers)
//         ? vehicleNumbers
//         : vehicleNumbers
//           ? vehicleNumbers.split(",").map((v) => v.trim())
//           : [];
//     }


//     // Validate required ref fields when status is "work done" AND task type is service
//     const isServiceTask = taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("service");
//     if (ticketStatus === "work done" && isServiceTask) {
//       if (!issueFoundRef) {
//         return res.status(400).json({
//           success: false,
//           message: "Issue Found reference is required when status is 'work done' and task type is service",
//         });
//       }

//       if (!resolutionRef) {
//         return res.status(400).json({
//           success: false,
//           message: "Resolution reference is required when status is 'work done' and task type is service",
//         });
//       }
//     }

//     // ------------------------
//     // 1. FIRST PROCESS FILE DELETIONS
//     if (filesToDelete.length > 0) {
//       try {
//         await Promise.all(
//           filesToDelete.map(async (fileIdentifier) => {
//             const key = extractS3Key(fileIdentifier);
//             await deleteFromS3(key).catch((err) => {
//               console.error(`Failed to delete file ${key}:`, err);
//               // Continue even if one deletion fails
//             });
//           })
//         );
//       } catch (batchError) {
//         console.error("Batch file deletion error:", batchError);
//         // Continue with ticket update even if file deletion fails
//       }
//     }
//     // Process attachments - extract URLs only
//     let attachmentUrls = [];

//     // Filter out deleted files from existing attachments
//     if (Array.isArray(existingTicket.attachedFiles)) {
//       attachmentUrls = existingTicket.attachedFiles.filter((file) => {
//         const fileKey = extractS3Key(file);
//         return !filesToDelete.some(
//           (toDelete) => fileKey === extractS3Key(toDelete)
//         );
//       });
//     }

//     // Add new files (from req.body.attachedFiles)
//     if (Array.isArray(req.body.attachedFiles)) {
//       req.body.attachedFiles.forEach((item) => {
//         if (item == null) return;
//         const url =
//           typeof item === "string"
//             ? item
//             : `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${item.key}`;

//         if (url && !attachmentUrls.includes(url)) {
//           attachmentUrls.push(url);
//         }
//       });
//     }

//     // Remove duplicates
//     attachmentUrls = [...new Set(attachmentUrls)];
//     console.log("Final attachment URLs:", attachmentUrls);
//     // ---------------------------------
//     // attachmentUrls = [...new Set(attachmentUrls)];
//     // console.log(attachmentUrls)  //

//     // Create a map of existing vehicle numbers for media preservation that it not delete existing in update time
//     const existingVehicleMap = {};
//     if (Array.isArray(existingTicket.vehicleNumbers)) {
//       existingTicket.vehicleNumbers.forEach((veh) => {
//         existingVehicleMap[veh.vehicleNumber] = veh;
//       });
//     }

//     // Build updated vehicleNumbers list
//     let finalVehicleNumbers = [];

//     if (isReinstallation) {
//       finalVehicleNumbers = newVehicleNumbersArray.map((newNumber) => {
//         const existing = existingVehicleMap[newNumber];
//         return {
//           vehicleNumber: newNumber,
//           images: existing?.images || [],
//           videoURL: existing?.videoURL || "",
//           isResinstalationTypeNewVehicalNumber: true,
//         };
//       });
//     } else {
//       finalVehicleNumbers = vehicleNumbersArray.map((number) => {
//         const existing = existingVehicleMap[number];
//         return {
//           vehicleNumber: number,
//           images: existing?.images || [],
//           videoURL: existing?.videoURL || "",
//           isResinstalationTypeNewVehicalNumber: false,
//         };
//       });
//     }
//     console.log(finalVehicleNumbers, "final vehicles");

//     console.log(deviceType, "iiii");

//     // Prepare update object
//     const updateData = {
//       qstClientName: qstClient,
//       taskType,
//       // deviceType,
//       location,
//       technician,
//       dueDate: new Date(dueDate),
//       oldVehicleNumber: isReinstallation ? oldVehicleNumbersArray : [],
//       vehicleNumbers: finalVehicleNumbers,
//       noOfVehicles,
//       description,
//       remark,
//       assignee,
//       qstProjectID: qstProjectID || null,
//       qstClientTicketNumber: qstClientTicketNo,
//       qstClientProjectName: projectName,
//       imeiNumbers: imeiNumber ? imeiNumber.map((i) => i.trim()) : [],
//       simNumbers: simNumber ? simNumber.map((s) => s.trim()) : [],
//       issueFound,
//       resolution,
//       issueFoundRef: issueFoundRef || null, // ADD THIS LINE - handles ref field
//       resolutionRef: resolutionRef || null, // ADD THIS LINE - handles ref field
//       technicianCharges: parseFloat(techCharges) || 0,
//       materialCharges: parseFloat(materialCharges) || 0,
//       courierCharges: parseFloat(courierCharges) || 0,
//       techConveyance: parseFloat(techConveyance) || 0,
//       customerConveyance: parseFloat(customerConveyance) || 0,
//       ticketStatus,
//       ticketAvailabilityDate,
//       techAccountNumber,
//       techIFSCCode: techIfscCode,
//       accountHolderName: accountHolder,
//       state,
//       subjectLine,
//       totalTechCharges: parseFloat(totalTechCharges) || 0,
//       customerCharges: parseFloat(customerCharges) || 0,
//       totalCustomerCharges: parseFloat(totalCustomerCharges) || 0,
//       reasonForTicketClosure: ticketClosureReason,
//       isTicketClosed:
//         ticketStatus === "work not done" ? true : existingTicket.isTicketClosed,
//       // Preserve creator and creation date
//       creator: existingTicket.creator,
//       createdAt: existingTicket.createdAt,
//       attachedFiles: existingTicket.attachedFiles,
//       // // Handle file attachments - merge existing with new
//       attachedFiles: attachmentUrls,
//       technicianNameString: techExists ? techExists.nickName : "",
//       assigneeNameString: assigneeExists ? assigneeExists.name : "",
//       devicetypeNameString: deviceExists ? deviceExists.deviceName : "",

//       qstClientNameString: clientDoc ? clientDoc.companyShortName : "",
//       taskTypeString: taskDoc ? taskDoc.taskName : existingTicket.taskTypeString,
//     };

//     if (deviceType) {
//       updateData.deviceType = deviceType;
//     } else {
//       updateData.$unset = { deviceType: 1 };
//     }
//     console.log(cleanObjectIdField(deviceType), "88888");



//     // Check if due date has changed and log it------
//     if (dueDateChangeReason && dueDate && existingTicket.dueDate) {
//       const existingDueDate = new Date(existingTicket.dueDate).toISOString().split('T')[0];
//       const newDueDateObj = new Date(dueDate).toISOString().split('T')[0];



//       if (existingDueDate !== newDueDateObj) {
//         try {
//           // Create due date change log
//           const dueDateChangeLog = new DueDateChangeLog({
//             ticketId: ticketId,
//             changedBy: req.user._id, // Assuming you have user authentication
//             previousDueDate: existingTicket.dueDate,
//             newDueDate: dueDate,
//             changeReason: dueDateChangeReason,
//             changedAt: new Date()
//           });

//           await dueDateChangeLog.save();

//           // Also add the log reference to the ticket
//           updateData.$push = {
//             DueDateChangeLog: dueDateChangeLog._id
//           };

//         } catch (logError) {
//           console.error("Failed to create due date change log:", logError);
//           // Don't fail the ticket update if logging fails
//         }
//       }
//     }


//     // console.log(
//     //   existingTicket.isTicketClosed,
//     //   "existingTicket.isTicketClosed============-------------"
//     // );
//     // Update the ticket
//     const updatedTicket = await Ticket.findByIdAndUpdate(ticketId, updateData, {
//       new: true,
//       runValidators: true,
//     }).populate([
//       { path: "qstClientName", select: "companyShortName" },
//       { path: "assignee", select: "name" },
//       { path: "taskType", select: "taskName" },
//       { path: "deviceType", select: "deviceName" },
//       { path: "technician", select: "name email _id" },
//       { path: "creator", select: "name" },
//       { path: "qstProjectID", select: "projectName _id" },
//       { path: "issueFoundRef", select: "name description" },
//       { path: "resolutionRef", select: "name description" },
//     ]);



//     // ✅ Send email ONLY after successful update (if technician changesd and assigned ticket to new technician)
//     if (technician && updatedTicket.technician?.email && technician !== existingTicket.technician?.toString()) {
//       // console.log("Technician changed=========:", existingTicket.technician, "->", technician);
//       // console.log(existingTicket.technician?.toString(),"existingTicket.technician?.toString()--------")
//       // console.log(updatedTicket.technician?.email,"updatedTicket.technician?.email--------")
//       try {
//         // Invalidate previous security codes
//         await securityCodeModel.deleteMany({ ticketId: ticketId });

//         // Generate new security code
//         const securityCode = Math.floor(100000 + Math.random() * 900000).toString();
//         const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

//         await securityCodeModel.create({
//           securityCode,
//           ticketId,
//           technicianId: technician,
//           expiresAt,
//         });

//         // Use updatedTicket (already populated) for email
//         const emailContent = generateTechnicianAssignmentEmail(
//           updatedTicket.toObject(),
//           updatedTicket.technician, // Already populated with email
//           securityCode
//         );

//         await sendEmail({
//           to: updatedTicket?.technician.email,
//           subject: emailContent.subject,
//           html: emailContent.html,
//           text: emailContent.text,
//         });

//         console.log(`Email sent to new technician: ${updatedTicket.technician.email}`);
//       } catch (emailError) {
//         console.error("Failed to send technician email:", emailError);
//         // Don't fail the API response
//       }
//     }

//     res.status(200).json({
//       success: true,
//       message: "Ticket updated successfully",
//       data: updatedTicket,
//     });
//   } catch (error) {
//     console.error("Error updating ticket:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// };

// const updateTicket = async (req, res) => {
//   try {
//     const { ticketId } = req.params;
//     const role = req.user.role;
//     console.log("Role is : ", role)

//     if (!mongoose.Types.ObjectId.isValid(ticketId)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid ticket ID format",
//       });
//     }

//     const existingTicket = await Ticket.findById(ticketId);
//     if (!existingTicket) {
//       return res.status(404).json({
//         success: false,
//         message: "Ticket not found",
//       });
//     }

//     const {
//       qstClient = undefined,
//       location,
//       taskType = undefined,
//       deviceType = undefined,
//       vehicleNumbers,
//       oldVehicleNumbers,
//       newVehicleNumbers,
//       noOfVehicles,
//       description,
//       remark,
//       assignee,
//       projectName,
//       qstClientTicketNo,
//       technician: rawTechnician = undefined,
//       imeiNumber,
//       simNumber,
//       issueFound,
//       resolution,
//       techCharges,
//       materialCharges,
//       courierCharges,
//       techConveyance,
//       customerConveyance,
//       ticketStatus,
//       techAccountNumber,
//       techIfscCode,
//       accountHolder,
//       state,
//       subjectLine,
//       totalTechCharges,
//       customerCharges,
//       totalCustomerCharges,
//       ticketClosureReason,
//       dueDate,
//       qstProjectID,
//       ticketAvailabilityDate,
//       dueDateChangeReason,
//       filesToDelete = [],
//     } = req.body;

//     const technician = rawTechnician === "" ? undefined : rawTechnician;
//     const issueFoundRef = issueFound === "" ? undefined : issueFound;
//     const resolutionRef = resolution === "" ? undefined : resolution;

//     const requiredFields = {
//       qstClient,
//       location,
//       taskType,
//       assignee,
//       state,
//       ticketStatus,
//       dueDate,
//     };

//     const missingFields = Object.entries(requiredFields)
//       .filter(([key, value]) => !value)
//       .map(([key]) => key);

//     if (missingFields.length > 0) {
//       return res.status(400).json({
//         success: false,
//         message: `Missing required field(s): ${missingFields.join(", ")}`,
//       });
//     }

//     const isPastDate = (date) => {
//       const today = new Date();
//       today.setHours(0, 0, 0, 0);
//       const due = new Date(date);
//       due.setHours(0, 0, 0, 0);
//       return due < today;
//     };

//     if (!(ticketStatus === "work done")) {
//       if (isPastDate(dueDate)) {
//         return res.status(400).json({
//           success: false,
//           message: "Due date must be today or in the future",
//         });
//       }
//     }

//     // // ✅ DUE DATE EDIT LIMIT CHECK
//     // if (dueDate && existingTicket.dueDate) {
//     //   const oldDate = new Date(existingTicket.dueDate).toISOString().split("T")[0];
//     //   const newDate = new Date(dueDate).toISOString().split("T")[0];

//     //   if (oldDate !== newDate) {

//     //     // ❌ BLOCK IF ALREADY EDITED TWICE
//     //     if (existingTicket.dueDateEditCount >= 2) {
//     //       return res.status(400).json({
//     //         success: false,
//     //         message: "Due date can only be edited a maximum of 2 times."
//     //       });
//     //     }

//     //     // ✅ Increment edit count
//     //     existingTicket.dueDateEditCount += 1;
//     //     await existingTicket.save();

//     //     // ✅ Log the change
//     //     const dueDateChangeLog = new DueDateChangeLog({
//     //       ticketId,
//     //       changedBy: req.user._id,
//     //       previousDueDate: existingTicket.dueDate,
//     //       newDueDate: dueDate,
//     //       changeReason: dueDateChangeReason,
//     //       changedAt: new Date()
//     //     });

//     //     await dueDateChangeLog.save();

//     //     await Ticket.findByIdAndUpdate(ticketId, {
//     //       $push: { DueDateChangeLog: dueDateChangeLog._id }
//     //     });
//     //   }
//     // }

//     // ✅ DUE DATE EDIT LIMIT CHECK
// if (dueDate && existingTicket.dueDate) {
//   const oldDate = new Date(existingTicket.dueDate).toISOString().split("T")[0];
//   const newDate = new Date(dueDate).toISOString().split("T")[0];

//   if (oldDate !== newDate) {

//     // ❌ Only apply edit limit to CSE role
//     if (role === "cse" && existingTicket.dueDateEditCount >= 2) {
//       return res.status(400).json({
//         success: false,
//         message: "You have already edited the due date 2 times. CSE cannot edit again."
//       });
//     }

//     // ✅ Increment edit count ONLY for CSE
//     if (role === "cse") {
//       existingTicket.dueDateEditCount += 1;
//       await existingTicket.save();
//     }

//     // ✅ Always log date change (for all roles)
//     const dueDateChangeLog = new DueDateChangeLog({
//       ticketId,
//       changedBy: req.user._id,
//       previousDueDate: existingTicket.dueDate,
//       newDueDate: dueDate,
//       changeReason: dueDateChangeReason,
//       changedAt: new Date()
//     });

//     await dueDateChangeLog.save();

//     await Ticket.findByIdAndUpdate(ticketId, {
//       $push: { DueDateChangeLog: dueDateChangeLog._id }
//     });
//   }
// }


//     if (qstProjectID && !mongoose.Types.ObjectId.isValid(qstProjectID)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid project ID format",
//       });
//     }

//     const cleanObjectIdField = (value) =>
//       value === "" || value === null || value === undefined ? undefined : value;

//     const [
//       ticketExists,
//       clientDoc,
//       assigneeExists,
//       taskDoc,
//       deviceExists,
//       techExists,
//       projectExists,
//     ] = await Promise.all([
//       Ticket.exists({ _id: ticketId }),
//       QstClient.findById(cleanObjectIdField(qstClient)),
//       Employee.findById(cleanObjectIdField(assignee)),
//       Task.findById(cleanObjectIdField(taskType)),
//       deviceType ? Device.findById(cleanObjectIdField(deviceType)) : Promise.resolve(null),
//       technician ? Technician.findById(cleanObjectIdField(technician)) : Promise.resolve(null),
//       qstProjectID ? Project.exists({ _id: qstProjectID }) : Promise.resolve(true),
//     ]);

//     if (!ticketExists)
//       return res.status(404).json({ success: false, message: "Ticket not found" });
//     if (!clientDoc)
//       return res.status(404).json({ success: false, message: "QST Client not found" });
//     if (!assigneeExists)
//       return res.status(404).json({ success: false, message: "Assignee not found" });
//     if (!taskDoc)
//       return res.status(404).json({ success: false, message: "Task type not found" });
//     if (deviceType && !deviceExists)
//       return res.status(404).json({ success: false, message: "Device type not found" });
//     if (technician && !techExists)
//       return res.status(404).json({ success: false, message: "Technician not found" });
//     if (qstProjectID && !projectExists)
//       return res.status(404).json({ success: false, message: "Project not found" });

//     if (ticketStatus === "work not done" && !ticketClosureReason) {
//       return res.status(400).json({
//         success: false,
//         message: "Ticket closure reason is required when status is 'work not done'",
//       });
//     }

//     const taskTypeDoc = await Task.findById(taskType);
//     const isReinstallation =
//       taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("reinstallation");

//     let vehicleNumbersArray = [];
//     let oldVehicleNumbersArray = [];
//     let newVehicleNumbersArray = [];

//     if (isReinstallation) {
//       oldVehicleNumbersArray = Array.isArray(oldVehicleNumbers)
//         ? oldVehicleNumbers
//         : oldVehicleNumbers
//           ? oldVehicleNumbers.split(",").map((v) => v.trim())
//           : [];

//       newVehicleNumbersArray = Array.isArray(newVehicleNumbers)
//         ? newVehicleNumbers
//         : newVehicleNumbers
//           ? newVehicleNumbers.split(",").map((v) => v.trim())
//           : [];

//       if (oldVehicleNumbersArray.length !== newVehicleNumbersArray.length) {
//         return res.status(400).json({
//           success: false,
//           message: "Old and New Vehicle Numbers must have the same count",
//         });
//       }
//     } else {
//       vehicleNumbersArray = Array.isArray(vehicleNumbers)
//         ? vehicleNumbers
//         : vehicleNumbers
//           ? vehicleNumbers.split(",").map((v) => v.trim())
//           : [];
//     }

//     const isServiceTask =
//       taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("service");

//     if (ticketStatus === "work done" && isServiceTask) {
//       if (!issueFoundRef) {
//         return res.status(400).json({
//           success: false,
//           message: "Issue Found reference is required when status is 'work done' and task type is service",
//         });
//       }
//       if (!resolutionRef) {
//         return res.status(400).json({
//           success: false,
//           message: "Resolution reference is required when status is 'work done' and task type is service",
//         });
//       }
//     }

//     if (filesToDelete.length > 0) {
//       try {
//         await Promise.all(
//           filesToDelete.map(async (fileIdentifier) => {
//             const key = extractS3Key(fileIdentifier);
//             await deleteFromS3(key).catch((err) => console.error(err));
//           })
//         );
//       } catch (batchError) {
//         console.error("Batch file deletion error:", batchError);
//       }
//     }

//     let attachmentUrls = [];

//     if (Array.isArray(existingTicket.attachedFiles)) {
//       attachmentUrls = existingTicket.attachedFiles.filter((file) => {
//         const fileKey = extractS3Key(file);
//         return !filesToDelete.some(
//           (toDelete) => fileKey === extractS3Key(toDelete)
//         );
//       });
//     }

//     if (Array.isArray(req.body.attachedFiles)) {
//       req.body.attachedFiles.forEach((item) => {
//         if (item == null) return;
//         const url =
//           typeof item === "string"
//             ? item
//             : `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${item.key}`;

//         if (url && !attachmentUrls.includes(url)) {
//           attachmentUrls.push(url);
//         }
//       });
//     }

//     attachmentUrls = [...new Set(attachmentUrls)];

//     const existingVehicleMap = {};
//     if (Array.isArray(existingTicket.vehicleNumbers)) {
//       existingTicket.vehicleNumbers.forEach((veh) => {
//         existingVehicleMap[veh.vehicleNumber] = veh;
//       });
//     }

//     let finalVehicleNumbers = [];

//     if (isReinstallation) {
//       finalVehicleNumbers = newVehicleNumbersArray.map((newNumber) => {
//         const existing = existingVehicleMap[newNumber];
//         return {
//           vehicleNumber: newNumber,
//           images: existing?.images || [],
//           videoURL: existing?.videoURL || "",
//           isResinstalationTypeNewVehicalNumber: true,
//         };
//       });
//     } else {
//       finalVehicleNumbers = vehicleNumbersArray.map((number) => {
//         const existing = existingVehicleMap[number];
//         return {
//           vehicleNumber: number,
//           images: existing?.images || [],
//           videoURL: existing?.videoURL || "",
//           isResinstalationTypeNewVehicalNumber: false,
//         };
//       });
//     }

//     const updateData = {
//       qstClientName: qstClient,
//       taskType,
//       location,
//       technician,
//       dueDate: new Date(dueDate),
//       oldVehicleNumber: isReinstallation ? oldVehicleNumbersArray : [],
//       vehicleNumbers: finalVehicleNumbers,
//       noOfVehicles,
//       description,
//       remark,
//       assignee,
//       qstProjectID: qstProjectID || null,
//       qstClientTicketNumber: qstClientTicketNo,
//       qstClientProjectName: projectName,
//       imeiNumbers: imeiNumber ? imeiNumber.map((i) => i.trim()) : [],
//       simNumbers: simNumber ? simNumber.map((s) => s.trim()) : [],
//       issueFound,
//       resolution,
//       issueFoundRef: issueFoundRef || null,
//       resolutionRef: resolutionRef || null,
//       technicianCharges: parseFloat(techCharges) || 0,
//       materialCharges: parseFloat(materialCharges) || 0,
//       courierCharges: parseFloat(courierCharges) || 0,
//       techConveyance: parseFloat(techConveyance) || 0,
//       customerConveyance: parseFloat(customerConveyance) || 0,
//       ticketStatus,
//       ticketAvailabilityDate,
//       techAccountNumber,
//       techIFSCCode: techIfscCode,
//       accountHolderName: accountHolder,
//       state,
//       subjectLine,
//       totalTechCharges: parseFloat(totalTechCharges) || 0,
//       customerCharges: parseFloat(customerCharges) || 0,
//       totalCustomerCharges: parseFloat(totalCustomerCharges) || 0,
//       reasonForTicketClosure: ticketClosureReason,
//       isTicketClosed:
//         ticketStatus === "work not done" ? true : existingTicket.isTicketClosed,
//       creator: existingTicket.creator,
//       createdAt: existingTicket.createdAt,
//       attachedFiles: attachmentUrls,
//       technicianNameString: techExists ? techExists.nickName : "",
//       assigneeNameString: assigneeExists ? assigneeExists.name : "",
//       devicetypeNameString: deviceExists ? deviceExists.deviceName : "",
//       qstClientNameString: clientDoc ? clientDoc.companyShortName : "",
//       taskTypeString: taskDoc ? taskDoc.taskName : existingTicket.taskTypeString,
//     };

//     if (deviceType) {
//       updateData.deviceType = deviceType;
//     } else {
//       updateData.$unset = { deviceType: 1 };
//     }

//     const updatedTicket = await Ticket.findByIdAndUpdate(ticketId, updateData, {
//       new: true,
//       runValidators: true,
//     }).populate([
//       { path: "qstClientName", select: "companyShortName" },
//       { path: "assignee", select: "name" },
//       { path: "taskType", select: "taskName" },
//       { path: "deviceType", select: "deviceName" },
//       { path: "technician", select: "name email _id" },
//       { path: "creator", select: "name" },
//       { path: "qstProjectID", select: "projectName _id" },
//       { path: "issueFoundRef", select: "name description" },
//       { path: "resolutionRef", select: "name description" },
//     ]);

//     if (technician && updatedTicket.technician?.email && technician !== existingTicket.technician?.toString()) {
//       try {
//         await securityCodeModel.deleteMany({ ticketId: ticketId });
//         const securityCode = Math.floor(100000 + Math.random() * 900000).toString();
//         const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

//         await securityCodeModel.create({
//           securityCode,
//           ticketId,
//           technicianId: technician,
//           expiresAt,
//         });

//         const emailContent = generateTechnicianAssignmentEmail(
//           updatedTicket.toObject(),
//           updatedTicket.technician,
//           securityCode
//         );

//         await sendEmail({
//           to: updatedTicket?.technician.email,
//           subject: emailContent.subject,
//           html: emailContent.html,
//           text: emailContent.text,
//         });

//       } catch (emailError) {
//         console.error("Failed to send technician email:", emailError);
//       }
//     }

//     res.status(200).json({
//       success: true,
//       message: "Ticket updated successfully",
//       data: updatedTicket,
//     });

//   } catch (error) {
//     console.error("Error updating ticket:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: error.message,
//     });
//   }
// };


const updateTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const role = req.user.role;
    console.log("Role is : ", role);

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID format",
      });
    }

    const existingTicket = await Ticket.findById(ticketId);
    if (!existingTicket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // ✅ Lock ticket if dueDateEditCount > 2 (only applicable to CSE role)
    // Admin and superAdmin can always update tickets regardless of lock status
    if (existingTicket.dueDateEditCount > 2) {
      // Ensure ticket is locked
      if (!existingTicket.isTicketLocked) {
        existingTicket.isTicketLocked = true;
        await existingTicket.save();
      }

      // Block non-CSE, non-admin, non-superAdmin users from updating locked tickets
      // CSE, admin, and superAdmin can update locked tickets
      if (role !== "cse" && role !== "admin" && role !== "superAdmin") {
        return res.status(403).json({
          success: false,
          message:
            "Ticket is locked. Only CSE, admin, and superAdmin users can update this ticket.",
        });
      }
    }

    // ✅ Lock ticket if dueDateEditCount > 2 (only applicable to CSE role)
    // Admin and superAdmin can always update tickets regardless of lock status
    if (existingTicket.dueDateEditCount > 2) {
      // Ensure ticket is locked
      if (!existingTicket.isTicketLocked) {
        existingTicket.isTicketLocked = true;
        await existingTicket.save();
      }

      // Block non-CSE, non-admin, non-superAdmin users from updating locked tickets
      // CSE, admin, and superAdmin can update locked tickets
      if (role !== "cse" && role !== "admin" && role !== "superAdmin") {
        return res.status(403).json({
          success: false,
          message:
            "Ticket is locked. Only CSE, admin, and superAdmin users can update this ticket.",
        });
      }
    }

    const {
      qstClient = undefined,
      location,
      taskType = undefined,
      deviceType = undefined,
      vehicleNumbers,
      oldVehicleNumbers,
      newVehicleNumbers,
      noOfVehicles,
      description,
      remark,
      assignee,
      projectName,
      qstClientTicketNo,
      technician: rawTechnician = undefined,
      imeiNumber,
      simNumber,
      issueFound,
      resolution,
      techCharges,
      materialCharges,
      courierCharges,
      techConveyance,
      customerConveyance,
      ticketStatus,
      techAccountNumber,
      techIfscCode,
      accountHolder,
      state,
      subjectLine,
      totalTechCharges,
      customerCharges,
      totalCustomerCharges,
      ticketClosureReason,
      dueDate,
      isTicketLocked,
      qstProjectID,
      ticketAvailabilityDate,
      dueDateChangeReason,
      filesToDelete = [],
    } = req.body;

    const technician = rawTechnician === "" ? undefined : rawTechnician;
    const issueFoundRef = issueFound === "" ? undefined : issueFound;
    const resolutionRef = resolution === "" ? undefined : resolution;

    const requiredFields = {
      qstClient,
      location,
      taskType,
      assignee,
      state,
      ticketStatus,
      dueDate,
    };

    const missingFields = Object.entries(requiredFields)
      .filter(([key, value]) => !value)
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required field(s): ${missingFields.join(", ")}`,
      });
    }

    const isPastDate = (date) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const due = new Date(date);
      due.setHours(0, 0, 0, 0);
      return due < today;
    };

    if (!(ticketStatus === "work done")) {
      // Check if due date is in the past
      if (isPastDate(dueDate)) {
        // Allow overdue date only if it's the same as the existing ticket's due date (not changing it)
        const existingDueDate = existingTicket.dueDate
          ? new Date(existingTicket.dueDate).toISOString().split("T")[0]
          : null;
        const newDueDate = new Date(dueDate).toISOString().split("T")[0];

        // If the due date is being changed to a past date, reject it
        // But if it's the same overdue date (not changing), allow it
        if (existingDueDate !== newDueDate) {
          return res.status(400).json({
            success: false,
            message: "Due date must be today or in the future",
          });
        }
        // If due date is unchanged and overdue, allow it (for updating other fields on overdue tickets)
      }
    }

    // // ✅ DUE DATE EDIT LIMIT CHECK
    // if (dueDate && existingTicket.dueDate) {
    //   const oldDate = new Date(existingTicket.dueDate).toISOString().split("T")[0];
    //   const newDate = new Date(dueDate).toISOString().split("T")[0];

    //   if (oldDate !== newDate) {

    //     // ❌ BLOCK IF ALREADY EDITED TWICE
    //     if (existingTicket.dueDateEditCount >= 2) {
    //       return res.status(400).json({
    //         success: false,
    //         message: "Due date can only be edited a maximum of 2 times."
    //       });
    //     }

    //     // ✅ Increment edit count
    //     existingTicket.dueDateEditCount += 1;
    //     await existingTicket.save();

    //     // ✅ Log the change
    //     const dueDateChangeLog = new DueDateChangeLog({
    //       ticketId,
    //       changedBy: req.user._id,
    //       previousDueDate: existingTicket.dueDate,
    //       newDueDate: dueDate,
    //       changeReason: dueDateChangeReason,
    //       changedAt: new Date()
    //     });

    //     await dueDateChangeLog.save();

    //     await Ticket.findByIdAndUpdate(ticketId, {
    //       $push: { DueDateChangeLog: dueDateChangeLog._id }
    //     });
    //   }
    // }

    // ✅ DUE DATE EDIT LIMIT CHECK
    if (dueDate && existingTicket.dueDate) {
      const oldDate = new Date(existingTicket.dueDate)
        .toISOString()
        .split("T")[0];
      const newDate = new Date(dueDate).toISOString().split("T")[0];

      if (oldDate !== newDate) {
        // ❌ Only apply edit limit to CSE role - Block if count is already >= 2
        // ❌ Only apply edit limit to CSE role - Block if count is already >= 2
        if (role === "cse" && existingTicket.dueDateEditCount >= 2) {
          // Ensure ticket is locked
          if (!existingTicket.isTicketLocked) {
            existingTicket.isTicketLocked = true;
            await existingTicket.save();
          }
          // Ensure ticket is locked
          if (!existingTicket.isTicketLocked) {
            existingTicket.isTicketLocked = true;
            await existingTicket.save();
          }
          return res.status(400).json({
            success: false,
            message:
              "You have already edited the due date 2 times. Ticket is now locked and cannot be edited further.",
          });
        }

        // ✅ Increment edit count ONLY for CSE
        if (role === "cse") {
          existingTicket.dueDateEditCount += 1;

          // Lock ticket if count exceeds 2 after incrementing
          if (existingTicket.dueDateEditCount > 2) {
            existingTicket.isTicketLocked = true;
          }

          await existingTicket.save();
        }

        // ✅ Always log date change (for all roles)
        const dueDateChangeLog = new DueDateChangeLog({
          ticketId,
          changedBy: req.user._id,
          previousDueDate: existingTicket.dueDate,
          newDueDate: dueDate,
          changeReason: dueDateChangeReason,
          changedAt: new Date(),
        });

        await dueDateChangeLog.save();

        await Ticket.findByIdAndUpdate(ticketId, {
          $push: { DueDateChangeLog: dueDateChangeLog._id },
        });
      }
    }

    if (qstProjectID && !mongoose.Types.ObjectId.isValid(qstProjectID)) {
      return res.status(400).json({
        success: false,
        message: "Invalid project ID format",
      });
    }

    const cleanObjectIdField = (value) =>
      value === "" || value === null || value === undefined ? undefined : value;

    const [
      ticketExists,
      clientDoc,
      assigneeExists,
      taskDoc,
      deviceExists,
      techExists,
      projectExists,
    ] = await Promise.all([
      Ticket.exists({ _id: ticketId }),
      QstClient.findById(cleanObjectIdField(qstClient)),
      Employee.findById(cleanObjectIdField(assignee)),
      Task.findById(cleanObjectIdField(taskType)),
      deviceType
        ? Device.findById(cleanObjectIdField(deviceType))
        : Promise.resolve(null),
      technician
        ? Technician.findById(cleanObjectIdField(technician))
        : Promise.resolve(null),
      qstProjectID
        ? Project.exists({ _id: qstProjectID })
        : Promise.resolve(true),
    ]);

    if (!ticketExists)
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found" });
    if (!clientDoc)
      return res
        .status(404)
        .json({ success: false, message: "QST Client not found" });
    if (!assigneeExists)
      return res
        .status(404)
        .json({ success: false, message: "Assignee not found" });
    if (!taskDoc)
      return res
        .status(404)
        .json({ success: false, message: "Task type not found" });
    if (deviceType && !deviceExists)
      return res
        .status(404)
        .json({ success: false, message: "Device type not found" });
    if (technician && !techExists)
      return res
        .status(404)
        .json({ success: false, message: "Technician not found" });
    if (qstProjectID && !projectExists)
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });

    if (ticketStatus === "work not done" && !ticketClosureReason) {
      return res.status(400).json({
        success: false,
        message:
          "Ticket closure reason is required when status is 'work not done'",
      });
    }

    const taskTypeDoc = await Task.findById(taskType);
    const isReinstallation =
      taskTypeDoc &&
      taskTypeDoc.taskName.toLowerCase().includes("reinstallation");

    let vehicleNumbersArray = [];
    let oldVehicleNumbersArray = [];
    let newVehicleNumbersArray = [];

    if (isReinstallation) {
      oldVehicleNumbersArray = Array.isArray(oldVehicleNumbers)
        ? oldVehicleNumbers
        : oldVehicleNumbers
          ? oldVehicleNumbers.split(",").map((v) => v.trim())
          : [];

      newVehicleNumbersArray = Array.isArray(newVehicleNumbers)
        ? newVehicleNumbers
        : newVehicleNumbers
          ? newVehicleNumbers.split(",").map((v) => v.trim())
          : [];

      if (oldVehicleNumbersArray.length !== newVehicleNumbersArray.length) {
        return res.status(400).json({
          success: false,
          message: "Old and New Vehicle Numbers must have the same count",
        });
      }
    } else {
      vehicleNumbersArray = Array.isArray(vehicleNumbers)
        ? vehicleNumbers
        : vehicleNumbers
          ? vehicleNumbers.split(",").map((v) => v.trim())
          : [];
    }

    const isServiceTask =
      taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("service");

    if (ticketStatus === "work done" && isServiceTask) {
      if (!issueFoundRef) {
        return res.status(400).json({
          success: false,
          message:
            "Issue Found reference is required when status is 'work done' and task type is service",
        });
      }
      if (!resolutionRef) {
        return res.status(400).json({
          success: false,
          message:
            "Resolution reference is required when status is 'work done' and task type is service",
        });
      }
    }

    if (filesToDelete.length > 0) {
      try {
        await Promise.all(
          filesToDelete.map(async (fileIdentifier) => {
            const key = extractS3Key(fileIdentifier);
            await deleteFromS3(key).catch((err) => console.error(err));
          })
        );
      } catch (batchError) {
        console.error("Batch file deletion error:", batchError);
      }
    }

    let attachmentUrls = [];

    if (Array.isArray(existingTicket.attachedFiles)) {
      attachmentUrls = existingTicket.attachedFiles.filter((file) => {
        const fileKey = extractS3Key(file);
        return !filesToDelete.some(
          (toDelete) => fileKey === extractS3Key(toDelete)
        );
      });
    }

    if (Array.isArray(req.body.attachedFiles)) {
      req.body.attachedFiles.forEach((item) => {
        if (item == null) return;
        const url =
          typeof item === "string"
            ? item
            : `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${item.key}`;

        if (url && !attachmentUrls.includes(url)) {
          attachmentUrls.push(url);
        }
      });
    }

    attachmentUrls = [...new Set(attachmentUrls)];

    const existingVehicleMap = {};
    if (Array.isArray(existingTicket.vehicleNumbers)) {
      existingTicket.vehicleNumbers.forEach((veh) => {
        existingVehicleMap[veh.vehicleNumber] = veh;
      });
    }

    let finalVehicleNumbers = [];

    if (isReinstallation) {
      finalVehicleNumbers = newVehicleNumbersArray.map((newNumber) => {
        const existing = existingVehicleMap[newNumber];
        return {
          vehicleNumber: newNumber,
          images: existing?.images || [],
          videoURL: existing?.videoURL || "",
          isResinstalationTypeNewVehicalNumber: true,
          isDone: existing?.isDone ?? false,   // ← preserve technician's mark
        };
      });
    } else {
      finalVehicleNumbers = vehicleNumbersArray.map((number) => {
        const existing = existingVehicleMap[number];
        return {
          vehicleNumber: number,
          images: existing?.images || [],
          videoURL: existing?.videoURL || "",
          isResinstalationTypeNewVehicalNumber: false,
          isDone: existing?.isDone ?? false,   // ← preserve technician's mark
        };
      });
    }

    const updateData = {
      qstClientName: qstClient,
      taskType,
      location,
      technician,
      dueDate: new Date(dueDate),
      oldVehicleNumber: isReinstallation ? oldVehicleNumbersArray : [],
      vehicleNumbers: finalVehicleNumbers,
      noOfVehicles,
      description,
      remark,
      assignee,
      qstProjectID: qstProjectID || null,
      qstClientTicketNumber: qstClientTicketNo,
      qstClientProjectName: projectName,
      imeiNumbers: imeiNumber ? imeiNumber.map((i) => i.trim()) : [],
      simNumbers: simNumber ? simNumber.map((s) => s.trim()) : [],
      issueFound,
      resolution,
      issueFoundRef: issueFoundRef || null,
      resolutionRef: resolutionRef || null,
      technicianCharges: parseFloat(techCharges) || 0,
      materialCharges: parseFloat(materialCharges) || 0,
      courierCharges: parseFloat(courierCharges) || 0,
      techConveyance: parseFloat(techConveyance) || 0,
      customerConveyance: parseFloat(customerConveyance) || 0,
      ticketStatus,
      ticketAvailabilityDate,
      techAccountNumber,
      techIFSCCode: techIfscCode,
      accountHolderName: accountHolder,
      state,
      subjectLine,
      totalTechCharges: parseFloat(totalTechCharges) || 0,
      customerCharges: parseFloat(customerCharges) || 0,
      totalCustomerCharges: parseFloat(totalCustomerCharges) || 0,
      reasonForTicketClosure: ticketClosureReason,
      isTicketClosed:
        ticketStatus === "work not done" ? true : existingTicket.isTicketClosed,
      creator: existingTicket.creator,
      createdAt: existingTicket.createdAt,
      attachedFiles: attachmentUrls,
      technicianNameString: techExists ? techExists.nickName : "",
      assigneeNameString: assigneeExists ? assigneeExists.name : "",
      devicetypeNameString: deviceExists ? deviceExists.deviceName : "",
      qstClientNameString: clientDoc ? clientDoc.companyShortName : "",
      taskTypeString: taskDoc
        ? taskDoc.taskName
        : existingTicket.taskTypeString,
    };

    // Allow admin and superAdmin to unlock tickets
    if (
      isTicketLocked !== undefined &&
      (role === "admin" || role === "superAdmin")
    ) {
      updateData.isTicketLocked = isTicketLocked;
      // Reset dueDateEditCount when unlocking to give CSE a fresh chance
      if (isTicketLocked === false) {
        updateData.dueDateEditCount = 0;
      }
    }

    if (deviceType) {
      updateData.deviceType = deviceType;
    } else {
      updateData.$unset = { deviceType: 1 };
    }

    const updatedTicket = await Ticket.findByIdAndUpdate(ticketId, updateData, {
      new: true,
      runValidators: true,
    }).populate([
      { path: "qstClientName", select: "companyShortName companyName gstNo billingCategory billingAddress" },
      { path: "assignee", select: "name" },
      { path: "taskType", select: "taskName" },
      { path: "deviceType", select: "deviceName" },
      { path: "technician", select: "name email _id" },
      { path: "creator", select: "name" },
      { path: "qstProjectID", select: "projectName _id" },
      { path: "spareSwaps" },
      { path: "softCloseByTechnicianComment", select: "reason" },
      // { path: "issueFoundRef", select: "name description" },
      // { path: "resolutionRef", select: "name description" },
    ]);

    if (
      technician &&
      updatedTicket.technician?.email &&
      technician !== existingTicket.technician?.toString()
    ) {
      try {
        await securityCodeModel.deleteMany({ ticketId: ticketId });
        const securityCode = Math.floor(
          100000 + Math.random() * 900000
        ).toString();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await securityCodeModel.create({
          securityCode,
          ticketId,
          technicianId: technician,
          expiresAt,
        });

        const emailContent = generateTechnicianAssignmentEmail(
          updatedTicket.toObject(),
          updatedTicket.technician,
          securityCode
        );

        console.log("SENDING MAIL TO TECHNICIAN:", updatedTicket?.technician.email);
        await sendEmail({
          to: updatedTicket?.technician.email,
          // to: 'emailmdowais483@gmail.com',
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
        });
      } catch (emailError) {
        console.error("Failed to send technician email:", emailError);
      }
    }

    // ── Fire-and-forget: forward to /abc-send-data when CSE closes ticket ──
    if (role === "cse" && (ticketStatus === "work done" || ticketStatus === "work not done")) {
      // Only fires on the FIRST transition into a closed state
      if (existingTicket.ticketStatus !== "work done" && existingTicket.ticketStatus !== "work not done") {
        (async () => {
          try {
            const externalUrl = 'https://algotrack.in/AlgoCRMAPI/api/vehicle/sync-vehicle';
            const payload = await buildCseClosePayload(updatedTicket);

            console.log("[SecondSystem] CSE closed ticket. Payload being sent to Sync Vehicle API :", JSON.stringify(payload, null, 2));
            const r = await fetch(externalUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            const bodyText = await r.text().catch(() => "");
            if (r.ok) {
              console.log(`[SecondSystem] Forwarded ticket ${updatedTicket._id} to /abc-send-data – status ${r.status}`);
            } else {
              console.error(`[SecondSystem] ERROR forwarding ticket ${updatedTicket._id} – status ${r.status}`);
              console.error("[SecondSystem] Error body:", bodyText);
            }
          } catch (err) {
            console.error("[SecondSystem] Failed to forward ticket on CSE close:", err.message);
          }
        })();
      }
    }
    // ─────────────────────────────────────────────────────────────────────────


    res.status(200).json({
      success: true,
      message: "Ticket updated successfully",
      data: updatedTicket,
    });
  } catch (error) {
    console.error("Error updating ticket:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


function extractS3Key(url) {
  // console.log(url, "chala url aaya");
  if (!url) return "";
  // If it's already a key (no http), return as-is
  if (!url.startsWith("http")) return url;

  // Extract key from URL format: https://bucket.s3.region.amazonaws.com/key
  try {
    const urlObj = new URL(url);
    return urlObj.pathname.substring(1); // Remove leading slash
  } catch (e) {
    console.error("Invalid S3 URL:", url);
    return url; // fallback to returning original
  }
}

async function deleteFromS3(key) {
  if (!key) return true; // Skip if no key provided
  console.log("images deleted run");
  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
  };

  try {
    await s3.deleteObject(params).promise();
    console.log(`Successfully deleted ${key} from S3 ...................`);
    return true;
  } catch (error) {
    console.error(`Error deleting ${key} from S3:`, error);
    throw error;
  }
}

const saveImageAndVideoURlToTicketUploadByCSE = async (req, res) => {
  try {
    const { ticketId, vehicleId } = req.params;
    const {
      images = [],
      videoKey = "",
      imagesToDelete = [],
      videoToDelete = "",
    } = req.body;

    // console.log(req.body);
    // Validate required fields
    if (!ticketId || !vehicleId) {
      return res.status(400).json({
        success: false,
        message: "Ticket ID and Vehicle ID are required",
      });
    }

    // Validate images array (max 4 images)
    if (images.length > 4) {
      return res.status(400).json({
        success: false,
        message: "Maximum 4 images allowed",
      });
    }

    // console.log('Before extractS3Key call', typeof extractS3Key, extractS3Key);

    // Clean up old media from S3
    try {
      // Delete old images
      if (imagesToDelete.length > 0) {
        console.log("Deleting images:", imagesToDelete);
        await Promise.all(
          imagesToDelete
            .filter((url) => url && typeof url === "string") // Ensure url exists and is a string
            .map(async (url) => {
              try {
                const key = extractS3Key(url);
                console.log(`Deleting image with key: ${key}`);
                await deleteFromS3(key);
              } catch (error) {
                console.error(`Error deleting image ${url}:`, error);
                // Continue with other deletions even if one fails
              }
            })
        );
      }

      // Delete old video
      if (videoToDelete && typeof videoToDelete === "string") {
        try {
          const videoKeyToDelete = extractS3Key(videoToDelete);
          console.log(`Deleting video with key: ${videoKeyToDelete}`);
          await deleteFromS3(videoKeyToDelete);
        } catch (error) {
          console.error(`Error deleting video ${videoToDelete}:`, error);
          // Continue with DB update even if video deletion fails
        }
      }
    } catch (s3Error) {
      console.error("Error deleting old media from S3:", s3Error);
      // Continue with DB update even if S3 cleanup fails
    }

    //   // Clean up old media from S3
    // try {
    //   // Delete old images
    //   if (imagesToDelete.length > 0) {
    //     console.log("Deleting images:", imagesToDelete);
    //     await Promise.all(
    //       imagesToDelete
    //         .filter(url => url)
    //         .map(async (url) => {
    //           const key = extractS3Key(url);
    //           console.log(`Deleting image with key: ${key}`);
    //           return await deleteFromS3(key);
    //         })
    //     );
    //   }

    //   // Delete old video
    //   if (videoToDelete) {
    //     const videoKey = extractS3Key(videoToDelete);
    //     console.log(`Deleting video with key: ${videoKey}`);
    //     await deleteFromS3(videoKey);
    //   }
    // } catch (s3Error) {
    //   console.error("Error deleting old media from S3:", s3Error);
    //   // Continue with DB update even if S3 cleanup fails
    // }

    // Construct full URLs for images and video
    const bucketName = process.env.AWS_S3_BUCKET_NAME;
    const region = process.env.AWS_REGION;

    const fullImageUrls = images
      .filter((url) => url)
      .map((key) => {
        // If it's already a full URL, return as-is
        if (key.startsWith("http")) return key;
        // Otherwise construct full URL
        return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
      });

    let fullVideoUrl = "";
    if (videoKey) {
      fullVideoUrl = videoKey.startsWith("http")
        ? videoKey
        : `https://${bucketName}.s3.${region}.amazonaws.com/${videoKey}`;
    }

    // Prepare update object with full URLs
    const updateObj = {
      $set: {
        "vehicleNumbers.$[vehicle].images": fullImageUrls,
        "vehicleNumbers.$[vehicle].videoURL": fullVideoUrl,
      },
    };

    const options = {
      new: true,
      arrayFilters: [{ "vehicle._id": vehicleId }],
      runValidators: true,
    };

    // Update the ticket
    const updatedTicket = await Ticket.findByIdAndUpdate(
      ticketId,
      updateObj,
      options
    );

    if (!updatedTicket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }

    // Find the updated vehicle
    const updatedVehicle = updatedTicket.vehicleNumbers.find(
      (v) => v._id.toString() === vehicleId
    );

    return res.status(200).json({
      success: true,
      message: "Media updated successfully",
      data: {
        ticketId: updatedTicket._id,
        vehicleId: updatedVehicle._id,
        images: updatedVehicle.images,
        videoURL: updatedVehicle.videoURL,
      },
    });
  } catch (error) {
    console.error("Error saving media to ticket:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update media",
      error: error.message,
    });
  }
};

// -------------------------------------------------
//  / Get all tickets for ticket charge rate table display
const getAllOpenTicketsForApplyCharge = async (req, res) => {
  try {
    const { search, page = 1, limit = 10, status } = req.query;

    let query = { isTicketClosed: false, ticketStatus: "work done" }; // Only get open tickets

    if (search) {
      const orConditions = [
        { qstClientTicketNumber: { $regex: search, $options: "i" } },
        { subjectLine: { $regex: search, $options: "i" } },
        { qstClientProjectName: { $regex: search, $options: "i" } },
      ];

      // ✅ Only add _id condition if search is a valid ObjectId
      if (mongoose.Types.ObjectId.isValid(search)) {
        orConditions.push({ _id: new mongoose.Types.ObjectId(search) });
      }

      query.$or = orConditions;
    }

    if (status && status !== "all") {
      query.ticketStatus = status;
    }

    const total = await Ticket.countDocuments(query);

    const tickets = await Ticket.find(query)
      .select(
        "_id qstClientTicketNumber subjectLine qstClientProjectName noOfVehicles technicianCharges materialCharges courierCharges techConveyance customerConveyance customerCharges totalTechCharges totalCustomerCharges ticketStatus remark chargeApplyComment createdAt"
      )
      .populate("technician", "name")
      .populate("taskType", "taskName")
      .populate("deviceType", "deviceName")
      .populate("qstClientName", "companyName")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    console.log("uuuuu", tickets);

    const formattedTickets = tickets.map((ticket) => ({
      ticketNo: ticket._id,
      subject: ticket.subjectLine,
      deviceName: ticket.deviceType?.deviceName,
      project: ticket.qstClientProjectName,
      qty: ticket.noOfVehicles,
      technicianPerVehicleCharge: ticket.technicianCharges,
      materialCharge: ticket.materialCharges,
      courierCharge: ticket.courierCharges,
      technicianConveyance: ticket.techConveyance,
      customerConveyance: ticket.customerConveyance,
      customerPerVehicleCharge: ticket.customerCharges,
      totalTechCharges: calculateTotalTechnicianCharges(ticket),
      totalCustomerCharges: calculateTotalCustomerCharges(ticket),
      status: ticket.ticketStatus,
      createdAt: ticket.createdAt,
      remark: ticket?.remark,
      chargeApplyComment: ticket?.chargeApplyComment,
    }));

    res.json({
      success: true,
      data: formattedTickets,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tickets",
      error: error.message,
    });
  }
};

const updateTicketApplyCharges = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const {
      technicianPerVehicleCharge,
      materialCharge,
      courierCharge,
      technicianConveyance,
      customerConveyance,
      customerPerVehicleCharge,
      totalTechCharges,
      totalCustomerCharges,
      isTicketClosed,
      noOfVehicles,
      chargeApplyComment,  // ← ADD THIS
    } = req.body;

    // Update the ticket with the new charges
    const updatedTicket = await Ticket.findByIdAndUpdate(
      ticketId,
      {
        $set: {
          technicianCharges: technicianPerVehicleCharge,
          materialCharges: materialCharge,
          courierCharges: courierCharge,
          techConveyance: technicianConveyance,
          customerConveyance: customerConveyance,
          customerCharges: customerPerVehicleCharge,
          totalTechCharges: totalTechCharges,
          totalCustomerCharges: totalCustomerCharges,
          isTicketClosed: isTicketClosed,
          noOfVehicles: noOfVehicles,
          chargeApplyComment: chargeApplyComment,  // ← ADD THIS
          // If ticket is being closed, update the status
          ...(isTicketClosed && { ticketStatus: "work done" }),
        },
      },
      { new: true } // Return the updated document
    );

    if (!updatedTicket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found",
      });
    }



    res.json({
      success: true,
      message: "Ticket charges updated successfully",
      data: updatedTicket,
    });
  } catch (error) {
    console.error("Error updating ticket charges:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update ticket charges",
      error: error.message,
    });
  }
};

function calculateTotalTechnicianCharges(ticket) {
  const technicianCharges = parseFloat(ticket.technicianCharges) || 0;
  const noOfVehicles = parseFloat(ticket.noOfVehicles) || 0;
  const materialCharges = parseFloat(ticket.materialCharges) || 0;
  const courierCharges = parseFloat(ticket.courierCharges) || 0;
  const techConveyance = parseFloat(ticket.techConveyance) || 0;

  return (
    noOfVehicles * technicianCharges +
    techConveyance +
    materialCharges +
    courierCharges
  );
}

function calculateTotalCustomerCharges(ticket) {
  const customerCharges = parseFloat(ticket.customerCharges) || 0;
  const noOfVehicles = parseFloat(ticket.noOfVehicles) || 0;
  const materialCharge = parseFloat(ticket.materialCharges) || 0;
  const courierCharge = parseFloat(ticket.courierCharges) || 0;
  const customerConveyance = parseFloat(ticket.customerConveyance) || 0;

  return (
    noOfVehicles * customerCharges +
    customerConveyance +
    materialCharge +
    courierCharge
  );
}

const ExportTicketDataByDateRange = async (req, res) => {
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

    const tickets = await Ticket.find({
      ticketAvailabilityDate: {
        $gte: from,
        $lte: to,
      },
    })
      .populate("qstClientName", "companyShortName")
      .populate("assignee", "name")
      .populate("taskType", "taskName")
      .populate("deviceType", "deviceName")
      .populate("technician", "name")
      .populate("resolutionRef", "ResolutionName")
      .populate("issueFoundRef", "issueFoundName")
      .populate("creator", "name")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: tickets.length,
      data: tickets,
    });
  } catch (error) {
    console.error("Error fetching filtered tickets:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};






const ExportCanceledTicketDataByDateRange = async (req, res) => {
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

    const tickets = await Ticket.find({
      createdAt: {
        $gte: from,
        $lte: to,
      },
      ticketStatus: "work not done",
      isTicketClosed: true,
    })
      .populate("qstClientName", "companyShortName")
      .populate("assignee", "name")
      .populate("taskType", "taskName")
      .populate("deviceType", "deviceName")
      .populate("technician", "name")
      .populate("resolutionRef", "ResolutionName")
      .populate("issueFoundRef", "issueFoundName")
      .populate("creator", "name")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: tickets.length,
      data: tickets,
      message: "Get canceled tickets data successfully"
    });
  } catch (error) {
    console.error("Error fetching filtered tickets:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getClientTicketsByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      page = 1,
      limit = 10,
      search = "",
      status,
      fromDate,
      toDate,
      dateType = "creationDate",
      dueDateFilter,
    } = req.query;

    const skip = (page - 1) * limit;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    const user = await Employee.findById(userId);
    if (!user || user.role !== "qstClient") {
      return res.status(user ? 403 : 404).json({
        success: false,
        message: user
          ? "User is not authorized to access tickets"
          : "User not found",
      });
    }

    const clientId = user.associatedClient;
    if (!clientId) {
      return res.status(404).json({
        success: false,
        message: "No associated client found for this employee",
      });
    }

    console.log(clientId, "ghghghg");


    const qstClient = await QstClient.findById(clientId);
    if (!qstClient) {
      return res.status(404).json({
        success: false,
        message: "Associated QstClient not found",
      });
    }

    // Calculate date ranges for stats and due date filtering
    const now = new Date();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

    const dayAfterStart = new Date(tomorrowStart);
    dayAfterStart.setDate(dayAfterStart.getDate() + 1);
    const dayAfterEnd = new Date(dayAfterStart);
    dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);

    // Build the base query with client filter
    const baseQuery = { qstClientName: qstClient._id, ticketStatus: { $ne: "work not done" } };
    let query = { ...baseQuery };

    // Add status filter if provided
    if (status && status !== "All Tickets") {
      if (status === "Closed") {
        query.$and = [
          ...(query.$and || []),
          { ticketStatus: "work done" },
          // { isTicketClosed: true },    for client work done status  ticket is refer as closed 
        ];
      }
      // else if (status === "Open") {
      //   query.$and = [...(query.$and || []), { isTicketClosed: { $ne: true } },
      // { ticketStatus: { $ne: "work done" } }
      // ];
      // }

      else if (status === "Open") {
        query.$or = [
          { isTicketClosed: { $ne: true } },
          { ticketStatus: { $ne: "work done" } }
        ];
      }

    }

    // Handle date type selection
    const validDateFields = {
      creationDate: "createdAt",
      updatedDate: "updatedAt",
    };
    const selectedDateField = validDateFields[dateType] || "createdAt";

    // Add date range filter if provided
    if (fromDate && toDate) {
      const startDate = new Date(`${fromDate}T00:00:00.000Z`);
      const endDate = new Date(`${toDate}T23:59:59.999Z`);

      query[selectedDateField] = {
        $gte: startDate,
        $lt: endDate,
      };
    }

    // Due date filtering logic
    if (dueDateFilter) {
      switch (dueDateFilter) {
        case "today":
          query.dueDate = {
            $gte: todayStart,
            $lt: todayEnd,
          };
          break;
        case "tomorrow":
          query.dueDate = {
            $gte: tomorrowStart,
            $lt: tomorrowEnd,
          };
          break;
        case "dayAfterTomorrow":
          query.dueDate = {
            $gte: dayAfterStart,
            $lt: dayAfterEnd,
          };
          break;
        case "delayed":
          query.dueDate = {
            $lt: todayStart,
          };
          break;
      }
    }

    // Handle search functionality
    if (search.trim() !== "") {
      const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const safeSearch = escapeRegex(search.trim());
      const searchRegex = new RegExp(safeSearch, "i");

      // Check if search is a valid ObjectId
      let objectIdMatch = null;
      if (mongoose.Types.ObjectId.isValid(search.trim())) {
        objectIdMatch = new mongoose.Types.ObjectId(search.trim());
      }

      const [taskTypes, deviceTypes] = await Promise.all([
        Task.find({ taskName: searchRegex }).select("_id"),
        Device.find({ deviceName: searchRegex }).select("_id"),
      ]);

      query.$or = [
        { qstClientTicketNumber: searchRegex },
        { location: searchRegex },
        { subjectLine: searchRegex },
        { taskType: { $in: taskTypes.map((t) => t._id) } },
        { oldVehicleNumber: searchRegex }, // Search in old vehicle numbers array
        { "vehicleNumbers.vehicleNumber": searchRegex }, // Search in current vehicle numbers
        { deviceType: { $in: deviceTypes.map((d) => d._id) } },
        ...(objectIdMatch ? [{ _id: objectIdMatch }] : []),
      ];
    }

    // Get statistics counts
    const statsQueries = [
      // Open tickets
      Ticket.countDocuments({
        ...baseQuery,
        $or: [{ isTicketClosed: { $ne: true } },
        { ticketStatus: { $ne: "work done" } }
        ],
      }),

      // Closed tickets
      Ticket.countDocuments({
        ...baseQuery,
        $or: [{ ticketStatus: "work done" }, { isTicketClosed: true }],
      }),
      //  it is not used  in this api now  -----------------------------
      // Open tickets due today   
      Ticket.countDocuments({
        ...baseQuery,
        $and: [
          { isTicketClosed: { $ne: true } },
          { dueDate: { $gte: todayStart, $lt: todayEnd } },
        ],
      }),

      // Open tickets due tomorrow
      Ticket.countDocuments({
        ...baseQuery,
        $and: [
          { isTicketClosed: { $ne: true } },
          { dueDate: { $gte: tomorrowStart, $lt: tomorrowEnd } },
        ],
      }),

      // Open tickets due day after tomorrow
      Ticket.countDocuments({
        ...baseQuery,
        $and: [
          { isTicketClosed: { $ne: true } },
          { dueDate: { $gte: dayAfterStart, $lt: dayAfterEnd } },
        ],
      }),

      // Delayed open tickets
      Ticket.countDocuments({
        ...baseQuery,
        $and: [
          { isTicketClosed: { $ne: true } },
          { dueDate: { $lt: todayStart } },
        ],
      }),
      // -------------------------------------------------------
    ];

    const [
      openCount,
      closedCount,
      todayCount,
      tomorrowCount,
      dayAfterCount,
      delayedCount,
    ] = await Promise.all(statsQueries);

    // Get total count for pagination
    const total = await Ticket.countDocuments(query);

    // Get paginated results
    console.log("hhhhh", query);

    const tickets = await Ticket.find(query)
      .select(
        `
        _id status location oldVehicleNumber vehicleNumbers
        noOfVehicles dueDate isTicketClosed reasonForTicketClosure
        imeiNumbers subjectLine simNumbers qstClientTicketNumber
        description issueFound  taskType deviceType state
        createdAt updatedAt description ticketStatus

      `
      )
      .populate({ path: "taskType", select: "taskName" })
      .populate({ path: "deviceType", select: "deviceName" })
      .populate("qstClientName", "companyName companyShortName")
      .populate({
        path: "qstProjectID",
        select: "projectName description", // Make sure projectName is included here
        options: { lean: true } // Optional: makes the returned object plain JavaScript
      })
      .sort({ [selectedDateField]: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    return res.status(200).json({
      success: true,
      message: "Tickets fetched successfully",
      data: tickets,
      stats: {
        open: openCount,
        closed: closedCount,
        // dueDateCounts: {
        //   today: todayCount,
        //   tomorrow: tomorrowCount,
        //   dayAfterTomorrow: dayAfterCount,
        //   delayed: delayedCount,
        // },
      },
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching client tickets:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

const exportClientTicketsByDateRange = async (req, res) => {
  try {
    const { userId } = req.params;
    const { fromDate, toDate } = req.query;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing user ID",
      });
    }

    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "fromDate and toDate are required",
      });
    }

    const user = await Employee.findById(userId);
    if (!user || user.role !== "qstClient") {
      return res.status(user ? 403 : 404).json({
        success: false,
        message: user
          ? "User is not authorized to export tickets"
          : "User not found",
      });
    }

    const clientId = user.associatedClient;
    if (!clientId) {
      return res.status(404).json({
        success: false,
        message: "No associated client found for this employee",
      });
    }

    const qstClient = await QstClient.findById(clientId);
    if (!qstClient) {
      return res.status(404).json({
        success: false,
        message: "Associated QstClient not found",
      });
    }

    const from = dayjs(fromDate).startOf("day").toDate();
    const to = dayjs(toDate).endOf("day").toDate();

    const tickets = await Ticket.find({
      qstClientName: qstClient._id,
      ticketAvailabilityDate: { $gte: from, $lte: to },
    })
      .select(
        `
        _id status location oldVehicleNumber vehicleNumbers
        noOfVehicles dueDate isTicketClosed reasonForTicketClosure
        imeiNumbers subjectLine simNumbers qstClientTicketNumber
        description issueFound qstClientName taskType deviceType
        createdAt updatedAt ticketAvailabilityDate
      `
      )
      .populate({ path: "taskType", select: "taskName" })
      .populate({ path: "deviceType", select: "deviceName" })
      .populate({ path: "qstClientName", select: "companyShortName" })
      .populate({
        path: "qstProjectID",
        select: "projectName description", // Make sure projectName is included here
        options: { lean: true } // Optional: makes the returned object plain JavaScript
      })
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: tickets.length,
      data: tickets,
    });
  } catch (error) {
    console.error("Error exporting tickets by date range:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// const getTicketStatsfordashboard = async (req, res) => {
//   try {
//     const currentDate = new Date();

//     // Use aggregation for performance
//     const tickets = await Ticket.aggregate([
//       {
//         $facet: {
//           totalTickets: [{ $count: "count" }],
//           closedTickets: [
//             { $match: { isTicketClosed: true } },
//             { $count: "count" }
//           ],
//           openTickets: [
//             { $match: { isTicketClosed: false } },
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
//           ]
//         }
//       }
//     ]);

//     const result = tickets[0];

//     res.status(200).json({
//       total: result.totalTickets[0]?.count || 0,
//       open: result.openTickets[0]?.count || 0,
//       closed: result.closedTickets[0]?.count || 0,
//       delayed: result.delayedTickets[0]?.count || 0
//     });
//   } catch (err) {
//     console.error("Error fetching ticket stats:", err.message);
//     res.status(500).json({ message: "Server Error" });
//   }
// };

// const getTicketStatsfordashboard = async (req, res) => {
//   try {
//     // Set current day at midnight (00:00:00)
//     const startOfToday = new Date();
//     startOfToday.setHours(0, 0, 0, 0); // UTC midnight

//     const tickets = await Ticket.aggregate([
//       {
//         $facet: {
//           totalTickets: [{ $count: "count" }],
//           closedTickets: [
//             { $match: { isTicketClosed: true } },
//             { $count: "count" },
//           ],
//           openTickets: [
//             { $match: { isTicketClosed: false } },
//             { $count: "count" },
//           ],
//           delayedTickets: [
//             {
//               $match: {
//                 isTicketClosed: false,
//                 dueDate: { $lt: startOfToday }, // Strict: due before today starts
//               },
//             },
//             { $count: "count" },
//           ],
//         },
//       },
//     ]);

//     const result = tickets[0];

//     res.status(200).json({
//       total: result.totalTickets[0]?.count || 0,
//       open: result.openTickets[0]?.count || 0,
//       closed: result.closedTickets[0]?.count || 0,
//       delayed: result.delayedTickets[0]?.count || 0,
//     });
//   } catch (err) {
//     console.error("Error fetching ticket stats:", err.message);
//     res.status(500).json({ message: "Server Error" });
//   }
// };

const getTicketStatsForDashboard = async (req, res) => {
  try {
    const now = new Date();

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const dailyCount = await Ticket.countDocuments({
      createdAt: { $gte: startOfToday },
    });
    const weeklyCount = await Ticket.countDocuments({
      createdAt: { $gte: startOfWeek },
    });
    const monthlyCount = await Ticket.countDocuments({
      createdAt: { $gte: startOfMonth },
    });
    const yearlyCount = await Ticket.countDocuments({
      createdAt: { $gte: startOfYear },
    });

    res
      .status(200)
      .json({ dailyCount, weeklyCount, monthlyCount, yearlyCount });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error.message);
    res.status(500).json({ message: "Server Error" });
  }
};

const getTicketTrends = async (req, res) => {
  try {
    const now = new Date();

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const weekly = await Ticket.aggregate([
      { $match: { createdAt: { $gte: startOfWeek } } },
      {
        $group: {
          _id: { $dayOfWeek: "$createdAt" },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          day: "$_id",
          count: 1,
        },
      },
    ]);

    const monthly = await Ticket.aggregate([
      { $match: { createdAt: { $gte: startOfMonth } } },
      {
        $group: {
          _id: { $week: "$createdAt" },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          week: "$_id",
          count: 1,
        },
      },
    ]);

    const yearly = await Ticket.aggregate([
      { $match: { createdAt: { $gte: startOfYear } } },
      {
        $group: {
          _id: { $month: "$createdAt" },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          month: "$_id",
          count: 1,
        },
      },
    ]);

    // Format chart data
    const formatChart = (type, data) => {
      if (type === "weekly") {
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return days.map((day, i) => ({
          name: day,
          value: data.find((d) => d.day === i + 1)?.count || 0,
        }));
      } else if (type === "monthly") {
        return Array.from({ length: 5 }).map((_, i) => ({
          name: `Week ${i + 1}`,
          value: data[i]?.count || 0,
        }));
      } else if (type === "yearly") {
        const months = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        return months.map((name, i) => ({
          name,
          value: data.find((d) => d.month === i + 1)?.count || 0,
        }));
      }
    };

    res.status(200).json({
      weekly: formatChart("weekly", weekly),
      monthly: formatChart("monthly", monthly),
      yearly: formatChart("yearly", yearly),
    });
  } catch (error) {
    console.error("Error fetching ticket trends:", error.message);
    res.status(500).json({ message: "Server Error" });
  }
};

// const getClientTicketsAndProjects = async (req, res) => {
//   try {
//     const { qstClientId } = req.params;
//     const { startDate, endDate } = req.query;

//     if (!qstClientId) {
//       return res.status(400).json({ message: "Client ID is required." });
//     }

//     const dateFilter = {};
//     if (startDate && endDate) {
//       dateFilter.createdAt = {
//         $gte: new Date(startDate),
//         $lte: new Date(endDate)
//       };
//     }

//     // Fetch tickets with filters
//     const tickets = await Tickets.find({
//       qstClientName: qstClientId,
//       isTicketClosed: true,
//       ticketStatus: 'work done',
//       ...dateFilter
//     }).populate('taskType deviceType technician assignee');

//     // Fetch client's projects
//     const client = await QstClient.findById(qstClientId).populate('projects');

//     return res.status(200).json({
//       success: true,
//       tickets,
//       projects: client.projects || []
//     });

//   } catch (error) {
//     console.error("Error fetching tickets/projects:", error);
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };

// const getClientTicketforsuperadminforReport = async (req, res) => {
//    try {
//     const { billingCategory } = req.query;

//     // Optional: Validate billingCategory
//     // if (!billingCategory) {
//     //   return res.status(400).json({ message: "Billing category is required" });
//     // }

//     // Find clients matching the billing category
//     const clients = await QstClient.find({ billingCategory }).sort({ created: -1 });;

//     res.status(200).json(clients);
//   } catch (err) {
//     console.error("Error fetching clients by billing category:", err);
//     res.status(500).json({ message: "Server error" });
//   }
// };

// const getClientTicketforsuperadminforReport = async (req, res) => {
//   try {
//     const { billingCategory, page = 1, limit = 10, search } = req.query;

//     // Create base query
//     let query = {};

//     // Add billing category filter if provided
//     // if (billingCategory) {
//     //   query.billingCategory = billingCategory;
//     // }
//     query.billingCategory = billingCategory;

//     // Add search filter if provided
//     if (search) {
//       query.$or = [
//         { companyName: { $regex: search, $options: 'i' } },
//         { companyShortName: { $regex: search, $options: 'i' } }
//       ];
//     }

//     // Calculate pagination values
//     const currentPage = parseInt(page);
//     const itemsPerPage = parseInt(limit);
//     const skip = (currentPage - 1) * itemsPerPage;

//     // Get total count for pagination
//     const total = await QstClient.countDocuments(query);

//     // Find clients with pagination and sorting
//     const clients = await QstClient.find(query)
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(itemsPerPage);

//     res.status(200).json({
//       success: true,
//       data: clients,
//       pagination: {
//         total,
//         page: currentPage,
//         pages: Math.ceil(total / itemsPerPage),
//         limit: itemsPerPage
//       }
//     });
//   } catch (err) {
//     console.error("Error fetching clients:", err);
//     res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: err.message
//     });
//   }
// };

const getClientTicketforsuperadminforReport = async (req, res) => {
  try {
    const { billingCategory, page = 1, limit = 10, search } = req.query;

    // Build the base query
    const query = {};

    // Only add billingCategory to query if it's provided and not empty
    if (billingCategory && billingCategory.trim() !== "") {
      query.billingCategory = billingCategory;
    }

    // Add search filter if provided
    if (search && search.trim() !== "") {
      query.$or = [
        { companyName: { $regex: search, $options: "i" } },
        { companyShortName: { $regex: search, $options: "i" } },
        { gstNo: { $regex: search, $options: "i" } },
      ];
    }

    // Pagination calculations
    const currentPage = parseInt(page);
    const itemsPerPage = parseInt(limit);
    const skip = (currentPage - 1) * itemsPerPage;

    // Get total count
    const total = await QstClient.countDocuments(query);

    // Fetch paginated data
    const clients = await QstClient.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(itemsPerPage);

    res.status(200).json({
      success: true,
      data: clients,
      pagination: {
        total,
        page: currentPage,
        pages: Math.ceil(total / itemsPerPage),
        limit: itemsPerPage,
      },
    });
  } catch (err) {
    console.error("Error fetching clients:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

// const exportClientTicketforsuperadminforReportDaterange = async (req, res) => {
//   try {
//     const { fromDate, toDate } = req.query;
//     const {clientId} = req.params;

//     // Validate params
//     if (!fromDate || !toDate || !clientId) {
//       return res.status(400).json({
//         success: false,
//         message: "fromDate, toDate, and clientId are required",
//       });
//     }

//     // Convert to start/end of day
//     const from = dayjs(fromDate).startOf("day").toDate();
//     const to = dayjs(toDate).endOf("day").toDate();

//     // Fetch tickets
//     const tickets = await Ticket.find({
//       createdAt: { $gte: from, $lte: to },
//       qstClientName: clientId, // match client id
//     })
//       .sort({ createdAt: -1 })
//       .populate("qstClientName", "companyName companyShortName" ) // optional populate
//       .populate("taskType", "taskName") // populate task type name
//       .populate("deviceType", "deviceName")
//       // .populate("qstClientProjectName", " projectName "); // project info

//     res.status(200).json({
//       message : "export succesfully",
//       success: true,
//       count: tickets.length,
//       data: tickets,
//     });
//   } catch (error) {
//     console.error("Error exporting tickets:", error);
//     res.status(500).json({
//       success: false,
//       message: "Error exporting tickets",
//       error: error.message,
//     });
//   }
// };

const exportClientTicketforsuperadminforReportDaterange = async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const { clientId } = req.params;

    // Validate inputs
    if (!fromDate || !toDate || !clientId) {
      return res.status(400).json({
        success: false,
        message: "fromDate, toDate, and clientId are required",
      });
    }

    // Convert to proper Date range
    const from = dayjs(fromDate).startOf("day").toDate();
    const to = dayjs(toDate).endOf("day").toDate();

    const tickets = await Ticket.find({
      ticketAvailabilityDate: { $gte: from, $lte: to },
      qstClientName: clientId,
      isTicketClosed: true,
      ticketStatus: "work done",
    })
      .sort({ ticketAvailabilityDate: -1 })
      .populate(
        "qstClientName",
        "companyName companyShortName billingAddress gstNo"
      )
      .populate("taskType", "taskName")
      .populate("deviceType", "deviceName")
      .populate("assignee", "firstName lastName email phone")
      .populate("technician", "name phone email")
      .populate("qstProjectID", "projectName projectCode description") // ✅ projectName here
      .populate("creator", "firstName lastName email");

    res.status(200).json({
      message: "Export successful",
      success: true,
      count: tickets.length,
      data: tickets,
    });
  } catch (error) {
    console.error("Error exporting tickets:", error);
    res.status(500).json({
      success: false,
      message: "Error exporting tickets",
      error: error.message,
    });
  }
};

const getTicketStatusClosedOrOpenForTechFileUpload = async (req, res) => {
  try {
    const ticketId = req.params.ticketId;
    // ✅ Step 1: Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Ticket ID format" });
    }

    const ticket = await Ticket.findById(ticketId).select(
      "isTicketClosed ticketStatus _id"
    );

    if (!ticket) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found" });
    }
    res.json({
      success: true,
      data: ticket,
      message: "Ticket status get successfully",
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};


const getExportTicketsByBillingCategory = async (req, res) => {
  try {
    const { billingCategory, fromDate, toDate, annexturepaid, allannexturedata } = req.query;
    // console.log(req.query);

    // Validate required date range
    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: "fromDate and toDate are required",
      });
    }




    const from = dayjs(fromDate).startOf("day").toDate();
    const to = dayjs(toDate).endOf("day").toDate();

    // Step 1: Find all matching clients
    let clientFilter = {};
    if (billingCategory && billingCategory !== "All") {
      clientFilter.billingCategory = billingCategory;
    }
    // console.log("tt",clientFilter);

    const clients = await QstClient.find(clientFilter).select("_id");
    //  console.log("rr",clients);

    if (clients.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No clients found for this billing category",
      });
    }

    const clientIds = clients.map(client => client._id);
    let ticketFilter = {
      qstClientName: { $in: clientIds },
      isTicketClosed: true,
      ticketStatus: "work done",
      // annexturepaid: { $exists: false },
      ticketAvailabilityDate: { $gte: from, $lte: to },
    };

    //  if (!allannexturedata || allannexturedata !== "true") {
    //   ticketFilter.annexturepaid = { $exists: false };
    // }

    if (!allannexturedata || allannexturedata !== "true") {
      ticketFilter.annexturepaid = { $ne: true };  // Find where not true (includes false, null, undefined)
    }

    // Step 2: Find tickets for these clients within date range where ticket is closed and status is Work Done
    let tickets = await Ticket.find(
      ticketFilter
    )

      .populate(
        "qstClientName",
        "companyName companyShortName billingAddress gstNo"
      )
      .populate("taskType", "taskName")
      .populate("deviceType", "deviceName")
      .populate("assignee", "firstName lastName email phone")
      .populate("technician", "name phone email")
      .populate("qstProjectID", "projectName projectCode description") // ✅ projectName here
      .populate("creator", "firstName lastName email")

      .sort({ ticketAvailabilityDate: -1 });

    // ✅ If annexturepaid=paid in query, update all matching tickets
    // if (annexturepaid === "paid" && tickets.length > 0) {
    //   await Ticket.updateMany(ticketFilter, { $set: { annexturepaid: true } });
    //   // also update local tickets array so response matches DB
    //   tickets = tickets.map(t => ({ ...t.toObject(), annexturepaid: true }));
    // }


    // FIXED: Better update logic
    if (annexturepaid === "paid" && tickets.length > 0) {
      const ticketIds = tickets.map(t => t._id);
      await Ticket.updateMany(
        { _id: { $in: ticketIds } },
        { $set: { annexturepaid: true } }
      );

      // Update local array to reflect changes
      tickets.forEach(ticket => {
        ticket.annexturepaid = true;
      });
    }


    res.status(200).json({
      success: true,
      count: tickets.length,
      data: tickets,
    });

  } catch (error) {
    console.error("Error fetching tickets by billing category:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching tickets",
      error: error.message,
    });
  }
};


const getAllOwnCreatedTicketsForTelecallerDashboard = async (req, res) => {
  try {
    // Get user information from request

    let user;
    user = req.user ? req.user : { _id: req.params?.userId };
    // console.log("mukesh",user._id);

    if (!user || !user?._id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized - User information missing",
      });
    }

    // // Check if user has permission to access tickets
    // if (!["admin", "superAdmin", "cse"].includes(user.role)) {
    //   return res.status(403).json({
    //     success: false,
    //     message: "Forbidden - You don't have permission to access tickets",
    //   });
    // }

    // ------------------------------------------
    const {
      page = 1,
      search,
      status,
      fromDate,
      toDate,
      dateType = "updatedDate",
      dueDateFilter,
    } = req.query;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const validDateFields = {
      creationDate: "createdAt",
      updatedDate: "updatedAt",
    };
    const selectedDateField = validDateFields[dateType] || "updatedAt";

    // Calculate date ranges for stats
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

    const dayAfterStart = new Date(tomorrowStart);
    dayAfterStart.setDate(dayAfterStart.getDate() + 1);
    const dayAfterEnd = new Date(dayAfterStart);
    dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);

    // Build the base query
    let query = {};
    let statsBaseFilter = {};

    // ✅ Restrict tickets to only those created by the logged-in user (for all roles)
    query.creator = user._id;
    statsBaseFilter.creator = user._id;
    // console.log("jjj",query.creator);


    // Add status filter
    if (status && status !== "All Tickets") {
      if (status === "Closed") {
        query.$and = [{ ticketStatus: "work done" }, { isTicketClosed: true }];
      } else if (status === "Open") {
        query.$and = [{ isTicketClosed: { $ne: true } }];
      } else if (status === "work done") {
        query.$and = [
          { ticketStatus: "work done" },
          { isTicketClosed: { $ne: true } },
        ];
      }
    }

    // Date range filter
    if (fromDate && toDate) {
      const startDate = new Date(`${fromDate}T00:00:00.000Z`);
      const endDate = new Date(`${toDate}T23:59:59.999Z`);
      query[selectedDateField] = { $gte: startDate, $lt: endDate };
    }

    // Due date filtering
    if (dueDateFilter) {
      switch (dueDateFilter) {
        case "today":
          query.dueDate = { $gte: todayStart, $lt: todayEnd };
          break;
        case "tomorrow":
          query.dueDate = { $gte: tomorrowStart, $lt: tomorrowEnd };
          break;
        case "dayAfterTomorrow":
          query.dueDate = { $gte: dayAfterStart, $lt: dayAfterEnd };
          break;
        case "delayed":
          query.dueDate = { $lt: todayStart };
          break;
      }
    }

    // Search filter
    let objectIdMatch = null;
    if (search && mongoose.Types.ObjectId.isValid(search.trim())) {
      objectIdMatch = new mongoose.Types.ObjectId(search.trim());
    }

    if (search) {
      const escapeRegex = (str) =>
        str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const safeSearch = escapeRegex(search.trim());
      const searchRegex = new RegExp(safeSearch, "i");

      query.$or = [
        { qstClientTicketNumber: searchRegex },
        { ticketSKUId: searchRegex },
        { location: searchRegex },
        { subjectLine: searchRegex },
        { "vehicleNumbers.vehicleNumber": searchRegex },
        ...(objectIdMatch ? [{ _id: objectIdMatch }] : []),
        {
          assignee: {
            $in: await mongoose
              .model("Employee")
              .find({ name: searchRegex })
              .distinct("_id")
              .exec(),
          },
        },
      ];
    }

    // Stats queries
    const statsQueries = [
      Ticket.countDocuments({
        ...statsBaseFilter,
        $and: [{ isTicketClosed: { $ne: true } }],
      }),
      Ticket.countDocuments({
        ...statsBaseFilter,
        $and: [{ ticketStatus: "work done" }, { isTicketClosed: true }],
      }),
      Ticket.countDocuments({
        ...statsBaseFilter,
        $and: [
          { isTicketClosed: { $ne: true } },
          { dueDate: { $gte: todayStart, $lt: todayEnd } },
        ],
      }),
      Ticket.countDocuments({
        ...statsBaseFilter,
        $and: [
          { isTicketClosed: { $ne: true } },
          { dueDate: { $gte: tomorrowStart, $lt: tomorrowEnd } },
        ],
      }),
      Ticket.countDocuments({
        ...statsBaseFilter,
        $and: [
          { isTicketClosed: { $ne: true } },
          { dueDate: { $gte: dayAfterStart, $lt: dayAfterEnd } },
        ],
      }),
      Ticket.countDocuments({
        ...statsBaseFilter,
        $and: [
          { isTicketClosed: { $ne: true } },
          { dueDate: { $lt: todayStart } },
        ],
      }),
    ];

    const [
      openCount,
      closedCount,
      todayCount,
      tomorrowCount,
      dayAfterCount,
      delayedCount,
    ] = await Promise.all(statsQueries);

    // Get total count for pagination
    const allTotalTicketCounts = await Ticket.countDocuments(query);

    // Get paginated tickets
    const tickets = await Ticket.find(query)
      .select("+isTechnicianPaymentSuccessDate")
      .populate("qstClientName", "companyShortName")
      .populate("assignee", "name _id")
      .populate("taskType", "taskName")
      .populate("deviceType", "deviceName")
      .populate("technician", "name")
      .populate("creator", "name")
      .populate("qstProjectID", "projectName _id")
      .sort({ [selectedDateField]: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      success: true,
      stats: {
        open: openCount,
        closed: closedCount,
        dueDateCounts: {
          today: todayCount,
          tomorrow: tomorrowCount,
          dayAfterTomorrow: dayAfterCount,
          delayed: delayedCount,
        },
      },
      data: tickets,
      total: allTotalTicketCounts,
      page: parseInt(page),
      pages: Math.ceil(allTotalTicketCounts / limit),
    });
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// this is used to show due date change logs in view tickets
const getDueDateChangeLogs = async (req, res) => {
  try {
    const ticketId = req.params?.ticketId;
    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID"
      });
    }

    const logs = await DueDateChangeLog.find({ ticketId })
      .populate("changedBy", "name")
      .sort({ changedAt: -1 });

    res.status(200).json({
      success: true,
      data: logs,
      message: "Due date change logs fetched successfully"
    });
  } catch (error) {
    console.error("Error fetching due date change logs:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};


const exportTechnicianPaymentTicketsReport = async (req, res) => {
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

    const tickets = await Ticket.find({
      isTechnicianPaymentSuccess: true,
      isTicketClosed: true,
      ticketStatus: "work done",
      isTechnicianPaymentSuccessDate: { $gte: from, $lte: to },
    }).populate("technician", "name nickName")
      .populate("assignee", "name")
      .sort({ isTechnicianPaymentSuccessDate: -1 });

    res.status(200).json({
      success: true,
      data: tickets,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error exporting technician payment tickets",
      error: error.message,
    });
  }
};












// Get all deleted ticket logs with pagination and filtering
// const getDeletedTicketLogs = async (req, res) => {
//   try {
//     const {
//       page = 1,
//       limit = 10,
//       sortBy = "deletedAt",
//       sortOrder = "desc",
//       search = "",
//       deletedBy,
//       startDate,
//       endDate
//     } = req.query;

//     // Build filter object
//     const filter = {};

//     // Search by ticket ID or ticket data fields
//     if (search) {
//       filter.$or = [
//         { ticketId: new mongoose.Types.ObjectId(search) },
//         { "ticketData.subjectLine": { $regex: search, $options: "i" } },
//         { "ticketData.qstClientName.companyShortName": { $regex: search, $options: "i" } },
//         { deletedByName: { $regex: search, $options: "i" } }
//       ];
//     }

//     // Filter by user who deleted
//     if (deletedBy && mongoose.Types.ObjectId.isValid(deletedBy)) {
//       filter.deletedBy = new mongoose.Types.ObjectId(deletedBy);
//     }

//     // Date range filter
//     if (startDate || endDate) {
//       filter.deletedAt = {};
//       if (startDate) {
//         filter.deletedAt.$gte = new Date(startDate);
//       }
//       if (endDate) {
//         filter.deletedAt.$lte = new Date(endDate);
//       }
//     }

//     // Execute query with pagination
//     const logs = await DeletedTicketLog.find(filter)
//       .populate("deletedBy", "name email") // Populate deletedBy user details
//       .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
//       .limit(limit * 1)
//       .skip((page - 1) * limit);

//     // Get total count for pagination
//     const total = await DeletedTicketLog.countDocuments(filter);

//     res.status(200).json({
//       success: true,
//       data: logs,
//       pagination: {
//         currentPage: parseInt(page),
//         totalPages: Math.ceil(total / limit),
//         totalItems: total,
//         itemsPerPage: parseInt(limit)
//       }
//     });
//   } catch (error) {
//     console.error("Error fetching deleted ticket logs:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: error.message
//     });
//   }
// };



// const getDeletedTicketLogs = async (req, res) => {
//   try {
//     const {
//       page = 1,
//       limit = 10,
//       sortBy = "deletedAt",
//       sortOrder = "desc",
//       search = "",
//       deletedBy,
//       startDate,
//       endDate
//     } = req.query;

//     // Build filter object
//     const filter = {};

//     // Search by various fields

//     if (search) {
//       const searchConditions = [
//         { "ticketData.subjectLine": { $regex: search, $options: "i" } },
//         { deletedByName: { $regex: search, $options: "i" } },
//         { "ticketData.ticketNumber": { $regex: search, $options: "i" } },
//         { "ticketData.title": { $regex: search, $options: "i" } },
//         { "ticketData.qstClientNameString": { $regex: search, $options: "i" } } // Use the string field instead
//       ];

//       // Only add ObjectId search if it's a valid ObjectId
//       if (mongoose.Types.ObjectId.isValid(search)) {
//         searchConditions.push({ 
//           $or: [
//             { ticketId: new mongoose.Types.ObjectId(search) },
//             { "ticketData._id": new mongoose.Types.ObjectId(search) }
//           ]
//         });
//       }

//       filter.$or = searchConditions;
//     }

//     // Filter by user who deleted
//     if (deletedBy && mongoose.Types.ObjectId.isValid(deletedBy)) {
//       filter.deletedBy = new mongoose.Types.ObjectId(deletedBy);
//     }

//     // Date range filter
//     if (startDate || endDate) {
//       filter.deletedAt = {};
//       if (startDate) {
//         const start = new Date(startDate);
//         if (!isNaN(start.getTime())) {
//           filter.deletedAt.$gte = start;
//         }
//       }
//       if (endDate) {
//         const end = new Date(endDate);
//         if (!isNaN(end.getTime())) {
//           filter.deletedAt.$lte = end;
//         }
//       }

//       // Remove empty date filter object
//       if (Object.keys(filter.deletedAt).length === 0) {
//         delete filter.deletedAt;
//       }
//     }

//     // Execute query with pagination
//     const logs = await DeletedTicketLog.find(filter)
//       .populate("deletedBy", "name email")
//       .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
//       .limit(parseInt(limit))
//       .skip((parseInt(page) - 1) * parseInt(limit));

//     // Get total count for pagination
//     const total = await DeletedTicketLog.countDocuments(filter);

//     res.status(200).json({
//       success: true,
//       data: logs,
//       pagination: {
//         currentPage: parseInt(page),
//         totalPages: Math.ceil(total / parseInt(limit)),
//         totalItems: total,
//         itemsPerPage: parseInt(limit)
//       }
//     });
//   } catch (error) {
//     console.error("Error fetching deleted ticket logs:", error);
//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: error.message
//     });
//   }
// };


const getDeletedTicketLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = "deletedAt",
      sortOrder = "desc",
      search = "",
      deletedBy,
      startDate,
      endDate
    } = req.query;

    // Build filter object
    const filter = {};

    // Trim and clean search query
    const cleanedSearch = search ? search.trim() : "";

    // Search by various fields (only if search is not empty after trimming)
    if (cleanedSearch) {
      const searchConditions = [
        { "ticketData.subjectLine": { $regex: cleanedSearch, $options: "i" } },
        { deletedByName: { $regex: cleanedSearch, $options: "i" } },
        { "ticketData.ticketNumber": { $regex: cleanedSearch, $options: "i" } },
        { "ticketData.title": { $regex: cleanedSearch, $options: "i" } },
        { "ticketData.qstClientNameString": { $regex: cleanedSearch, $options: "i" } }
      ];

      // Only add ObjectId search if it's a valid ObjectId
      if (mongoose.Types.ObjectId.isValid(cleanedSearch)) {
        searchConditions.push({
          $or: [
            { ticketId: new mongoose.Types.ObjectId(cleanedSearch) },
            { "ticketData._id": new mongoose.Types.ObjectId(cleanedSearch) }
          ]
        });
      }

      filter.$or = searchConditions;
    }

    // Filter by user who deleted
    if (deletedBy) {
      const cleanedDeletedBy = deletedBy.trim();
      if (mongoose.Types.ObjectId.isValid(cleanedDeletedBy)) {
        filter.deletedBy = new mongoose.Types.ObjectId(cleanedDeletedBy);
      }
    }

    // Date range filter with trimming
    if (startDate || endDate) {
      filter.deletedAt = {};

      if (startDate) {
        const cleanedStartDate = startDate.trim();
        const start = new Date(cleanedStartDate);
        if (!isNaN(start.getTime())) {
          filter.deletedAt.$gte = start;
        }
      }

      if (endDate) {
        const cleanedEndDate = endDate.trim();
        const end = new Date(cleanedEndDate);
        if (!isNaN(end.getTime())) {
          filter.deletedAt.$lte = end;
        }
      }

      // Remove empty date filter object
      if (Object.keys(filter.deletedAt).length === 0) {
        delete filter.deletedAt;
      }
    }

    // Execute query with pagination
    const logs = await DeletedTicketLog.find(filter)
      .populate("deletedBy", "name email")
      .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    // Get total count for pagination
    const total = await DeletedTicketLog.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error("Error fetching deleted ticket logs:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};


// Get specific deleted ticket log by ID
const getDeletedTicketLogById = async (req, res) => {
  try {
    const { logId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(logId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid log ID format"
      });
    }

    const log = await DeletedTicketLog.findById(logId)
      .populate("deletedBy", "name email");

    if (!log) {
      return res.status(404).json({
        success: false,
        message: "Deleted ticket log not found"
      });
    }

    res.status(200).json({
      success: true,
      data: log
    });
  } catch (error) {
    console.error("Error fetching deleted ticket log:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};

// Get deleted logs for a specific ticket
const getDeletedLogsByTicketId = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket ID format"
      });
    }

    const logs = await DeletedTicketLog.find({ ticketId })
      .populate("deletedBy", "name email")
      .sort({ deletedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await DeletedTicketLog.countDocuments({ ticketId });

    res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error("Error fetching deleted logs for ticket:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message
    });
  }
};





const ExportNEFTbyIndividualTicketId = async (req, res) => {
  try {
    const { ticketIds } = req.body;

    if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ticketIds must be a non-empty array",
      });
    }

    // Validate all IDs
    const invalidIds = ticketIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid ticket IDs found",
        invalidIds,
      });
    }

    // Fetch tickets that satisfy the condition
    const validTickets = await Ticket.find({
      _id: { $in: ticketIds },
      ticketStatus: "work done",
      isTicketClosed: true,
    }).populate("technician", "name nickName technicianCategoryType beneficiaryId")
      .populate("assignee", "name");

    // Extract matched IDs
    const matchedIds = validTickets.map((t) => t._id.toString());

    // Find not matched IDs
    const notMatchedIds = ticketIds.filter((id) => !matchedIds.includes(id));

    res.status(200).json({
      success: true,
      totalRequested: ticketIds.length,
      totalMatched: matchedIds.length,
      totalNotMatched: notMatchedIds.length,
      tickets: validTickets,
      notMatchedIds,
      message:
        notMatchedIds.length > 0
          ? "Some tickets did not meet the condition (not 'work done' or not closed)"
          : "All tickets meet the condition",
    });
  } catch (error) {
    console.error("Error fetching tickets:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// -------------=====================-------------------------------------------------------
// create new ticket for qst client create ticket with auto assign assignee....

// const createTicketWithAutoAssignment = async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const {
//       qstClient=undefined,
//       location,
//       taskType=undefined,
//       deviceType=undefined , 
//       vehicleNumbers,
//       oldVehicleNumbers,
//       newVehicleNumbers,
//       noOfVehicles,
//       description,
//       remark,
//       projectName,
//       qstClientTicketNo,
//       imeiNumber,
//       simNumber,
//       issueFound,
//       resolution,
//       techCharges,
//       materialCharges,
//       courierCharges,
//       techConveyance,
//       customerConveyance,
//       ticketStatus = "technician not yet assigned",
//       techAccountNumber,
//       techIfscCode,
//       accountHolder,
//       state, // This should be the state ID
//       subjectLine,
//       assignee=undefined, // Will be auto-assigned
//       technician=undefined, // Will be assigned later
//       totalTechCharges,
//       customerCharges,
//       totalCustomerCharges,
//       ticketClosureReason,
//       dueDate,
//       qstProjectID,
//       ticketAvailabilityDate,
//       employeeId, // Creator of the ticket
//     } = req.body;

//     // Validate required fields
//     const requiredFields = {
//       qstClient,
//       location,
//       taskType,
//       state,
//       ticketStatus,
//       dueDate,
//       employeeId,
//     };

//     const missingFields = Object.entries(requiredFields)
//       .filter(([key, value]) => !value)
//       .map(([key]) => key);

//     if (missingFields.length > 0) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(400).json({
//         success: false,
//         message: `Missing required field(s): ${missingFields.join(", ")}`,
//       });
//     }

//     // Validate due date is not in the past
//     const isPastDate = (date) => {
//       const today = new Date();
//       today.setHours(0, 0, 0, 0);
//       const due = new Date(date);
//       due.setHours(0, 0, 0, 0);
//       return due < today;
//     };

//     if (isPastDate(dueDate)) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(400).json({
//         success: false,
//         message: "Due date must be today or in the future",
//       });
//     }

//     // Find the best employee for this state based on current workload
//     const assignedEmployee = await findBestEmployeeForState(state, dueDate);

//     if (!assignedEmployee) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(400).json({
//         success: false,
//         message: "No available employees for the selected state",
//       });
//     }

//     // Handle attachments
//     let attachments = [];
//     if (typeof req.body.attachments === "string") {
//       try {
//         attachments = JSON.parse(req.body.attachments);
//       } catch (e) {
//         console.error("Failed to parse attachments:", e.message);
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(400).json({
//           success: false,
//           message: "Invalid attachments format",
//         });
//       }
//     } else if (Array.isArray(req.body.attachments)) {
//       attachments = req.body.attachments;
//     }

//     // Handle vehicle numbers
//     let vehicleNumbersArray = [];
//     let oldVehicleNumbersArray = [];
//     let newVehicleNumbersArray = [];
//     let isReinstallation = false;

//     // Check if task is reinstallation
//     const taskTypeDoc = await Task.findById(taskType);
//     if (taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("reinstallation")) {
//       isReinstallation = true;
//       oldVehicleNumbersArray = Array.isArray(oldVehicleNumbers)
//         ? oldVehicleNumbers
//         : oldVehicleNumbers
//         ? oldVehicleNumbers.split(",").map((v) => v.trim())
//         : [];

//       newVehicleNumbersArray = Array.isArray(newVehicleNumbers)
//         ? newVehicleNumbers
//         : newVehicleNumbers
//         ? newVehicleNumbers.split(",").map((v) => v.trim())
//         : [];

//       if (oldVehicleNumbersArray.length !== newVehicleNumbersArray.length) {
//         await session.abortTransaction();
//         session.endSession();
//         return res.status(400).json({
//           success: false,
//           message: "Old and New Vehicle Numbers must have the same count",
//         });
//       }
//     } else {
//       vehicleNumbersArray = Array.isArray(vehicleNumbers)
//         ? vehicleNumbers
//         : vehicleNumbers
//         ? vehicleNumbers.split(",").map((v) => v.trim())
//         : [];
//     }

//     // Handle issue and resolution references for service tasks
//     let issueFoundRef = undefined;
//     let resolutionRef = undefined;
//     const isServiceTask = taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("service");

//     if (isServiceTask) {
//       issueFoundRef = issueFound && issueFound !== "" ? issueFound : null;
//       resolutionRef = resolution && resolution !== "" ? resolution : null;
//     }

//     // // Generate ticket SKU ID
//     // const generateTicketSKUId = await getTicketSKUIdGenerator();
//     // const ticketSKUId = await generateTicketSKUId();

//     // Create the ticket with auto-assigned employee
//     const newTicket = new Ticket({
//       ticketSKUId,
//       qstClientName: qstClient,
//       taskType,
//       deviceType: deviceType || null,
//       location,
//       dueDate: new Date(dueDate),
//       ticketAvailabilityDate: ticketAvailabilityDate ? new Date(ticketAvailabilityDate) : null,
//       oldVehicleNumber: isReinstallation ? oldVehicleNumbersArray : [],
//       vehicleNumbers: isReinstallation
//         ? newVehicleNumbersArray.map((newNumber) => ({
//             vehicleNumber: newNumber,
//             isResinstalationTypeNewVehicalNumber: true,
//           }))
//         : vehicleNumbersArray.map((number) => ({
//             vehicleNumber: number,
//             isResinstalationTypeNewVehicalNumber: false,
//           })),
//       noOfVehicles: isReinstallation
//         ? oldVehicleNumbersArray.length
//         : vehicleNumbersArray.length,
//       description,
//       remark,
//       assignee: assignedEmployee._id, // Auto-assigned employee
//       qstProjectID: qstProjectID || null,
//       qstClientTicketNumber: qstClientTicketNo || "",
//       qstClientProjectName: projectName || "",
//       imeiNumbers: imeiNumber ? [imeiNumber] : [],
//       simNumbers: simNumber ? [simNumber] : [],
//       issueFound: issueFound || "",
//       resolution: resolution || "",
//       issueFoundRef,
//       resolutionRef,
//       technicianCharges: parseFloat(techCharges) || 0,
//       materialCharges: parseFloat(materialCharges) || 0,
//       courierCharges: parseFloat(courierCharges) || 0,
//       techConveyance: parseFloat(techConveyance) || 0,
//       customerConveyance: parseFloat(customerConveyance) || 0,
//       ticketStatus,
//       techAccountNumber: techAccountNumber || "",
//       techIFSCCode: techIfscCode || "",
//       accountHolderName: accountHolder || "",
//       state,
//       subjectLine: subjectLine || "",
//       totalTechCharges: parseFloat(totalTechCharges) || 0,
//       customerCharges: parseFloat(customerCharges) || 0,
//       totalCustomerCharges: parseFloat(totalCustomerCharges) || 0,
//       reasonForTicketClosure: ticketClosureReason || "",
//       creator: employeeId,
//       attachedFiles: attachments.map(
//         (file) =>
//           `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${file.key}`
//       ),
//       // Store string values for reference
//       qstClientNameString: "", // Will be populated after save
//       assigneeNameString: assignedEmployee.name,
//       taskTypeString: "", // Will be populated after save
//       devicetypeNameString: "", // Will be populated after save
//       autoAssigned: true, // Flag to indicate auto-assignment
//     });

//     const savedTicket = await newTicket.save({ session });

//     // Populate string fields for reference
//     const [client, task, device] = await Promise.all([
//       QstClient.findById(qstClient).select("companyShortName"),
//       Task.findById(taskType).select("taskName"),
//       deviceType ? Device.findById(deviceType).select("deviceName") : Promise.resolve(null),
//     ]);

//     savedTicket.qstClientNameString = client?.companyShortName || "";
//     savedTicket.taskTypeString = task?.taskName || "";
//     savedTicket.devicetypeNameString = device?.deviceName || "";

//     await savedTicket.save({ session });

//     await session.commitTransaction();
//     session.endSession();

//     // Populate the response with details
//     const populatedTicket = await Ticket.findById(savedTicket._id)
//       .populate("qstClientName", "companyShortName")
//       .populate("assignee", "name email employeeId")
//       .populate("taskType", "taskName")
//       .populate("deviceType", "deviceName")
//       .populate("state", "name")
//       .populate("creator", "name");

//     res.status(201).json({
//       success: true,
//       message: "Ticket created successfully with auto-assignment",
//       data: populatedTicket,
//     });

//   } catch (error) {
//     await session.abortTransaction();
//     session.endSession();

//     console.error("Error creating ticket with auto-assignment:", error);

//     if (error.code === 11000) {
//       return res.status(500).json({
//         success: false,
//         message: "Failed to generate unique ticket ID. Please try again.",
//       });
//     }

//     res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       error: process.env.NODE_ENV === "development" ? error.message : undefined,
//     });
//   }
// };


const createTicketByQSTClientWithAutoAssignment = async (req, res) => {
  console.log("Request body:", req.body); // Debugging line
  // return res.status(200).json({ success: true,message: "Temporary response to stop execution" }); // Temporary response to stop execution
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      qstClient = undefined,
      location,
      taskType = undefined,
      deviceType = undefined,
      vehicleNumbers,
      oldVehicleNumbers,
      newVehicleNumbers,
      noOfVehicles,
      description,
      remark,
      projectName,
      qstClientTicketNo,
      imeiNumber,
      simNumber,
      issueFound,
      resolution,
      techCharges,
      materialCharges,
      courierCharges,
      techConveyance,
      customerConveyance,
      ticketStatus = "technician not yet assigned",
      techAccountNumber,
      techIfscCode,
      accountHolder,
      state, // This should be the state ID
      subjectLine,
      assignee = undefined, // Will be auto-assigned
      technician = undefined, // Will be assigned later
      totalTechCharges,
      customerCharges,
      totalCustomerCharges,
      ticketClosureReason,
      dueDate,
      qstProjectID,
      ticketAvailabilityDate,
      employeeId, // Creator of the ticket
    } = req.body;

    // Validate required fields
    const requiredFields = {
      qstClient,
      location,
      taskType,
      state,
      ticketStatus,
      dueDate,
      employeeId,
    };

    const missingFields = Object.entries(requiredFields)
      .filter(([key, value]) => !value)
      .map(([key]) => key);

    if (missingFields.length > 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Missing required field(s): ${missingFields.join(", ")}`,
      });
    }

    // Validate due date is not in the past
    const isPastDate = (date) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const due = new Date(date);
      due.setHours(0, 0, 0, 0);
      return due < today;
    };

    if (isPastDate(dueDate)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Due date must be today or in the future",
      });
    }

    // ADD THIS: Get state name from database
    const stateData = await State.findById(state).select("name");
    if (!stateData) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "Invalid state ID",
      });
    }
    const stateName = stateData.name;

    // Find the best employee for this state based on current workload
    const assignedEmployee = await findBestEmployeeForState(state, dueDate);

    if (!assignedEmployee) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: "No available employees for the selected state",
      });
    }

    // Handle attachments
    let attachments = [];
    if (typeof req.body.attachments === "string") {
      try {
        attachments = JSON.parse(req.body.attachments);
      } catch (e) {
        console.error("Failed to parse attachments:", e.message);
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Invalid attachments format",
        });
      }
    } else if (Array.isArray(req.body.attachments)) {
      attachments = req.body.attachments;
    }

    // Handle vehicle numbers
    let vehicleNumbersArray = [];
    let oldVehicleNumbersArray = [];
    let newVehicleNumbersArray = [];
    let isReinstallation = false;

    // Check if task is reinstallation
    const taskTypeDoc = await Task.findById(taskType);
    if (taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("reinstallation")) {
      isReinstallation = true;
      oldVehicleNumbersArray = Array.isArray(oldVehicleNumbers)
        ? oldVehicleNumbers
        : oldVehicleNumbers
          ? oldVehicleNumbers.split(",").map((v) => v.trim())
          : [];

      newVehicleNumbersArray = Array.isArray(newVehicleNumbers)
        ? newVehicleNumbers
        : newVehicleNumbers
          ? newVehicleNumbers.split(",").map((v) => v.trim())
          : [];

      if (oldVehicleNumbersArray.length !== newVehicleNumbersArray.length) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Old and New Vehicle Numbers must have the same count",
        });
      }
    } else {
      vehicleNumbersArray = Array.isArray(vehicleNumbers)
        ? vehicleNumbers
        : vehicleNumbers
          ? vehicleNumbers.split(",").map((v) => v.trim())
          : [];
    }

    // Handle issue and resolution references for service tasks
    let issueFoundRef = undefined;
    let resolutionRef = undefined;
    const isServiceTask = taskTypeDoc && taskTypeDoc.taskName.toLowerCase().includes("service");

    if (isServiceTask) {
      issueFoundRef = issueFound && issueFound !== "" ? issueFound : null;
      resolutionRef = resolution && resolution !== "" ? resolution : null;
    }

    // ------------- Ticket skuId addition and retry method ------------------
    const generateTicketSKUId = await getTicketSKUIdGenerator();
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 100;
    let ticketSKUId;
    let attempts = 0;
    let skuGenerationError = null;

    while (attempts < MAX_RETRIES) {
      try {
        ticketSKUId = await generateTicketSKUId();
        break; // Exit loop if successful
      } catch (error) {
        if (error.code === 11000) {
          // Duplicate SKU error, try again
          attempts++;
          if (attempts >= MAX_RETRIES) {
            skuGenerationError = new Error(
              "Failed to generate unique ticket ID after multiple attempts. Please try again."
            );
            skuGenerationError.isSKUGenerationError = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
        // For other errors, break the loop and throw
        throw error;
      }
    }

    if (skuGenerationError) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({
        success: false,
        message: skuGenerationError.message,
      });
    }
    // -----------------------------------------------------

    // Create the ticket with auto-assigned employee
    const newTicket = new Ticket({
      ticketSKUId,
      qstClientName: qstClient,
      taskType,
      deviceType: deviceType || null,
      location,
      dueDate: new Date(dueDate),
      ticketAvailabilityDate: ticketAvailabilityDate ? new Date(ticketAvailabilityDate) : null,
      oldVehicleNumber: isReinstallation ? oldVehicleNumbersArray : [],
      vehicleNumbers: isReinstallation
        ? newVehicleNumbersArray.map((newNumber) => ({
          vehicleNumber: newNumber,
          isResinstalationTypeNewVehicalNumber: true,
        }))
        : vehicleNumbersArray.map((number) => ({
          vehicleNumber: number,
          isResinstalationTypeNewVehicalNumber: false,
        })),
      noOfVehicles: isReinstallation
        ? oldVehicleNumbersArray.length
        : vehicleNumbersArray.length,
      description,
      remark,
      assignee: assignedEmployee._id, // Auto-assigned employee
      qstProjectID: qstProjectID || null,
      qstClientTicketNumber: qstClientTicketNo || "",
      qstClientProjectName: projectName || "",
      imeiNumbers: imeiNumber ? [imeiNumber] : [],
      simNumbers: simNumber ? [simNumber] : [],
      issueFound: issueFound || "",
      resolution: resolution || "",
      issueFoundRef,
      resolutionRef,
      technicianCharges: parseFloat(techCharges) || 0,
      materialCharges: parseFloat(materialCharges) || 0,
      courierCharges: parseFloat(courierCharges) || 0,
      techConveyance: parseFloat(techConveyance) || 0,
      customerConveyance: parseFloat(customerConveyance) || 0,
      ticketStatus,
      techAccountNumber: techAccountNumber || "",
      techIFSCCode: techIfscCode || "",
      accountHolderName: accountHolder || "",
      state: stateName,
      subjectLine: subjectLine || "",
      totalTechCharges: parseFloat(totalTechCharges) || 0,
      customerCharges: parseFloat(customerCharges) || 0,
      totalCustomerCharges: parseFloat(totalCustomerCharges) || 0,
      reasonForTicketClosure: ticketClosureReason || "",
      creator: employeeId,
      attachedFiles: attachments.map(
        (file) =>
          `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com/${file.key}`
      ),
      // Store string values for reference
      qstClientNameString: "", // Will be populated after save
      assigneeNameString: assignedEmployee.name,
      taskTypeString: "", // Will be populated after save
      devicetypeNameString: "", // Will be populated after save
      autoAssigned: true, // Flag to indicate auto-assignment
    });

    const savedTicket = await newTicket.save({ session });

    // Populate string fields for reference
    const [client, task, device] = await Promise.all([
      QstClient.findById(qstClient).select("companyShortName"),
      Task.findById(taskType).select("taskName"),
      deviceType ? Device.findById(deviceType).select("deviceName") : Promise.resolve(null),
    ]);

    savedTicket.qstClientNameString = client?.companyShortName || "";
    savedTicket.taskTypeString = task?.taskName || "";
    savedTicket.devicetypeNameString = device?.deviceName || "";

    await savedTicket.save({ session });

    await session.commitTransaction();
    session.endSession();

    // Populate the response with details
    const populatedTicket = await Ticket.findById(savedTicket._id)
      .populate("qstClientName", "companyShortName")
      .populate("assignee", "name email employeeId")
      .populate("taskType", "taskName")
      .populate("deviceType", "deviceName")
      .populate("state", "name")
      .populate("creator", "name");

    res.status(201).json({
      success: true,
      message: "Ticket created successfully with auto-assignment",
      data: populatedTicket,
    });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("Error creating ticket with auto-assignment:", error);

    if (error.code === 11000) {
      return res.status(500).json({
        success: false,
        message: "Failed to generate unique ticket ID. Please try again.",
      });
    }

    // Handle SKU generation errors specifically
    if (error.isSKUGenerationError) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
// helper function to find best employee for a state based on current workload
const findBestEmployeeForState = async (stateId, dueDate) => {
  try {
    // Convert dueDate to start and end of day for counting tickets
    const startOfDay = new Date(dueDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(dueDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Find employees who serve this state (only QuikServe employees)
    const employees = await Employee.find({
      serviceStates: stateId,
      role: { $in: ['cse', 'admin', 'superAdmin'] }
    });

    if (employees.length === 0) {
      return null; // No employees serve this state
    }
    // console.log('Employees serving state:', employees); // Debugging line
    // Count open tickets for each employee for the given due date
    const employeesWithTicketCount = await Promise.all(
      employees.map(async (employee) => {
        const openTicketCount = await Ticket.countDocuments({
          assignee: employee._id,
          dueDate: {
            $gte: startOfDay,
            $lte: endOfDay
          },
          isTicketClosed: false // Only count open tickets
        });

        return {
          employee,
          openTicketCount
        };
      })
    );

    // Sort by open ticket count (ascending) to find employee with least load
    employeesWithTicketCount.sort((a, b) => a.openTicketCount - b.openTicketCount);
    // console.log('Employees with ticket counts:', employeesWithTicketCount); // Debugging line
    // console.log('Selected employee:', employeesWithTicketCount[0]?.employee); // Debugging line
    return employeesWithTicketCount[0]?.employee || null;
  } catch (error) {
    console.error('Error finding best employee:', error);
    return null;
  }
};
// ------------------------------------------------------------------------------------








/**
//  * Get technician margins grouped by financial month and overall financial year totals.
//  * Financial year starts in April.
//  *
//  * @param {Date} [from] optional start date filter (inclusive)
//  * @param {Date} [to] optional end date filter (inclusive)
//  * @returns {Promise<{ monthly: Array, financialYearTotals: Object }>}
//  */
// async function getTechnicianMargins({ from = null, to = null } = {}) {
//   const matchStage = {};
//   if (from || to) {
//     matchStage.createdAt = {};
//     if (from) matchStage.createdAt.$gte = from;
//     if (to) matchStage.createdAt.$lte = to;
//   }

//   // build pipeline
//   const pipeline = [];

//   // optional date filter
//   if (Object.keys(matchStage).length) pipeline.push({ $match: matchStage });

//   // Lookup technician doc to get category and salary (technician may be null)
//   pipeline.push({
//     $lookup: {
//       from: 'technicians',            // must match your technicians collection name
//       localField: 'technician',
//       foreignField: '_id',
//       as: 'technicianDoc'
//     }
//   });
//   pipeline.push({
//     $unwind: {
//       path: '$technicianDoc',
//       preserveNullAndEmptyArrays: true
//     }
//   });

//   // Project necessary fields and compute month/year and financial year label
//   pipeline.push({
//     $addFields: {
//       ticketDate: '$createdAt',
//       month: { $month: '$createdAt' },   // 1..12
//       year: { $year: '$createdAt' },
//       technicianCategory: '$technicianDoc.technicianCategoryType',
//       technicianSalary: '$technicianDoc.salary',
//       technicianId: '$technicianDoc._id'
//     }
//   });

//   // Compute financial year starting April:
//   // FY start year = if month >= 4 then year else year-1
//   pipeline.push({
//     $addFields: {
//       fyStartYear: {
//         $cond: [{ $gte: ['$month', 4] }, '$year', { $subtract: ['$year', 1] }]
//       }
//     }
//   });

//   pipeline.push({
//     $addFields: {
//       // month key like "2024-04"
//       financialMonthKey: {
//         $concat: [
//           { $toString: '$year' },
//           '-',
//           // zero-pad month
//           {
//             $cond: [
//               { $lt: ['$month', 10] },
//               { $concat: ['0', { $toString: '$month' }] },
//               { $toString: '$month' }
//             ]
//           }
//         ]
//       },
//       // FY label like "2024-2025"
//       financialYearLabel: {
//         $concat: [
//           { $toString: '$fyStartYear' },
//           '-',
//           { $toString: { $add: ['$fyStartYear', 1] } }
//         ]
//       }
//     }
//   });

//   // Group by financialMonthKey + financialYearLabel
//   pipeline.push({
//     $group: {
//       _id: {
//         financialMonthKey: '$financialMonthKey',
//         financialYearLabel: '$financialYearLabel',
//         year: '$year',
//         month: '$month'
//       },

//       // payroll tickets counts & sums
//       payrollTicketCount: {
//         $sum: {
//           $cond: [{ $eq: ['$technicianCategory', 'payroll'] }, 1, 0]
//         }
//       },
//       payrollTotalCustomerCharges: {
//         $sum: {
//           $cond: [{ $eq: ['$technicianCategory', 'payroll'] }, '$totalCustomerCharges', 0]
//         }
//       },

//       // add unique payroll technician objects to a set (deduplicated by object equality)
//       payrollTechniciansSet: {
//         $addToSet: {
//           $cond: [
//             { $eq: ['$technicianCategory', 'payroll'] },
//             { id: '$technicianId', salary: '$technicianSalary' },
//             null
//           ]
//         }
//       },

//       // freelance sums
//       freelanceTotalCustomerCharges: {
//         $sum: {
//           $cond: [{ $eq: ['$technicianCategory', 'freelance'] }, '$totalCustomerCharges', 0]
//         }
//       },
//       freelanceTotalTechCharges: {
//         $sum: {
//           $cond: [{ $eq: ['$technicianCategory', 'freelance'] }, '$totalTechCharges', 0]
//         }
//       },

//       // total tickets in month (all categories)
//       totalTicketsInMonth: { $sum: 1 },
//       totalCustomerChargesAll: { $sum: '$totalCustomerCharges' }
//     }
//   });

//   // Clean payrollTechniciansSet (filter out null) and sum salaries in the set
//   pipeline.push({
//     $project: {
//       financialMonthKey: '$_id.financialMonthKey',
//       financialYearLabel: '$_id.financialYearLabel',
//       year: '$_id.year',
//       month: '$_id.month',

//       payrollTicketCount: 1,
//       payrollTotalCustomerCharges: 1,

//       payrollTechniciansArray: {
//         $filter: { input: '$payrollTechniciansSet', as: 't', cond: { $ne: ['$$t', null] } }
//       },

//       freelanceTotalCustomerCharges: 1,
//       freelanceTotalTechCharges: 1,

//       totalTicketsInMonth: 1,
//       totalCustomerChargesAll: 1
//     }
//   });

//   // Sum payroll salaries from the unique array
//   pipeline.push({
//     $addFields: {
//       payrollTotalSalaries: {
//         $reduce: {
//           input: '$payrollTechniciansArray',
//           initialValue: 0,
//           in: { $add: ['$$value', { $ifNull: ['$$this.salary', 0] }] }
//         }
//       }
//     }
//   });

//   // Calculate margins
//   pipeline.push({
//     $addFields: {
//       payrollMargin: { $subtract: ['$payrollTotalCustomerCharges', '$payrollTotalSalaries'] },
//       freelanceMargin: { $subtract: ['$freelanceTotalCustomerCharges', '$freelanceTotalTechCharges'] }
//     }
//   });

//   // Sort by year, month ascending
//   pipeline.push({ $sort: { year: 1, month: 1 } });

//   // Run aggregation
//   const monthly = await Ticket.aggregate(pipeline).allowDiskUse(true);

//   // Build financial year totals by aggregating monthly results in JS
//   const fyTotals = monthly.reduce((acc, row) => {
//     const fy = row.financialYearLabel;
//     if (!acc[fy]) {
//       acc[fy] = {
//         financialYearLabel: fy,
//         payrollTicketCount: 0,
//         payrollTotalCustomerCharges: 0,
//         payrollTotalSalaries: 0,
//         payrollMargin: 0,
//         freelanceTotalCustomerCharges: 0,
//         freelanceTotalTechCharges: 0,
//         freelanceMargin: 0,
//         totalCustomerChargesAll: 0
//       };
//     }

//     acc[fy].payrollTicketCount += row.payrollTicketCount || 0;
//     acc[fy].payrollTotalCustomerCharges += row.payrollTotalCustomerCharges || 0;
//     acc[fy].payrollTotalSalaries += row.payrollTotalSalaries || 0;
//     acc[fy].payrollMargin += row.payrollMargin || 0;
//     acc[fy].freelanceTotalCustomerCharges += row.freelanceTotalCustomerCharges || 0;
//     acc[fy].freelanceTotalTechCharges += row.freelanceTotalTechCharges || 0;
//     acc[fy].freelanceMargin += row.freelanceMargin || 0;
//     acc[fy].totalCustomerChargesAll += row.totalCustomerChargesAll || 0;

//     return acc;
//   }, {});

//   return {
//     monthly,
//     financialYearTotals: fyTotals
//   };
// }






// services/marginsService.js
// const Ticket = require('../models/Tickets'); // adjust path if needed

// /**
//  * Get technician margins grouped by financial month and overall financial year totals.
//  * Financial year starts in April.
//  * Uses ticketAvailabilityDate and only includes tickets where:
//  *   - isTicketClosed === true
//  *   - ticketStatus === "work done" (case-insensitive)
//  *
//  * @param {Date|null} from optional - filters ticketAvailabilityDate >= from
//  * @param {Date|null} to   optional - filters ticketAvailabilityDate <= to
//  * @returns {Promise<{ monthly: Array, financialYearTotals: Object }>}
//  */
// async function getTechnicianMargins({ from = null, to = null } = {}) {
//   // Build match stage for ticketAvailabilityDate plus isTicketClosed and ticketStatus
//   const baseMatch = {
//     isTicketClosed: true,
//     // case-insensitive exact match for "work done"
//     ticketStatus: { $regex: /^work done$/i }
//   };

//   // Date filter applies to ticketAvailabilityDate
//   if (from || to) {
//     baseMatch.ticketAvailabilityDate = {};
//     if (from) baseMatch.ticketAvailabilityDate.$gte = from;
//     if (to) baseMatch.ticketAvailabilityDate.$lte = to;
//   } else {
//     // when no from/to provided, ensure ticketAvailabilityDate is present
//     baseMatch.ticketAvailabilityDate = { $ne: null };
//   }

//   const pipeline = [];

//   // initial match
//   pipeline.push({ $match: baseMatch });

//   // lookup technician doc to get category and salary
//   pipeline.push({
//     $lookup: {
//       from: 'technicians',
//       localField: 'technician',
//       foreignField: '_id',
//       as: 'technicianDoc'
//     }
//   });

//   pipeline.push({
//     $unwind: {
//       path: '$technicianDoc',
//       preserveNullAndEmptyArrays: true
//     }
//   });

//   // use ticketAvailabilityDate for month/year grouping
//   pipeline.push({
//     $addFields: {
//       ticketDate: '$ticketAvailabilityDate',
//       month: { $month: '$ticketAvailabilityDate' },
//       year: { $year: '$ticketAvailabilityDate' },
//       technicianCategory: '$technicianDoc.technicianCategoryType',
//       technicianSalary: '$technicianDoc.salary',
//       technicianId: '$technicianDoc._id'
//     }
//   });

//   // Compute financial year starting April:
//   pipeline.push({
//     $addFields: {
//       fyStartYear: {
//         $cond: [{ $gte: ['$month', 4] }, '$year', { $subtract: ['$year', 1] }]
//       }
//     }
//   });

//   // human readable month & FY labels
//   pipeline.push({
//     $addFields: {
//       financialMonthKey: {
//         $concat: [
//           { $toString: '$year' },
//           '-',
//           {
//             $cond: [
//               { $lt: ['$month', 10] },
//               { $concat: ['0', { $toString: '$month' }] },
//               { $toString: '$month' }
//             ]
//           }
//         ]
//       },
//       financialYearLabel: {
//         $concat: [
//           { $toString: '$fyStartYear' },
//           '-',
//           { $toString: { $add: ['$fyStartYear', 1] } }
//         ]
//       }
//     }
//   });

//   // Group by financial month
//   pipeline.push({
//     $group: {
//       _id: {
//         financialMonthKey: '$financialMonthKey',
//         financialYearLabel: '$financialYearLabel',
//         year: '$year',
//         month: '$month'
//       },

//       payrollTicketCount: {
//         $sum: { $cond: [{ $eq: ['$technicianCategory', 'payroll'] }, 1, 0] }
//       },
//       payrollTotalCustomerCharges: {
//         $sum: { $cond: [{ $eq: ['$technicianCategory', 'payroll'] }, '$totalCustomerCharges', 0] }
//       },

//       payrollTechniciansSet: {
//         $addToSet: {
//           $cond: [
//             { $eq: ['$technicianCategory', 'payroll'] },
//             { id: '$technicianId', salary: '$technicianSalary' },
//             null
//           ]
//         }
//       },

//       freelanceTotalCustomerCharges: {
//         $sum: { $cond: [{ $eq: ['$technicianCategory', 'freelance'] }, '$totalCustomerCharges', 0] }
//       },
//       freelanceTotalTechCharges: {
//         $sum: { $cond: [{ $eq: ['$technicianCategory', 'freelance'] }, '$totalTechCharges', 0] }
//       },

//       totalTicketsInMonth: { $sum: 1 },
//       totalCustomerChargesAll: { $sum: '$totalCustomerCharges' }
//     }
//   });

//   // clean payroll set and compute sums
//   pipeline.push({
//     $project: {
//       financialMonthKey: '$_id.financialMonthKey',
//       financialYearLabel: '$_id.financialYearLabel',
//       year: '$_id.year',
//       month: '$_id.month',

//       payrollTicketCount: 1,
//       payrollTotalCustomerCharges: 1,

//       payrollTechniciansArray: {
//         $filter: { input: '$payrollTechniciansSet', as: 't', cond: { $ne: ['$$t', null] } }
//       },

//       freelanceTotalCustomerCharges: 1,
//       freelanceTotalTechCharges: 1,

//       totalTicketsInMonth: 1,
//       totalCustomerChargesAll: 1
//     }
//   });

//   // sum unique payroll salaries
//   pipeline.push({
//     $addFields: {
//       payrollTotalSalaries: {
//         $reduce: {
//           input: '$payrollTechniciansArray',
//           initialValue: 0,
//           in: { $add: ['$$value', { $ifNull: ['$$this.salary', 0] }] }
//         }
//       }
//     }
//   });

//   // compute margins
//   pipeline.push({
//     $addFields: {
//       payrollMargin: { $subtract: ['$payrollTotalCustomerCharges', '$payrollTotalSalaries'] },
//       freelanceMargin: { $subtract: ['$freelanceTotalCustomerCharges', '$freelanceTotalTechCharges'] }
//     }
//   });

//   // order
//   pipeline.push({ $sort: { year: 1, month: 1 } });

//   const monthly = await Ticket.aggregate(pipeline).allowDiskUse(true);

//   // aggregate FY totals in JS
//   const fyTotals = monthly.reduce((acc, row) => {
//     const fy = row.financialYearLabel;
//     if (!acc[fy]) {
//       acc[fy] = {
//         financialYearLabel: fy,
//         payrollTicketCount: 0,
//         payrollTotalCustomerCharges: 0,
//         payrollTotalSalaries: 0,
//         payrollMargin: 0,
//         freelanceTotalCustomerCharges: 0,
//         freelanceTotalTechCharges: 0,
//         freelanceMargin: 0,
//         totalCustomerChargesAll: 0
//       };
//     }

//     acc[fy].payrollTicketCount += row.payrollTicketCount || 0;
//     acc[fy].payrollTotalCustomerCharges += row.payrollTotalCustomerCharges || 0;
//     acc[fy].payrollTotalSalaries += row.payrollTotalSalaries || 0;
//     acc[fy].payrollMargin += row.payrollMargin || 0;
//     acc[fy].freelanceTotalCustomerCharges += row.freelanceTotalCustomerCharges || 0;
//     acc[fy].freelanceTotalTechCharges += row.freelanceTotalTechCharges || 0;
//     acc[fy].freelanceMargin += row.freelanceMargin || 0;
//     acc[fy].totalCustomerChargesAll += row.totalCustomerChargesAll || 0;

//     return acc;
//   }, {});

//   return {
//     monthly,
//     financialYearTotals: fyTotals
//   };
// }




// **
//  * Get margins grouped by financial month and overall financial year totals.
//  * Also returns per-payroll-technician margin rows inside each month.
//  *
//  * Uses ticketAvailabilityDate and only includes tickets where:
//  *   - isTicketClosed === true
//  *   - ticketStatus === "work done" (case-insensitive)
//  *
//  * @param {Date|null} from optional - filters ticketAvailabilityDate >= from
//  * @param {Date|null} to   optional - filters ticketAvailabilityDate <= to
//  */

// async function getTechnicianMargins({ from = null, to = null } = {}) {
//   // Base match
//   const baseMatch = {
//     isTicketClosed: true,
//     ticketStatus: { $regex: /^work done$/i }
//   };

//   if (from || to) {
//     baseMatch.ticketAvailabilityDate = {};
//     if (from) baseMatch.ticketAvailabilityDate.$gte = from;
//     if (to) baseMatch.ticketAvailabilityDate.$lte = to;
//   } else {
//     baseMatch.ticketAvailabilityDate = { $ne: null };
//   }

//   const pipeline = [
//     { $match: baseMatch },

//     // Lookup technician document
//     {
//       $lookup: {
//         from: 'technicians',
//         localField: 'technician',
//         foreignField: '_id',
//         as: 'technicianDoc'
//       }
//     },
//     { $unwind: { path: '$technicianDoc', preserveNullAndEmptyArrays: true } },

//     // compute month/year/fy labels from ticketAvailabilityDate
//     {
//       $addFields: {
//         ticketDate: '$ticketAvailabilityDate',
//         month: { $month: '$ticketAvailabilityDate' },
//         year: { $year: '$ticketAvailabilityDate' },
//         technicianCategory: '$technicianDoc.technicianCategoryType',
//         technicianSalary: '$technicianDoc.salary',
//         technicianId: '$technicianDoc._id',
//         technicianName: '$technicianDoc.name'
//       }
//     },

//     {
//       $addFields: {
//         fyStartYear: {
//           $cond: [{ $gte: ['$month', 4] }, '$year', { $subtract: ['$year', 1] }]
//         }
//       }
//     },

//     {
//       $addFields: {
//         financialMonthKey: {
//           $concat: [
//             { $toString: '$year' },
//             '-',
//             {
//               $cond: [
//                 { $lt: ['$month', 10] },
//                 { $concat: ['0', { $toString: '$month' }] },
//                 { $toString: '$month' }
//               ]
//             }
//           ]
//         },
//         financialYearLabel: {
//           $concat: [
//             { $toString: '$fyStartYear' },
//             '-',
//             { $toString: { $add: ['$fyStartYear', 1] } }
//           ]
//         }
//       }
//     },

//     // -------------------------
//     // 1) Group by month + technician to produce per-tech-per-month rows
//     // -------------------------
//     {
//       $group: {
//         _id: {
//           financialMonthKey: '$financialMonthKey',
//           financialYearLabel: '$financialYearLabel',
//           year: '$year',
//           month: '$month',
//           technicianId: '$technicianId',
//           technicianCategory: '$technicianCategory',
//           technicianSalary: '$technicianSalary',
//           technicianName: '$technicianName'
//         },

//         // per-tech counts & sums
//         perTechTicketCount: { $sum: 1 },
//         perTechTotalCustomerCharges: { $sum: { $ifNull: ['$totalCustomerCharges', 0] } },
//         perTechTotalTechCharges: { $sum: { $ifNull: ['$totalTechCharges', 0] } }
//       }
//     },

//     // compute per-tech payroll margin (only meaningful for payroll category)
//     {
//       $addFields: {
//         perTechPayrollTotalCustomerCharges: {
//           $cond: [{ $eq: ['$_id.technicianCategory', 'payroll'] }, '$perTechTotalCustomerCharges', 0]
//         },
//         perTechFreelanceTotalCustomerCharges: {
//           $cond: [{ $eq: ['$_id.technicianCategory', 'freelance'] }, '$perTechTotalCustomerCharges', 0]
//         },
//         perTechFreelanceTotalTechCharges: {
//           $cond: [{ $eq: ['$_id.technicianCategory', 'freelance'] }, '$perTechTotalTechCharges', 0]
//         },
//         // salary (may be null)
//         perTechSalary: { $ifNull: ['$_id.technicianSalary', 0] }
//       }
//     },

//     {
//       $addFields: {
//         perTechPayrollMargin: { $subtract: ['$perTechPayrollTotalCustomerCharges', '$perTechSalary'] },
//         perTechFreelanceMargin: { $subtract: ['$perTechFreelanceTotalCustomerCharges', '$perTechFreelanceTotalTechCharges'] }
//       }
//     },

//     // -------------------------
//     // 2) Re-group by month to build monthly totals and collect per-tech rows
//     // -------------------------
//     {
//       $group: {
//         _id: {
//           financialMonthKey: '$_id.financialMonthKey',
//           financialYearLabel: '$_id.financialYearLabel',
//           year: '$_id.year',
//           month: '$_id.month'
//         },

//         // collect per-payroll-technician rows (preserve each technician separately)
//         payrollTechnicians: {
//           $push: {
//             $cond: [
//               { $eq: ['$_id.technicianCategory', 'payroll'] },
//               {
//                 technicianId: '$_id.technicianId',
//                 technicianName: '$_id.technicianName',
//                 salary: '$perTechSalary',
//                 ticketCount: '$perTechTicketCount',
//                 totalCustomerCharges: '$perTechPayrollTotalCustomerCharges',
//                 payrollMargin: '$perTechPayrollMargin'
//               },
//               '$$REMOVE'
//             ]
//           }
//         },

//         // collect per-freelance-technician rows if you want (optional)
//         freelanceTechnicians: {
//           $push: {
//             $cond: [
//               { $eq: ['$_id.technicianCategory', 'freelance'] },
//               {
//                 technicianId: '$_id.technicianId',
//                 technicianName: '$_id.technicianName',
//                 ticketCount: '$perTechTicketCount',
//                 totalCustomerCharges: '$perTechFreelanceTotalCustomerCharges',
//                 totalTechCharges: '$perTechTotalTechCharges',
//                 freelanceMargin: '$perTechFreelanceMargin'
//               },
//               '$$REMOVE'
//             ]
//           }
//         },

//         // month-level totals (sum across technicians)
//         payrollTicketCount: { $sum: '$perTechTicketCount' }, // counts all tickets (both payroll & freelance) - see note
//         payrollTotalCustomerCharges: { $sum: '$perTechPayrollTotalCustomerCharges' },
//         payrollTotalSalaries: { $sum: '$perTechSalary' },

//         freelanceTotalCustomerCharges: { $sum: '$perTechFreelanceTotalCustomerCharges' },
//         freelanceTotalTechCharges: { $sum: '$perTechTotalTechCharges' },

//         totalTicketsInMonth: { $sum: '$perTechTicketCount' },
//         totalCustomerChargesAll: { $sum: '$perTechTotalCustomerCharges' }
//       }
//     },

//     // compute margins at month level
//     {
//       $addFields: {
//         payrollMargin: { $subtract: ['$payrollTotalCustomerCharges', '$payrollTotalSalaries'] },
//         freelanceMargin: { $subtract: ['$freelanceTotalCustomerCharges', '$freelanceTotalTechCharges'] }
//       }
//     },

//     // sort
//     { $sort: { '_id.year': 1, '_id.month': 1 } },

//     // shaping output
//     {
//       $project: {
//         financialMonthKey: '$_id.financialMonthKey',
//         financialYearLabel: '$_id.financialYearLabel',
//         year: '$_id.year',
//         month: '$_id.month',

//         payrollTicketCount: 1,
//         payrollTotalCustomerCharges: 1,
//         payrollTotalSalaries: 1,
//         payrollMargin: 1,
//         payrollTechnicians: 1,

//         freelanceTotalCustomerCharges: 1,
//         freelanceTotalTechCharges: 1,
//         freelanceMargin: 1,
//         freelanceTechnicians: 1,

//         totalTicketsInMonth: 1,
//         totalCustomerChargesAll: 1
//       }
//     }
//   ];

//   const monthly = await Ticket.aggregate(pipeline).allowDiskUse(true);

//   // Build financial year totals from monthly
//   const fyTotals = monthly.reduce((acc, row) => {
//     const fy = row.financialYearLabel;
//     if (!acc[fy]) {
//       acc[fy] = {
//         financialYearLabel: fy,
//         payrollTicketCount: 0,
//         payrollTotalCustomerCharges: 0,
//         payrollTotalSalaries: 0,
//         payrollMargin: 0,
//         freelanceTotalCustomerCharges: 0,
//         freelanceTotalTechCharges: 0,
//         freelanceMargin: 0,
//         totalCustomerChargesAll: 0
//       };
//     }

//     acc[fy].payrollTicketCount += row.payrollTicketCount || 0;
//     acc[fy].payrollTotalCustomerCharges += row.payrollTotalCustomerCharges || 0;
//     acc[fy].payrollTotalSalaries += row.payrollTotalSalaries || 0;
//     acc[fy].payrollMargin += row.payrollMargin || 0;
//     acc[fy].freelanceTotalCustomerCharges += row.freelanceTotalCustomerCharges || 0;
//     acc[fy].freelanceTotalTechCharges += row.freelanceTotalTechCharges || 0;
//     acc[fy].freelanceMargin += row.freelanceMargin || 0;
//     acc[fy].totalCustomerChargesAll += row.totalCustomerChargesAll || 0;

//     return acc;
//   }, {});

//   return { monthly, financialYearTotals: fyTotals };
// }











/**
 * Get margins grouped by financial month with per-technician rows,
 * based on ticketAvailabilityDate and only closed "work done" tickets.
 *
 * @param {Date|null} from optional - filters ticketAvailabilityDate >= from
 * @param {Date|null} to   optional - filters ticketAvailabilityDate <= to
 * @returns {Promise<{ monthly: Array, financialYearTotals: Object, financialYearTechnicianTotals: Object }>}
 */


// =======================================================================









//       it give months and financial year both data  and ticket id also;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;



// function parseMonthToNumber(monthInput) {
//   if (monthInput == null) return null;
//   if (typeof monthInput === 'number') {
//     if (monthInput >= 1 && monthInput <= 12) return monthInput;
//     return null;
//   }

//   const s = String(monthInput).trim().toLowerCase();

//   const map = {
//     1: ['jan', 'january', 'junarary', 'januray', 'janury'],
//     2: ['feb', 'february', 'feburary', 'febuary'],
//     3: ['mar', 'march'],
//     4: ['apr', 'april'],
//     5: ['may'],
//     6: ['jun', 'june'],
//     7: ['jul', 'july'],
//     8: ['aug', 'august'],
//     9: ['sep', 'sept', 'september'],
//     10: ['oct', 'october'],
//     11: ['nov', 'november'],
//     12: ['dec', 'december']
//   };

//   // check exact prefixes and alias list
//   for (const [num, aliases] of Object.entries(map)) {
//     for (const a of aliases) {
//       if (s === a || s.startsWith(a) || s.includes(a)) return Number(num);
//     }
//   }

//   // fallback: try parseInt
//   const asNum = parseInt(s, 10);
//   if (!Number.isNaN(asNum) && asNum >= 1 && asNum <= 12) return asNum;

//   return null;
// }



// function getFinancialMonthRange(monthInput, financialYearLabel) {
//   const monthNum = parseMonthToNumber(monthInput);
//   if (!monthNum) throw new Error('Invalid month input: ' + monthInput);

//   if (!financialYearLabel || typeof financialYearLabel !== 'string') {
//     throw new Error('financialYearLabel must be provided, e.g. "2025-2026"');
//   }

//   // extract start year (left of dash)
//   const parts = financialYearLabel.split('-').map(p => p.trim());
//   if (parts.length < 1 || !/^\d{4}$/.test(parts[0])) {
//     throw new Error('Invalid financialYearLabel, expected "YYYY-YYYY" like "2025-2026"');
//   }
//   const fyStartYear = parseInt(parts[0], 10);

//   // month to actual calendar year: Apr(4)..Dec(12) => fyStartYear, Jan(1)..Mar(3) => fyStartYear + 1
//   const actualYear = monthNum >= 4 ? fyStartYear : fyStartYear + 1;

//   // build UTC start-of-month and end-of-month
//   // Note: JS Date uses monthIndex 0..11
//   const from = new Date(Date.UTC(actualYear, monthNum - 1, 1, 0, 0, 0, 0));
//   // get first moment of next month and subtract 1 ms for inclusive month-end
//   const firstOfNextMonth = new Date(Date.UTC(actualYear, monthNum, 1, 0, 0, 0, 0));
//   const to = new Date(firstOfNextMonth.getTime() - 1); // 23:59:59.999 of last day

//   return { from, to, month: monthNum, year: actualYear };
// }



// async function getTechnicianMargins({   } = {}) {

//   const { from, to } = getFinancialMonthRange('9', '2025-2026');
//   const baseMatch = {
//     isTicketClosed: true,
//     ticketStatus: "work done",
//     technician: { $ne: null }
//   };

//   if (from || to) {
//     baseMatch.ticketAvailabilityDate = {};
//     if (from) baseMatch.ticketAvailabilityDate.$gte = from;
//     if (to) baseMatch.ticketAvailabilityDate.$lte = to;
//   } else {
//     baseMatch.ticketAvailabilityDate = { $ne: null };
//   }

//   const pipeline = [
//     { $match: baseMatch },


//     {
//       $lookup: {
//         from: 'technicians',
//         localField: 'technician',
//         foreignField: '_id',
//         as: 'technicianDoc'
//       }
//     },
//     { $unwind: { path: '$technicianDoc', preserveNullAndEmptyArrays: false } },

//     // compute fields per ticket: date parts, vehicle count per ticket, and ticketDay string
//     {
//       $addFields: {
//         ticketDate: '$ticketAvailabilityDate',
//         month: { $month: '$ticketAvailabilityDate' },
//         year: { $year: '$ticketAvailabilityDate' },
//         ticketDay: { $dateToString: { format: "%Y-%m-%d", date: "$ticketAvailabilityDate" } },
//         ticketVehicleCount: { $cond: [{ $isArray: "$ticketSKU" }, { $size: "$ticketSKU" }, 1] },

//         technicianId: '$technicianDoc._id',
//         technicianName: '$technicianDoc.name',
//         technicianType: '$technicianDoc.technicianCategoryType',
//         // keep stored salary in doc if you ever need it, but we will ignore it for payroll monthly calc
//         technicianSalary: '$technicianDoc.salary',

//         totalCustomerChargesSafe: { $ifNull: ['$totalCustomerCharges', 0] },
//         totalTechChargesSafe: { $ifNull: ['$totalTechCharges', 0] },
//         ticketSKU: '$ticketSKU'
//       }
//     },

//     // financial year start & labels, month name
//     {
//       $addFields: {
//         fyStartYear: {
//           $cond: [{ $gte: ['$month', 4] }, '$year', { $subtract: ['$year', 1] }]
//         }
//       }
//     },
//     {
//       $addFields: {
//         financialMonthKey: {
//           $concat: [
//             { $toString: '$year' }, '-',
//             { $cond: [{ $lt: ['$month', 10] }, { $concat: ['0', { $toString: '$month' }] }, { $toString: '$month' }] }
//           ]
//         },
//         financialYearLabel: {
//           $concat: [
//             { $toString: '$fyStartYear' },
//             '-',
//             { $toString: { $add: ['$fyStartYear', 1] } }
//           ]
//         },
//         monthName: {
//           $arrayElemAt: [
//             [ null, 'January','February','March','April','May','June','July','August','September','October','November','December' ],
//             '$month'
//           ]
//         }
//       }
//     },

//     // Group by month + technician -> compute totals and collect ticket days & vehicle counts
//     {
//       $group: {
//         _id: {
//           financialMonthKey: '$financialMonthKey',
//           financialYearLabel: '$financialYearLabel',
//           year: '$year',
//           month: '$month',
//           monthName: '$monthName',
//           technicianId: '$technicianId',
//           technicianName: '$technicianName',
//           technicianType: '$technicianType',
//           technicianSalary: '$technicianSalary'
//         },
//         ticketCountForTech: { $sum: 1 },
//         totalCustomerChargesForTech: { $sum: '$totalCustomerChargesSafe' },
//         totalTechChargesForTech: { $sum: '$totalTechChargesSafe' },

//         // vehicle counts (sum of per-ticket vehicle counts)
//         vehicleCountForTech: { $sum: '$ticketVehicleCount' },

//         // unique ticket days for days worked
//         ticketDaysSet: { $addToSet: '$ticketDay' },

//         // collect ticket ids and SKUs
//         ticketIds: { $push: '$_id' },
//         ticketSKUs: { $push: '$ticketSKU' }
//       }
//     },

//     // compute per-tech intermediate fields
//     {
//       $addFields: {
//         perTechType: '$_id.technicianType',
//         ticketDaysCount: { $size: { $ifNull: ['$ticketDaysSet', []] } },
//         vehicleCountForTech: { $ifNull: ['$vehicleCountForTech', 0] },
//         totalCust: '$totalCustomerChargesForTech',
//         totalTech: '$totalTechChargesForTech',
//         grpYear: '$_id.year',
//         grpMonth: '$_id.month'
//       }
//     },

//     // compute daysInMonth (calendar days for the month) using dateFromParts + dateAdd/dateSubtract
//     {
//       $addFields: {
//         // build a date for first day of that group-month
//         monthFirstDay: {
//           $dateFromParts: { year: '$grpYear', month: '$grpMonth', day: 1 }
//         }
//       }
//     },
//     {
//       $addFields: {
//         // take first day of next month, subtract 1 day -> last day of this month, then dayOfMonth gives number of days in month
//         monthDaysCount: {
//           $dayOfMonth: {
//             $dateSubtract: {
//               startDate: { $dateAdd: { startDate: '$monthFirstDay', unit: 'month', amount: 1 } },
//               unit: 'day',
//               amount: 1
//             }
//           }
//         }
//       }
//     },

//     // compute payroll month salary (1000 * daysInMonth) and margins
//     {
//       $addFields: {
//         // month salary for payroll techs: 1000 * days in calendar month (ignore declared salary)
//         monthSalaryForPayroll: {
//           $multiply: ['$monthDaysCount', 1000]
//         },

//         perTechPayrollMargin: {
//           $cond: [
//             { $eq: ['$_id.technicianType', 'payroll'] },
//             { $subtract: ['$totalCust', { $multiply: ['$monthDaysCount', 1000] }] },
//             0
//           ]
//         },

//         perTechFreelanceMargin: {
//           $cond: [
//             { $eq: ['$_id.technicianType', 'freelance'] },
//             { $subtract: ['$totalCust', '$totalTech'] },
//             0
//           ]
//         },

//         marginPerVehiclePayroll: {
//           $cond: [
//             { $and: [ { $eq: ['$_id.technicianType', 'payroll'] }, { $gt: ['$vehicleCountForTech', 0] } ] },
//             { $divide: [ { $subtract: ['$totalCust', { $multiply: ['$monthDaysCount', 1000] }] }, '$vehicleCountForTech' ] },
//             0
//           ]
//         },

//         marginPerVehicleFreelance: {
//           $cond: [
//             { $and: [ { $eq: ['$_id.technicianType', 'freelance'] }, { $gt: ['$vehicleCountForTech', 0] } ] },
//             { $divide: [ { $subtract: ['$totalCust', '$totalTech'] }, '$vehicleCountForTech' ] },
//             0
//           ]
//         }
//       }
//     },

//     // Re-group by month to collect arrays of payroll & freelance techs (with vehicle & days info)
//     {
//       $group: {
//         _id: {
//           financialMonthKey: '$_id.financialMonthKey',
//           financialYearLabel: '$_id.financialYearLabel',
//           year: '$_id.year',
//           month: '$_id.month',
//           monthName: '$_id.monthName'
//         },

//         payrollTechnicians: {
//           $push: {
//             $cond: [
//               { $eq: ['$_id.technicianType', 'payroll'] },
//               {
//                 technicianId: '$_id.technicianId',
//                 technicianName: '$_id.technicianName',
//                 technicianType: '$_id.technicianType',
//                 ticketCount: '$ticketCountForTech',
//                 totalCustomerCharges: '$totalCustomerChargesForTech',
//                 // declared salary still preserved but not used in payroll calc
//                 salary: '$_id.technicianSalary',
//                 actualSalary: '$monthSalaryForPayroll',   // our enforced rule: 1000 * days in month
//                 margin: '$perTechPayrollMargin',
//                 marginPerVehicle: '$marginPerVehiclePayroll',
//                 vehicleCount: '$vehicleCountForTech',
//                 daysWorked: '$ticketDaysCount',
//                 monthDaysCount: '$monthDaysCount',        // calendar days for that month
//                 ticketIds: '$ticketIds',
//                 ticketSKUs: '$ticketSKUs'
//               },
//               '$$REMOVE'
//             ]
//           }
//         },

//         freelanceTechnicians: {
//           $push: {
//             $cond: [
//               { $eq: ['$_id.technicianType', 'freelance'] },
//               {
//                 technicianId: '$_id.technicianId',
//                 technicianName: '$_id.technicianName',
//                 technicianType: '$_id.technicianType',
//                 ticketCount: '$ticketCountForTech',
//                 totalCustomerCharges: '$totalCustomerChargesForTech',
//                 totalTechCharges: '$totalTechChargesForTech',
//                 margin: '$perTechFreelanceMargin',
//                 marginPerVehicle: '$marginPerVehicleFreelance',
//                 vehicleCount: '$vehicleCountForTech',
//                 daysWorked: '$ticketDaysCount',
//                 ticketIds: '$ticketIds',
//                 ticketSKUs: '$ticketSKUs'
//               },
//               '$$REMOVE'
//             ]
//           }
//         },

//         // month-level sums
//         payrollTotalCustomerCharges: { $sum: { $cond: [ { $eq: ['$_id.technicianType', 'payroll'] }, '$totalCustomerChargesForTech', 0 ] } },
//         payrollTotalActualSalaries: { $sum: { $cond: [ { $eq: ['$_id.technicianType', 'payroll'] }, '$monthSalaryForPayroll', 0 ] } },
//         payrollDeclaredSalaries: { $sum: { $cond: [ { $eq: ['$_id.technicianType', 'payroll'] }, '$_id.technicianSalary', 0 ] } },

//         payrollTicketCount: { $sum: { $cond: [ { $eq: ['$_id.technicianType', 'payroll'] }, '$ticketCountForTech', 0 ] } },

//         freelanceTotalCustomerCharges: { $sum: { $cond: [ { $eq: ['$_id.technicianType', 'freelance'] }, '$totalCustomerChargesForTech', 0 ] } },
//         freelanceTotalTechCharges: { $sum: { $cond: [ { $eq: ['$_id.technicianType', 'freelance'] }, '$totalTechChargesForTech', 0 ] } },

//         totalTicketsInMonth: { $sum: '$ticketCountForTech' },
//         totalCustomerChargesAll: { $sum: '$totalCustomerChargesForTech' },

//         totalVehiclesInMonth: { $sum: '$vehicleCountForTech' }
//       }
//     },

//     // compute month-level margins
//     {
//       $addFields: {
//         payrollMargin: { $subtract: ['$payrollTotalCustomerCharges', '$payrollTotalActualSalaries'] },
//         freelanceMargin: { $subtract: ['$freelanceTotalCustomerCharges', '$freelanceTotalTechCharges'] }
//       }
//     },

//     { $sort: { '_id.year': 1, '_id.month': 1 } },

//     {
//       $project: {
//         financialMonthKey: '$_id.financialMonthKey',
//         financialYearLabel: '$_id.financialYearLabel',
//         year: '$_id.year',
//         month: '$_id.month',
//         monthName: '$_id.monthName',

//         payrollTicketCount: 1,
//         payrollTotalCustomerCharges: 1,
//         payrollDeclaredSalaries: 1,
//         payrollTotalActualSalaries: 1,
//         payrollMargin: 1,
//         payrollTechnicians: 1,

//         freelanceTotalCustomerCharges: 1,
//         freelanceTotalTechCharges: 1,
//         freelanceMargin: 1,
//         freelanceTechnicians: 1,

//         totalTicketsInMonth: 1,
//         totalCustomerChargesAll: 1,
//         totalVehiclesInMonth: 1
//       }
//     }
//   ];

//   const monthly = await Ticket.aggregate(pipeline).allowDiskUse(true);

//   // Build financial year totals and per-tech FY totals
//   const financialYearTotals = {};
//   const financialYearTechnicianTotals = {};

//   for (const m of monthly) {
//     const fy = m.financialYearLabel;
//     if (!financialYearTotals[fy]) {
//       financialYearTotals[fy] = {
//         financialYearLabel: fy,
//         payrollTicketCount: 0,
//         payrollTotalCustomerCharges: 0,
//         payrollTotalSalariesDeclared: 0,
//         payrollTotalActualSalaries: 0,
//         payrollMargin: 0,
//         freelanceTotalCustomerCharges: 0,
//         freelanceTotalTechCharges: 0,
//         freelanceMargin: 0,
//         totalCustomerChargesAll: 0,
//         totalPayrollMargin: 0,
//         totalFreelanceMargin: 0,
//         totalMargin: 0,
//         totalTickets: 0,
//         totalVehicles: 0,
//         months: []
//       };
//     }

//     financialYearTotals[fy].payrollTicketCount += m.payrollTicketCount || 0;
//     financialYearTotals[fy].payrollTotalCustomerCharges += m.payrollTotalCustomerCharges || 0;
//     financialYearTotals[fy].payrollTotalSalariesDeclared += m.payrollDeclaredSalaries || 0;
//     financialYearTotals[fy].payrollTotalActualSalaries += m.payrollTotalActualSalaries || 0;
//     financialYearTotals[fy].payrollMargin += m.payrollMargin || 0;
//     financialYearTotals[fy].freelanceTotalCustomerCharges += m.freelanceTotalCustomerCharges || 0;
//     financialYearTotals[fy].freelanceTotalTechCharges += m.freelanceTotalTechCharges || 0;
//     financialYearTotals[fy].freelanceMargin += m.freelanceMargin || 0;
//     financialYearTotals[fy].totalCustomerChargesAll += m.totalCustomerChargesAll || 0;

//     financialYearTotals[fy].totalPayrollMargin += m.payrollMargin || 0;
//     financialYearTotals[fy].totalFreelanceMargin += m.freelanceMargin || 0;
//     financialYearTotals[fy].totalTickets += m.totalTicketsInMonth || 0;
//     financialYearTotals[fy].totalVehicles += m.totalVehiclesInMonth || 0;

//     if (!financialYearTechnicianTotals[fy]) financialYearTechnicianTotals[fy] = {};

//     const pushTech = (tech, isPayroll) => {
//       if (!tech) return;
//       const id = String(tech.technicianId);
//       if (!financialYearTechnicianTotals[fy][id]) {
//         financialYearTechnicianTotals[fy][id] = {
//           technicianId: tech.technicianId,
//           technicianName: tech.technicianName,
//           technicianType: tech.technicianType,
//           ticketCount: 0,
//           totalCustomerCharges: 0,
//           totalTechCharges: 0,
//           totalDeclaredSalaries: 0,
//           totalActualSalaries: 0,
//           margin: 0,
//           vehicleCount: 0,
//           daysWorked: 0,
//           ticketIds: [],
//           ticketSKUs: []
//         };
//       }
//       financialYearTechnicianTotals[fy][id].ticketCount += tech.ticketCount || 0;
//       financialYearTechnicianTotals[fy][id].totalCustomerCharges += tech.totalCustomerCharges || 0;
//       financialYearTechnicianTotals[fy][id].totalTechCharges += tech.totalTechCharges || 0;
//       financialYearTechnicianTotals[fy][id].vehicleCount += tech.vehicleCount || 0;
//       financialYearTechnicianTotals[fy][id].daysWorked += tech.daysWorked || 0;

//       if (isPayroll) {
//         financialYearTechnicianTotals[fy][id].totalDeclaredSalaries += tech.salary || 0;
//         financialYearTechnicianTotals[fy][id].totalActualSalaries += tech.actualSalary || 0;
//         financialYearTechnicianTotals[fy][id].margin += (tech.margin || 0);
//       } else {
//         financialYearTechnicianTotals[fy][id].margin += (tech.margin || 0);
//       }

//       if (Array.isArray(tech.ticketIds)) financialYearTechnicianTotals[fy][id].ticketIds.push(...tech.ticketIds.map(String));
//       if (Array.isArray(tech.ticketSKUs)) financialYearTechnicianTotals[fy][id].ticketSKUs.push(...tech.ticketSKUs);
//     };

//     for (const p of (m.payrollTechnicians || [])) pushTech(p, true);
//     for (const f of (m.freelanceTechnicians || [])) pushTech(f, false);
//   }

//   // convert per-tech FY totals to arrays and dedupe ticket lists
//   const financialYearTechnicianTotalsArrays = {};
//   for (const fy of Object.keys(financialYearTechnicianTotals)) {
//     financialYearTechnicianTotalsArrays[fy] = Object.values(financialYearTechnicianTotals[fy]).map(t => {
//       t.ticketIds = Array.from(new Set(t.ticketIds));
//       t.ticketSKUs = Array.from(new Set(t.ticketSKUs));
//       t.marginPerVehicle = (t.vehicleCount > 0) ? (t.margin / t.vehicleCount) : 0;
//       return t;
//     });
//   }

//   // Build months arrays Apr->Mar for each FY
//   const monthlyMap = {};
//   for (const row of monthly) {
//     const fy = row.financialYearLabel;
//     if (!monthlyMap[fy]) monthlyMap[fy] = {};
//     monthlyMap[fy][row.month] = row;
//   }

//   const monthNames = [
//     null, 'January', 'February', 'March', 'April', 'May', 'June',
//     'July', 'August', 'September', 'October', 'November', 'December'
//   ];

//   for (const fy of Object.keys(financialYearTotals)) {
//     const fyStartYear = parseInt(fy.split('-')[0], 10);
//     const monthsOrder = [4,5,6,7,8,9,10,11,12,1,2,3];
//     const monthsArr = [];
//     let fyPayrollSum = 0;
//     let fyFreelanceSum = 0;
//     let fyTotalTickets = 0;
//     let fyTotalVehicles = 0;

//     for (const monthNum of monthsOrder) {
//       const actualYear = monthNum >= 4 ? fyStartYear : fyStartYear + 1;
//       const existing = (monthlyMap[fy] && monthlyMap[fy][monthNum]) ? monthlyMap[fy][monthNum] : null;

//       const payrollMargin = existing ? (existing.payrollMargin || 0) : 0;
//       const freelanceMargin = existing ? (existing.freelanceMargin || 0) : 0;
//       const totalMargin = payrollMargin + freelanceMargin;
//       const totalTickets = existing ? (existing.totalTicketsInMonth || 0) : 0;
//       const totalVehicles = existing ? (existing.totalVehiclesInMonth || 0) : 0;
//       const payrollTotalCustomerCharges = existing ? (existing.payrollTotalCustomerCharges || 0) : 0;
//       const freelanceTotalCustomerCharges = existing ? (existing.freelanceTotalCustomerCharges || 0) : 0;

//       monthsArr.push({
//         financialMonthKey: existing ? existing.financialMonthKey : `${actualYear}-${(monthNum<10 ? '0'+monthNum : monthNum)}`,
//         financialYearLabel: fy,
//         year: actualYear,
//         month: monthNum,
//         monthName: monthNames[monthNum],
//         payrollMargin,
//         freelanceMargin,
//         totalMargin,
//         totalTickets,
//         totalVehicles,
//         payrollTotalCustomerCharges,
//         freelanceTotalCustomerCharges
//       });

//       fyPayrollSum += payrollMargin;
//       fyFreelanceSum += freelanceMargin;
//       fyTotalTickets += totalTickets;
//       fyTotalVehicles += totalVehicles;
//     }

//     financialYearTotals[fy].months = monthsArr;
//     financialYearTotals[fy].totalPayrollMargin = fyPayrollSum;
//     financialYearTotals[fy].totalFreelanceMargin = fyFreelanceSum;
//     financialYearTotals[fy].totalMargin = fyPayrollSum + fyFreelanceSum;
//     financialYearTotals[fy].totalTickets = fyTotalTickets;
//     financialYearTotals[fy].totalVehicles = fyTotalVehicles;
//   }

//   // collate included ticket ids per FY
//   const includedTicketIdsByFY = {};
//   for (const m of monthly) {
//     const fy = m.financialYearLabel || 'unknown';
//     if (!includedTicketIdsByFY[fy]) includedTicketIdsByFY[fy] = new Set();

//     const pushIdsFromTech = tech => {
//       if (!tech || !Array.isArray(tech.ticketIds)) return;
//       for (const id of tech.ticketIds) includedTicketIdsByFY[fy].add(String(id));
//     };

//     if (Array.isArray(m.payrollTechnicians)) for (const t of m.payrollTechnicians) pushIdsFromTech(t);
//     if (Array.isArray(m.freelanceTechnicians)) for (const t of m.freelanceTechnicians) pushIdsFromTech(t);
//   }

//   const includedTicketIdsByFYArrays = {};
//   for (const fy of Object.keys(includedTicketIdsByFY)) includedTicketIdsByFYArrays[fy] = Array.from(includedTicketIdsByFY[fy]);
//   const includedTicketIdsAll = Array.from(new Set(Object.values(includedTicketIdsByFYArrays).flat()));

//   return {
//     monthly,
//     financialYearTotals,
//     financialYearTechnicianTotals: financialYearTechnicianTotalsArrays,
//     includedTicketIds: includedTicketIdsAll,
//     includedTicketIdsByFY: includedTicketIdsByFYArrays
//   };
// }



// ----------------- helpers -----------------
function parseMonthToNumber(monthInput) {
  if (monthInput == null) return null;
  if (typeof monthInput === 'number') {
    if (monthInput >= 1 && monthInput <= 12) return monthInput;
    return null;
  }

  const s = String(monthInput).trim().toLowerCase();

  const map = {
    1: ['jan', 'january', 'junarary', 'januray', 'janury'],
    2: ['feb', 'february', 'feburary', 'febuary'],
    3: ['mar', 'march'],
    4: ['apr', 'april'],
    5: ['may'],
    6: ['jun', 'june'],
    7: ['jul', 'july'],
    8: ['aug', 'august'],
    9: ['sep', 'sept', 'september'],
    10: ['oct', 'october'],
    11: ['nov', 'november'],
    12: ['dec', 'december']
  };

  for (const [num, aliases] of Object.entries(map)) {
    for (const a of aliases) {
      if (s === a || s.startsWith(a) || s.includes(a)) return Number(num);
    }
  }

  const asNum = parseInt(s, 10);
  if (!Number.isNaN(asNum) && asNum >= 1 && asNum <= 12) return asNum;
  return null;
}

function getFinancialMonthRange(monthInput, financialYearLabel) {
  const monthNum = parseMonthToNumber(monthInput);
  if (!monthNum) throw new Error('Invalid month input: ' + monthInput);

  if (!financialYearLabel || typeof financialYearLabel !== 'string') {
    throw new Error('financialYearLabel must be provided, e.g. "2025-2026"');
  }

  const parts = financialYearLabel.split('-').map(p => p.trim());
  if (parts.length < 1 || !/^\d{4}$/.test(parts[0])) {
    throw new Error('Invalid financialYearLabel, expected "YYYY-YYYY" like "2025-2026"');
  }
  const fyStartYear = parseInt(parts[0], 10);

  // months Apr(4)..Dec(12) => fyStartYear, Jan(1)..Mar(3) => fyStartYear+1
  const actualYear = monthNum >= 4 ? fyStartYear : fyStartYear + 1;

  const from = new Date(Date.UTC(actualYear, monthNum - 1, 1, 0, 0, 0, 0));
  const firstOfNextMonth = new Date(Date.UTC(actualYear, monthNum, 1, 0, 0, 0, 0));
  const to = new Date(firstOfNextMonth.getTime() - 1);

  return { from, to, month: monthNum, year: actualYear };
}

// ----------------- main function (updated) -----------------
/**
 * If you pass { month, financialYearLabel } this will compute from/to for that month and return only that month results.
 * If you pass { from, to } it will use the explicit range (you get full monthly array - but since you limited range it will effectively be per month).
 */

// async function getTechnicianMargins({ from = null,to = null,  month = null, financialYearLabel = null } = {}) {
//   // const { from, to } = getFinancialMonthRange('9', '2025-2026');
//   // If month + financialYearLabel provided, compute from/to for that single month
//   let requestedMonth = null;
//   let requestedFY = null;
//   if (month != null && financialYearLabel != null) {
//     const r = getFinancialMonthRange(month, financialYearLabel);
//     from = r.from;
//     console.log(r,"mmmmm");
//     to = r.to;
//     requestedMonth = r.month;      // 1..12
//     requestedFY = financialYearLabel;
//   }


//   const baseMatch = {
//     isTicketClosed: true,
//     ticketStatus: "work done",
//     technician: { $ne: null }
//   };

//   if (from || to) {
//     baseMatch.ticketAvailabilityDate = {};
//     if (from) baseMatch.ticketAvailabilityDate.$gte = from;
//     if (to) baseMatch.ticketAvailabilityDate.$lt = to;
//   } else {
//     baseMatch.ticketAvailabilityDate = { $ne: null };
//   }

//   // const pipeline = [
//   //   { $match: baseMatch },

//   //   {
//   //     $lookup: {
//   //       from: 'technicians',
//   //       localField: 'technician',
//   //       foreignField: '_id',
//   //       as: 'technicianDoc'
//   //     }
//   //   },
//   //   { $unwind: { path: '$technicianDoc', preserveNullAndEmptyArrays: false } },

//   //   {
//   //     $addFields: {
//   //       ticketDate: '$ticketAvailabilityDate',
//   //       month: { $month: '$ticketAvailabilityDate' },
//   //       year: { $year: '$ticketAvailabilityDate' },
//   //       ticketDay: { $dateToString: { format: "%Y-%m-%d", date: "$ticketAvailabilityDate" } },
//   //       ticketVehicleCount: { $cond: [{ $isArray: "$ticketSKU" }, { $size: "$ticketSKU" }, 1] },

//   //       technicianId: '$technicianDoc._id',
//   //       technicianName: '$technicianDoc.name',
//   //       technicianType: '$technicianDoc.technicianCategoryType',
//   //       technicianSalary: '$technicianDoc.salary',

//   //       totalCustomerChargesSafe: { $ifNull: ['$totalCustomerCharges', 0] },
//   //       totalTechChargesSafe: { $ifNull: ['$totalTechCharges', 0] },
//   //       ticketSKU: '$ticketSKU'
//   //     }
//   //   },

//   //   {
//   //     $addFields: {
//   //       fyStartYear: {
//   //         $cond: [{ $gte: ['$month', 4] }, '$year', { $subtract: ['$year', 1] }]
//   //       }
//   //     }
//   //   },
//   //   {
//   //     $addFields: {
//   //       financialMonthKey: {
//   //         $concat: [
//   //           { $toString: '$year' }, '-',
//   //           { $cond: [{ $lt: ['$month', 10] }, { $concat: ['0', { $toString: '$month' }] }, { $toString: '$month' }] }
//   //         ]
//   //       },
//   //       financialYearLabel: {
//   //         $concat: [
//   //           { $toString: '$fyStartYear' },
//   //           '-',
//   //           { $toString: { $add: ['$fyStartYear', 1] } }
//   //         ]
//   //       },
//   //       monthName: {
//   //         $arrayElemAt: [
//   //           [ null, 'January','February','March','April','May','June','July','August','September','October','November','December' ],
//   //           '$month'
//   //         ]
//   //       }
//   //     }
//   //   },

//   //   {
//   //     $group: {
//   //       _id: {
//   //         financialMonthKey: '$financialMonthKey',
//   //         financialYearLabel: '$financialYearLabel',
//   //         year: '$year',
//   //         month: '$month',
//   //         monthName: '$monthName',
//   //         technicianId: '$technicianId',
//   //         technicianName: '$technicianName',
//   //         technicianType: '$technicianType',
//   //         technicianSalary: '$technicianSalary'
//   //       },
//   //       ticketCountForTech: { $sum: 1 },
//   //       totalCustomerChargesForTech: { $sum: '$totalCustomerChargesSafe' },
//   //       totalTechChargesForTech: { $sum: '$totalTechChargesSafe' },
//   //       vehicleCountForTech: { $sum: '$ticketVehicleCount' },
//   //       ticketDaysSet: { $addToSet: '$ticketDay' },
//   //       ticketIds: { $push: '$_id' },
//   //       ticketSKUs: { $push: '$ticketSKU' }
//   //     }
//   //   },

//   //   {
//   //     $addFields: {
//   //       perTechType: '$_id.technicianType',
//   //       ticketDaysCount: { $size: { $ifNull: ['$ticketDaysSet', []] } },
//   //       vehicleCountForTech: { $ifNull: ['$vehicleCountForTech', 0] },
//   //       totalCust: '$totalCustomerChargesForTech',
//   //       totalTech: '$totalTechChargesForTech',
//   //       grpYear: '$_id.year',
//   //       grpMonth: '$_id.month'
//   //     }
//   //   },

//   //   {
//   //     $addFields: {
//   //       monthFirstDay: {
//   //         $dateFromParts: { year: '$grpYear', month: '$grpMonth', day: 1 }
//   //       }
//   //     }
//   //   },
//   //   {
//   //     $addFields: {
//   //       monthDaysCount: {
//   //         $dayOfMonth: {
//   //           $dateSubtract: {
//   //             startDate: { $dateAdd: { startDate: '$monthFirstDay', unit: 'month', amount: 1 } },
//   //             unit: 'day',
//   //             amount: 1
//   //           }
//   //         }
//   //       }
//   //     }
//   //   },

//   //   {
//   //     $addFields: {
//   //       monthSalaryForPayroll: { $multiply: ['$monthDaysCount', 1000] },

//   //       perTechPayrollMargin: {
//   //         $cond: [
//   //           { $eq: ['$_id.technicianType', 'payroll'] },
//   //           { $subtract: ['$totalCust', { $multiply: ['$monthDaysCount', 1000] }] },
//   //           0
//   //         ]
//   //       },

//   //       perTechFreelanceMargin: {
//   //         $cond: [
//   //           { $eq: ['$_id.technicianType', 'freelance'] },
//   //           { $subtract: ['$totalCust', '$totalTech'] },
//   //           0
//   //         ]
//   //       },

//   //       marginPerVehiclePayroll: {
//   //         $cond: [
//   //           { $and: [ { $eq: ['$_id.technicianType', 'payroll'] }, { $gt: ['$vehicleCountForTech', 0] } ] },
//   //           { $divide: [ { $subtract: ['$totalCust', { $multiply: ['$monthDaysCount', 1000] }] }, '$vehicleCountForTech' ] },
//   //           0
//   //         ]
//   //       },

//   //       marginPerVehicleFreelance: {
//   //         $cond: [
//   //           { $and: [ { $eq: ['$_id.technicianType', 'freelance'] }, { $gt: ['$vehicleCountForTech', 0] } ] },
//   //           { $divide: [ { $subtract: ['$totalCust', '$totalTech'] }, '$vehicleCountForTech' ] },
//   //           0
//   //         ]
//   //       }
//   //     }
//   //   },

//   //   {
//   //     $group: {
//   //       _id: {
//   //         financialMonthKey: '$_id.financialMonthKey',
//   //         financialYearLabel: '$_id.financialYearLabel',
//   //         year: '$_id.year',
//   //         month: '$_id.month',
//   //         monthName: '$_id.monthName'
//   //       },

//   //       payrollTechnicians: {
//   //         $push: {
//   //           $cond: [
//   //             { $eq: ['$_id.technicianType', 'payroll'] },
//   //             {
//   //               technicianId: '$_id.technicianId',
//   //               technicianName: '$_id.technicianName',
//   //               technicianType: '$_id.technicianType',
//   //               ticketCount: '$ticketCountForTech',
//   //               totalCustomerCharges: '$totalCustomerChargesForTech',
//   //               salary: '$_id.technicianSalary',
//   //               actualSalary: '$monthSalaryForPayroll',
//   //               margin: '$perTechPayrollMargin',
//   //               marginPerVehicle: '$marginPerVehiclePayroll',
//   //               vehicleCount: '$vehicleCountForTech',
//   //               daysWorked: '$ticketDaysCount',
//   //               monthDaysCount: '$monthDaysCount',
//   //               ticketIds: '$ticketIds',
//   //               ticketSKUs: '$ticketSKUs'
//   //             },
//   //             '$$REMOVE'
//   //           ]
//   //         }
//   //       },

//   //       freelanceTechnicians: {
//   //         $push: {
//   //           $cond: [
//   //             { $eq: ['$_id.technicianType', 'freelance'] },
//   //             {
//   //               technicianId: '$_id.technicianId',
//   //               technicianName: '$_id.technicianName',
//   //               technicianType: '$_id.technicianType',
//   //               ticketCount: '$ticketCountForTech',
//   //               totalCustomerCharges: '$totalCustomerChargesForTech',
//   //               totalTechCharges: '$totalTechChargesForTech',
//   //               margin: '$perTechFreelanceMargin',
//   //               marginPerVehicle: '$marginPerVehicleFreelance',
//   //               vehicleCount: '$vehicleCountForTech',
//   //               daysWorked: '$ticketDaysCount',
//   //               ticketIds: '$ticketIds',
//   //               ticketSKUs: '$ticketSKUs'
//   //             },
//   //             '$$REMOVE'
//   //           ]
//   //         }
//   //       },

//   //       payrollTotalCustomerCharges: { $sum: { $cond: [ { $eq: ['$_id.technicianType', 'payroll'] }, '$totalCustomerChargesForTech', 0 ] } },
//   //       payrollTotalActualSalaries: { $sum: { $cond: [ { $eq: ['$_id.technicianType', 'payroll'] }, '$monthSalaryForPayroll', 0 ] } },
//   //       payrollDeclaredSalaries: { $sum: { $cond: [ { $eq: ['$_id.technicianType', 'payroll'] }, '$_id.technicianSalary', 0 ] } },

//   //       payrollTicketCount: { $sum: { $cond: [ { $eq: ['$_id.technicianType', 'payroll'] }, '$ticketCountForTech', 0 ] } },

//   //       freelanceTotalCustomerCharges: { $sum: { $cond: [ { $eq: ['$_id.technicianType', 'freelance'] }, '$totalCustomerChargesForTech', 0 ] } },
//   //       freelanceTotalTechCharges: { $sum: { $cond: [ { $eq: ['$_id.technicianType', 'freelance'] }, '$totalTechChargesForTech', 0 ] } },

//   //       totalTicketsInMonth: { $sum: '$ticketCountForTech' },
//   //       totalCustomerChargesAll: { $sum: '$totalCustomerChargesForTech' },

//   //       totalVehiclesInMonth: { $sum: '$vehicleCountForTech' }
//   //     }
//   //   },

//   //   {
//   //     $addFields: {
//   //       payrollMargin: { $subtract: ['$payrollTotalCustomerCharges', '$payrollTotalActualSalaries'] },
//   //       freelanceMargin: { $subtract: ['$freelanceTotalCustomerCharges', '$freelanceTotalTechCharges'] }
//   //     }
//   //   },

//   //   { $sort: { '_id.year': 1, '_id.month': 1 } },

//   //   {
//   //     $project: {
//   //       financialMonthKey: '$_id.financialMonthKey',
//   //       financialYearLabel: '$_id.financialYearLabel',
//   //       year: '$_id.year',
//   //       month: '$_id.month',
//   //       monthName: '$_id.monthName',

//   //       payrollTicketCount: 1,
//   //       payrollTotalCustomerCharges: 1,
//   //       payrollDeclaredSalaries: 1,
//   //       payrollTotalActualSalaries: 1,
//   //       payrollMargin: 1,
//   //       payrollTechnicians: 1,

//   //       freelanceTotalCustomerCharges: 1,
//   //       freelanceTotalTechCharges: 1,
//   //       freelanceMargin: 1,
//   //       freelanceTechnicians: 1,

//   //       totalTicketsInMonth: 1,
//   //       totalCustomerChargesAll: 1,
//   //       totalVehiclesInMonth: 1
//   //     }
//   //   }
//   // ];

//   // Run aggregation



//   // const monthly = await Ticket.aggregate(pipeline).allowDiskUse(true);



//   // Node.js / Mongoose: Ticket is your model

// //   const pipeline = [

// //   // 1) filter tickets (same baseMatch you already use)
// //   { $match: baseMatch },

// //   // 2) compute ticket-level fields (vehicle count, month/year, safe charges)
// //   {
// //     $addFields: {
// //       ticketDate: "$ticketAvailabilityDate",
// //       month: { $month: "$ticketAvailabilityDate" },
// //       year: { $year: "$ticketAvailabilityDate" },
// //       ticketDay: { $dateToString: { format: "%Y-%m-%d", date: "$ticketAvailabilityDate" } },

// //       // Correct vehicle count logic:
// //       // - if vehicleNumbers is array -> size(vehicleNumbers)
// //       // - else if noOfVehicles present -> use it
// //       // - else fallback to 1
// //       ticketVehicleCount: {
// //         $cond: [
// //           { $isArray: "$vehicleNumbers" },
// //           { $size: "$vehicleNumbers" },
// //           { $ifNull: ["$noOfVehicles", 1] }
// //         ]
// //       },

// //       totalCustomerChargesSafe: { $ifNull: ["$totalCustomerCharges", 0] },
// //       totalTechChargesSafe: { $ifNull: ["$totalTechCharges", 0] },

// //       // keep original arrays for later if needed
// //       vehicleNumbers: "$vehicleNumbers",
// //       noOfVehicles: "$noOfVehicles"
// //     }
// //   },

// //   // 3) lookup technician to get their type (payroll / freelance) and salary
// //   {
// //     $lookup: {
// //       from: "technicians",
// //       localField: "technician",
// //       foreignField: "_id",
// //       as: "technicianDoc"
// //     }
// //   },
// //   { $unwind: { path: "$technicianDoc", preserveNullAndEmptyArrays: false } },

// //   // 4) build financial keys & month name
// //   {
// //     $addFields: {
// //       fyStartYear: {
// //         $cond: [{ $gte: ["$month", 4] }, "$year", { $subtract: ["$year", 1] }]
// //       },
// //       monthName: {
// //         $arrayElemAt: [
// //           [ null, "January","February","March","April","May","June","July","August","September","October","November","December" ],
// //           "$month"
// //         ]
// //       }
// //     }
// //   },
// //   {
// //     $addFields: {
// //       financialMonthKey: {
// //         $concat: [
// //           { $toString: "$year" }, "-",
// //           { $cond: [ { $lt: ["$month", 10] }, { $concat: ["0", { $toString: "$month" }] }, { $toString: "$month" } ] }
// //         ]
// //       },
// //       financialYearLabel: {
// //         $concat: [
// //           { $toString: "$fyStartYear" }, "-", { $toString: { $add: ["$fyStartYear", 1] } }
// //         ]
// //       },
// //       technicianType: "$technicianDoc.technicianCategoryType",
// //       technicianSalary: "$technicianDoc.salary",
// //       technicianId: "$technicianDoc._id",
// //       technicianName: "$technicianDoc.name"
// //     }
// //   },

// //   // 5) GROUP #1: aggregate per (month, technicianType) — this ensures each ticket counted once
// //   {
// //     $group: {
// //       _id: {
// //         financialMonthKey: "$financialMonthKey",
// //         financialYearLabel: "$financialYearLabel",
// //         year: "$year",
// //         month: "$month",
// //         monthName: "$monthName",
// //         technicianType: "$technicianType"
// //       },

// //       // counts/totals for this month+techType
// //       ticketCount: { $sum: 1 },
// //       vehicleCount: { $sum: "$ticketVehicleCount" },
// //       totalCustomerCharges: { $sum: "$totalCustomerChargesSafe" },
// //       totalTechCharges: { $sum: "$totalTechChargesSafe" },

// //       // optional: collect ticket ids for uniqueness checks later
// //       ticketIds: { $addToSet: "$_id" }
// //     }
// //   },

// //   // 6) GROUP #2: collapse to per-month doc and split payroll vs freelance totals
// //   {
// //     $group: {
// //       _id: {
// //         financialMonthKey: "$_id.financialMonthKey",
// //         financialYearLabel: "$_id.financialYearLabel",
// //         year: "$_id.year",
// //         month: "$_id.month",
// //         monthName: "$_id.monthName"
// //       },

// //       // payroll aggregates
// //       payrollTicketCount: {
// //         $sum: {
// //           $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, "$ticketCount", 0]
// //         }
// //       },
// //       payrollVehicleCount: {
// //         $sum: {
// //           $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, "$vehicleCount", 0]
// //         }
// //       },
// //       payrollTotalCustomerCharges: {
// //         $sum: {
// //           $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, "$totalCustomerCharges", 0]
// //         }
// //       },
// //       payrollTotalTechCharges: {
// //         $sum: {
// //           $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, "$totalTechCharges", 0]
// //         }
// //       },

// //       // freelance aggregates
// //       freelanceTicketCount: {
// //         $sum: {
// //           $cond: [{ $eq: ["$_id.technicianType", "freelance"] }, "$ticketCount", 0]
// //         }
// //       },
// //       freelanceVehicleCount: {
// //         $sum: {
// //           $cond: [{ $eq: ["$_id.technicianType", "freelance"] }, "$vehicleCount", 0]
// //         }
// //       },
// //       freelanceTotalCustomerCharges: {
// //         $sum: {
// //           $cond: [{ $eq: ["$_id.technicianType", "freelance"] }, "$totalCustomerCharges", 0]
// //         }
// //       },
// //       freelanceTotalTechCharges: {
// //         $sum: {
// //           $cond: [{ $eq: ["$_id.technicianType", "freelance"] }, "$totalTechCharges", 0]
// //         }
// //       },

// //       // totals across both types
// //       totalTicketsInMonth: { $sum: "$ticketCount" },
// //       totalVehiclesInMonth: { $sum: "$vehicleCount" },
// //       totalCustomerChargesAll: { $sum: "$totalCustomerCharges" },

// //       // optional: combined ticket ids for the month
// //       ticketIds: { $addToSet: "$ticketIds" }
// //     }
// //   },

// //   // 7) flatten ticketIds (addToSet produced an array of arrays)
// //   {
// //     $addFields: {
// //       ticketIds: {
// //         $reduce: {
// //           input: { $ifNull: ["$ticketIds", []] },
// //           initialValue: [],
// //           in: { $setUnion: ["$$value", "$$this"] }
// //         }
// //       }
// //     }
// //   },

// //   // 8) compute margins and format the output fields
// //   {
// //     $addFields: {
// //       payrollMargin: { $subtract: ["$payrollTotalCustomerCharges", "$payrollTotalTechCharges"] }, // if payroll uses techCharges field; replace if payroll salary logic differs
// //       freelanceMargin: { $subtract: ["$freelanceTotalCustomerCharges", "$freelanceTotalTechCharges"] },

// //       financialMonthKey: "$_id.financialMonthKey",
// //       financialYearLabel: "$_id.financialYearLabel",
// //       year: "$_id.year",
// //       month: "$_id.month",
// //       monthName: "$_id.monthName"
// //     }
// //   },

// //   // 9) project final shape
// //   {
// //     $project: {
// //       _id: 0,
// //       financialMonthKey: 1,
// //       financialYearLabel: 1,
// //       year: 1,
// //       month: 1,
// //       monthName: 1,

// //       payrollTicketCount: 1,
// //       payrollVehicleCount: 1,
// //       payrollTotalCustomerCharges: 1,
// //       payrollTotalTechCharges: 1,
// //       payrollMargin: 1,

// //       freelanceTicketCount: 1,
// //       freelanceVehicleCount: 1,
// //       freelanceTotalCustomerCharges: 1,
// //       freelanceTotalTechCharges: 1,
// //       freelanceMargin: 1,

// //       totalTicketsInMonth: 1,
// //       totalVehiclesInMonth: 1,
// //       totalCustomerChargesAll: 1,
// //       ticketIds: 1
// //     }
// //   },

// //   { $sort: { year: 1, month: 1 } }
// // ];

// const pipeline = [

//   // 1) filter tickets
//   { $match: baseMatch },

//   // 2) compute ticket-level fields (vehicle count, month/year, safe charges)
//   {
//     $addFields: {
//       ticketDate: "$ticketAvailabilityDate",
//       month: { $month: "$ticketAvailabilityDate" },
//       year: { $year: "$ticketAvailabilityDate" },
//       ticketDay: { $dateToString: { format: "%Y-%m-%d", date: "$ticketAvailabilityDate" } },

//       // ticket-level vehicle count
//       ticketVehicleCount: {
//         $cond: [
//           { $isArray: "$vehicleNumbers" },
//           { $size: "$vehicleNumbers" },
//           { $ifNull: ["$noOfVehicles", 1] }
//         ]
//       },

//       totalCustomerChargesSafe: { $ifNull: ["$totalCustomerCharges", 0] },
//       totalTechChargesSafe: { $ifNull: ["$totalTechCharges", 0] },

//       // keep arrays for later
//       vehicleNumbers: "$vehicleNumbers",
//       noOfVehicles: "$noOfVehicles"
//     }
//   },

//   // 3) compute monthFirstDay and monthDaysCount (days in that month)
//     {
//       $addFields: {
//         monthFirstDay: { $dateFromParts: { year: "$year", month: "$month", day: 1 } }
//       }
//     },
//     {
//       $addFields: {
//         monthDaysCount: {
//           $dayOfMonth: {
//             $dateSubtract: {
//               startDate: { $dateAdd: { startDate: "$monthFirstDay", unit: "month", amount: 1 } },
//               unit: "day",
//               amount: 1
//             }
//           }
//         }
//       }
//     },

//   // 3) lookup technician
//   {
//     $lookup: {
//       from: "technicians",
//       localField: "technician",
//       foreignField: "_id",
//       as: "technicianDoc"
//     }
//   },
//   { $unwind: { path: "$technicianDoc", preserveNullAndEmptyArrays: false } },

//   // 4) financial keys & technician info
//   {
//     $addFields: {
//       fyStartYear: {
//         $cond: [{ $gte: ["$month", 4] }, "$year", { $subtract: ["$year", 1] }]
//       },
//       monthName: {
//         $arrayElemAt: [
//           [ null, "January","February","March","April","May","June","July","August","September","October","November","December" ],
//           "$month"
//         ]
//       },
//       financialMonthKey: {
//         $concat: [
//           { $toString: "$year" }, "-",
//           { $cond: [ { $lt: ["$month", 10] }, { $concat: ["0", { $toString: "$month" }] }, { $toString: "$month" } ] }
//         ]
//       },
//       financialYearLabel: {
//         $concat: [
//           { $toString: "$fyStartYear" }, "-", { $toString: { $add: ["$fyStartYear", 1] } }
//         ]
//       },
//       technicianType: "$technicianDoc.technicianCategoryType",
//       technicianId: "$technicianDoc._id",
//       technicianName: "$technicianDoc.name"
//     }
//   },

//   // 5) GROUP #1: aggregate per (month, technicianType), collect ticket-level info per tech-type
//   {
//     $group: {
//       _id: {
//         financialMonthKey: "$financialMonthKey",
//         financialYearLabel: "$financialYearLabel",
//         year: "$year",
//         month: "$month",
//         monthName: "$monthName",
//         technicianType: "$technicianType"
//       },

//       // month+techType totals
//       ticketCount: { $sum: 1 },
//       vehicleCount: { $sum: "$ticketVehicleCount" },
//       totalCustomerCharges: { $sum: "$totalCustomerChargesSafe" },
//       totalTechCharges: { $sum: "$totalTechChargesSafe" },

//       // dedup ticket ids for safety
//       ticketIds: { $addToSet: "$_id" },

//       // push ticket-level details for this tech-type
//       tickets: {
//         $push: {
//           ticketId: "$_id",
//           vehicleCount: "$ticketVehicleCount",
//           vehicleNumbers: { $ifNull: ["$vehicleNumbers", []] },
//           technicianId: "$technicianId",
//           totalCustomerCharges: "$totalCustomerChargesSafe",
//           ticketDay: "$ticketDay"
//         }
//       }
//     }
//   },

//   // 6) GROUP #2: roll-up to per-month doc and split payroll vs freelance, concatenate ticket arrays
//   {
//     $group: {
//       _id: {
//         financialMonthKey: "$_id.financialMonthKey",
//         financialYearLabel: "$_id.financialYearLabel",
//         year: "$_id.year",
//         month: "$_id.month",
//         monthName: "$_id.monthName"
//       },

//       // payroll aggregates
//       payrollTicketCount: {
//         $sum: { $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, "$ticketCount", 0] }
//       },
//       payrollVehicleCount: {
//         $sum: { $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, "$vehicleCount", 0] }
//       },
//       payrollTotalCustomerCharges: {
//         $sum: { $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, "$totalCustomerCharges", 0] }
//       },
//       payrollTotalTechCharges: {
//         $sum: { $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, "$totalTechCharges", 0] }
//       },

//       // freelance aggregates
//       freelanceTicketCount: {
//         $sum: { $cond: [{ $eq: ["$_id.technicianType", "freelance"] }, "$ticketCount", 0] }
//       },
//       freelanceVehicleCount: {
//         $sum: { $cond: [{ $eq: ["$_id.technicianType", "freelance"] }, "$vehicleCount", 0] }
//       },
//       freelanceTotalCustomerCharges: {
//         $sum: { $cond: [{ $eq: ["$_id.technicianType", "freelance"] }, "$totalCustomerCharges", 0] }
//       },
//       freelanceTotalTechCharges: {
//         $sum: { $cond: [{ $eq: ["$_id.technicianType", "freelance"] }, "$totalTechCharges", 0] }
//       },

//       // totals across both types
//       totalTicketsInMonth: { $sum: "$ticketCount" },
//       totalVehiclesInMonth: { $sum: "$vehicleCount" },
//       totalCustomerChargesAll: { $sum: "$totalCustomerCharges" },

//       // combine ticket arrays per month, separated by tech type
//       payrollTickets: {
//         $push: {
//           $cond: [
//             { $eq: ["$_id.technicianType", "payroll"] },
//             "$tickets",
//             []
//           ]
//         }
//       },
//       freelanceTickets: {
//         $push: {
//           $cond: [
//             { $eq: ["$_id.technicianType", "freelance"] },
//             "$tickets",
//             []
//           ]
//         }
//       },

//       ticketIdsNested: { $addToSet: "$ticketIds" }
//     }
//   },

//   // 7) flatten payrollTickets & freelanceTickets (they are arrays-of-arrays because of $push)
//   {
//     $addFields: {
//       payrollTickets: {
//         $reduce: {
//           input: { $ifNull: ["$payrollTickets", []] },
//           initialValue: [],
//           in: { $concatArrays: ["$$value", "$$this"] }
//         }
//       },
//       freelanceTickets: {
//         $reduce: {
//           input: { $ifNull: ["$freelanceTickets", []] },
//           initialValue: [],
//           in: { $concatArrays: ["$$value", "$$this"] }
//         }
//       },

//       // flatten ticketIds and dedupe
//       ticketIds: {
//         $reduce: {
//           input: { $ifNull: ["$ticketIdsNested", []] },
//           initialValue: [],
//           in: { $setUnion: ["$$value", "$$this"] }
//         }
//       }
//     }
//   },

//   // 8) optional: compute unique vehicle numbers for the month (dedupe across tickets)
//   {
//     $addFields: {
//       // collect vehicleNumbers arrays from payroll & freelance tickets and flatten
//       vehicleNumbersAll: {
//         $concatArrays: [
//           { $reduce: { input: "$payrollTickets", initialValue: [], in: { $concatArrays: ["$$value", { $ifNull: ["$$this.vehicleNumbers", []] }] } } },
//           { $reduce: { input: "$freelanceTickets", initialValue: [], in: { $concatArrays: ["$$value", { $ifNull: ["$$this.vehicleNumbers", []] }] } } }
//         ]
//       }
//     }
//   },

//   // 9) compute unique vehicle numbers count (if needed) and margins
//   {
//     $addFields: {
//       uniqueVehicleNumbers: { $setUnion: ["$vehicleNumbersAll", []] },
//       payrollMargin: { $subtract: ["$payrollTotalCustomerCharges", "$payrollTotalTechCharges"] },
//       freelanceMargin: { $subtract: ["$freelanceTotalCustomerCharges", "$freelanceTotalTechCharges"] },

//       financialMonthKey: "$_id.financialMonthKey",
//       financialYearLabel: "$_id.financialYearLabel",
//       year: "$_id.year",
//       month: "$_id.month",
//       monthName: "$_id.monthName"
//     }
//   },

//   // 10) final projection
//   {
//     $project: {
//       _id: 0,
//       financialMonthKey: 1,
//       financialYearLabel: 1,
//       year: 1,
//       month: 1,
//       monthName: 1,

//       // payroll summary
//       payrollTicketCount: 1,
//       payrollVehicleCount: 1,
//       payrollTotalCustomerCharges: 1,
//       payrollTotalTechCharges: 1,
//       payrollMargin: 1,
//       payrollTickets: 1, // array of ticket-level objects

//       // freelance summary
//       freelanceTicketCount: 1,
//       freelanceVehicleCount: 1,
//       freelanceTotalCustomerCharges: 1,
//       freelanceTotalTechCharges: 1,
//       freelanceMargin: 1,
//       freelanceTickets: 1, // array of ticket-level objects

//       // totals
//       totalTicketsInMonth: 1,
//       totalVehiclesInMonth: 1,
//       totalCustomerChargesAll: 1,

//       // ticket list & vehicle uniqueness
//       ticketIds: 1,
//       uniqueVehicleNumbersCount: { $size: { $ifNull: ["$uniqueVehicleNumbers", []] } },
//       uniqueVehicleNumbers: 1
//     }
//   },

//   { $sort: { year: 1, month: 1 } }
// ];


// const monthly = await Ticket.aggregate(pipeline).allowDiskUse(true);


//   // ── ADD THIS SNIPPET ───────────────────────────────────────────────────────
//   // ensure each monthly row has convenience totals:
//   // - totalMargin (payroll + freelance)
//   // - totalTickets (alias of totalTicketsInMonth)
//   // - totalVehicles (alias of totalVehiclesInMonth)
//    for (const m of monthly) {
//     const pm = m.payrollMargin || 0;
//     const fm = m.freelanceMargin || 0;
//     m.totalMargin = pm + fm;
//     m.totalTickets = m.totalTicketsInMonth || 0;
//     m.totalVehicles = m.totalVehiclesInMonth || 0;
//   }
//  // If user requested a single month, pick that month row (there should be only rows inside from..to range)
//   // Build per-FY maps but limited to the requested month if provided.
//   let financialYearTotals = {};
//   let financialYearTechnicianTotalsArrays = {};
//   const includedTicketIdsByFYArrays = {};
//   const includedTicketIdsAll = [];

//   if (requestedMonth && requestedFY) {
//     // find the monthly row that matches requested month
//     const row = monthly.find(r => r.financialYearLabel === requestedFY && r.month === requestedMonth) || null;

//     if (row) {
//       // build single-month FY object where totals equal this month's values (not full FY aggregates)
//       financialYearTotals[requestedFY] = {
//         financialYearLabel: requestedFY,
//         payrollTicketCount: row.payrollTicketCount || 0,
//         payrollTotalCustomerCharges: row.payrollTotalCustomerCharges || 0,
//         payrollTotalSalariesDeclared: row.payrollDeclaredSalaries || 0,
//         payrollTotalActualSalaries: row.payrollTotalActualSalaries || 0,
//         payrollMargin: row.payrollMargin || 0,
//         freelanceTotalCustomerCharges: row.freelanceTotalCustomerCharges || 0,
//         freelanceTotalTechCharges: row.freelanceTotalTechCharges || 0,
//         freelanceMargin: row.freelanceMargin || 0,
//         totalCustomerChargesAll: row.totalCustomerChargesAll || 0,
//         // totalPayrollMargin: row.payrollMargin || 0,
//         // totalFreelanceMargin: row.freelanceMargin || 0,
//         // totalMargin: (row.payrollMargin || 0) + (row.freelanceMargin || 0),
//         // totalTickets: row.totalTicketsInMonth || 0,
//         // totalVehicles: row.totalVehiclesInMonth || 0,

//         // <-- exact fields you asked for:
//         totalPayrollMargin: row.payrollMargin || 0,
//         totalFreelanceMargin: row.freelanceMargin || 0,
//         totalMargin: row.totalMargin || ((row.payrollMargin || 0) + (row.freelanceMargin || 0)),
//         totalTickets: row.totalTickets || row.totalTicketsInMonth || 0,
//         totalVehicles: row.totalVehicles || row.totalVehiclesInMonth || 0,

//         months: [ row ] // single month array
//       };

//       // build per-tech totals for that month (just take payrollTechnicians and freelanceTechnicians arrays and convert)
//       const perTechMap = {};
//       const pushTech = (tech, isPayroll) => {
//         if (!tech) return;
//         const id = String(tech.technicianId);
//         if (!perTechMap[id]) {
//           perTechMap[id] = {
//             technicianId: tech.technicianId,
//             technicianName: tech.technicianName,
//             technicianType: tech.technicianType,
//             ticketCount: 0,
//             totalCustomerCharges: 0,
//             totalTechCharges: 0,
//             totalDeclaredSalaries: 0,
//             totalActualSalaries: 0,
//             margin: 0,
//             vehicleCount: 0,
//             daysWorked: 0,
//             ticketIds: [],
//             ticketSKUs: []
//           };
//         }
//         perTechMap[id].ticketCount += tech.ticketCount || 0;
//         perTechMap[id].totalCustomerCharges += tech.totalCustomerCharges || 0;
//         perTechMap[id].totalTechCharges += tech.totalTechCharges || 0;
//         perTechMap[id].vehicleCount += tech.vehicleCount || 0;
//         perTechMap[id].daysWorked += tech.daysWorked || 0;

//         if (isPayroll) {
//           perTechMap[id].totalDeclaredSalaries += tech.salary || 0;
//           perTechMap[id].totalActualSalaries += tech.actualSalary || 0;
//           perTechMap[id].margin += (tech.margin || 0);
//         } else {
//           perTechMap[id].margin += (tech.margin || 0);
//         }

//         if (Array.isArray(tech.ticketIds)) perTechMap[id].ticketIds.push(...tech.ticketIds.map(String));
//         if (Array.isArray(tech.ticketSKUs)) perTechMap[id].ticketSKUs.push(...tech.ticketSKUs);
//       };

//       for (const p of (row.payrollTechnicians || [])) pushTech(p, true);
//       for (const f of (row.freelanceTechnicians || [])) pushTech(f, false);

//       // convert to array and dedupe ticket lists & compute marginPerVehicle
//       financialYearTechnicianTotalsArrays[requestedFY] = Object.values(perTechMap).map(t => {
//         t.ticketIds = Array.from(new Set(t.ticketIds));
//         t.ticketSKUs = Array.from(new Set(t.ticketSKUs));
//         t.marginPerVehicle = (t.vehicleCount > 0) ? (t.margin / t.vehicleCount) : 0;
//         return t;
//       });

//       // included ticket ids
//       const includedSet = new Set();
//       for (const t of financialYearTechnicianTotalsArrays[requestedFY]) {
//         (t.ticketIds || []).forEach(id => includedSet.add(String(id)));
//       }
//       includedTicketIdsByFYArrays[requestedFY] = Array.from(includedSet);
//       includedTicketIdsAll.push(...includedTicketIdsByFYArrays[requestedFY]);
//     } else {
//       // no row found -> return an empty selection for requestedFY
//       financialYearTotals[requestedFY] = {
//         financialYearLabel: requestedFY,
//         payrollTicketCount: 0,
//         payrollTotalCustomerCharges: 0,
//         payrollTotalSalariesDeclared: 0,
//         payrollTotalActualSalaries: 0,
//         payrollMargin: 0,
//         freelanceTotalCustomerCharges: 0,
//         freelanceTotalTechCharges: 0,
//         freelanceMargin: 0,
//         totalCustomerChargesAll: 0,
//         totalPayrollMargin: 0,
//         totalFreelanceMargin: 0,
//         totalMargin: 0,
//         totalTickets: 0,
//         totalVehicles: 0,
//         months: []
//       };
//       financialYearTechnicianTotalsArrays[requestedFY] = [];
//       includedTicketIdsByFYArrays[requestedFY] = [];
//     }
//   } else {
//     // If no requestedMonth specified, preserve older behaviour: build full FY aggregates across returned months array
//     // (Your existing aggregation -> building full-year totals code can be placed here. For brevity, I'm returning monthly as-is.)
//     // If you want full FY totals implemented, re-use your original FY-aggregation code here.
//     // For now: just populate includedTicketIds from monthly rows
//     for (const m of monthly) {
//       const fy = m.financialYearLabel || 'unknown';
//       if (!includedTicketIdsByFYArrays[fy]) includedTicketIdsByFYArrays[fy] = [];
//       const pushIdsFromTech = tech => {
//         if (!tech || !Array.isArray(tech.ticketIds)) return;
//         for (const id of tech.ticketIds) includedTicketIdsByFYArrays[fy].push(String(id));
//       };
//       if (Array.isArray(m.payrollTechnicians)) for (const t of m.payrollTechnicians) pushIdsFromTech(t);
//       if (Array.isArray(m.freelanceTechnicians)) for (const t of m.freelanceTechnicians) pushIdsFromTech(t);
//     }
//     for (const k of Object.keys(includedTicketIdsByFYArrays)) {
//       includedTicketIdsByFYArrays[k] = Array.from(new Set(includedTicketIdsByFYArrays[k]));
//       includedTicketIdsAll.push(...includedTicketIdsByFYArrays[k]);
//     }
//   }

//   return {
//     monthly,
//     financialYearTotals,
//     financialYearTechnicianTotals: financialYearTechnicianTotalsArrays,
//     includedTicketIds: Array.from(new Set(includedTicketIdsAll)),
//     includedTicketIdsByFY: includedTicketIdsByFYArrays
//   };


// }

//--------------------------------------------------------------------

// async function getTechnicianMargins({ from = null, to = null, month = null, financialYearLabel = null } = {}) {
//   // If month + financialYearLabel provided, convert to from/to for that month (you can reuse your helper getFinancialMonthRange)
//   if (month != null && financialYearLabel != null) {
//     const r = getFinancialMonthRange(month, financialYearLabel);
//     from = r.from;
//     to = r.to;
//   }

//   const baseMatch = {
//     isTicketClosed: true,
//     ticketStatus: "work done",
//     technician: { $ne: null }
//   };

//   if (from || to) {
//     baseMatch.ticketAvailabilityDate = {};
//     if (from) baseMatch.ticketAvailabilityDate.$gte = from;
//     if (to) baseMatch.ticketAvailabilityDate.$lt = to;
//   } else {
//     baseMatch.ticketAvailabilityDate = { $ne: null };
//   }

//   const pipeline = [
//     // 1) filter tickets in date range
//     { $match: baseMatch },

//     // 2) compute ticket-level safe fields and month/year
//     {
//       $addFields: {
//         ticketDate: "$ticketAvailabilityDate",
//         month: { $month: "$ticketAvailabilityDate" },
//         year: { $year: "$ticketAvailabilityDate" },
//         ticketDay: { $dateToString: { format: "%Y-%m-%d", date: "$ticketAvailabilityDate" } },

//         // ticket-level vehicle count: array of vehicleNumbers or noOfVehicles or fallback 1
//         ticketVehicleCount: {
//           $cond: [
//             { $isArray: "$vehicleNumbers" },
//             { $size: "$vehicleNumbers" },
//             { $ifNull: ["$noOfVehicles", 1] }
//           ]
//         },

//         totalCustomerChargesSafe: { $ifNull: ["$totalCustomerCharges", 0] },
//         totalTechChargesSafe: { $ifNull: ["$totalTechCharges", 0] },

//         vehicleNumbers: "$vehicleNumbers",
//         noOfVehicles: "$noOfVehicles"
//       }
//     },

//     // 3) compute monthFirstDay and monthDaysCount (days in that month)
//     {
//       $addFields: {
//         monthFirstDay: { $dateFromParts: { year: "$year", month: "$month", day: 1 } }
//       }
//     },
//     {
//       $addFields: {
//         monthDaysCount: {
//           $dayOfMonth: {
//             $dateSubtract: {
//               startDate: { $dateAdd: { startDate: "$monthFirstDay", unit: "month", amount: 1 } },
//               unit: "day",
//               amount: 1
//             }
//           }
//         }
//       }
//     },

//     // 4) lookup technician document to know technicianType and salary (declared)
//     {
//       $lookup: {
//         from: "technicians",
//         localField: "technician",
//         foreignField: "_id",
//         as: "technicianDoc"
//       }
//     },
//     { $unwind: { path: "$technicianDoc", preserveNullAndEmptyArrays: false } },

//     // 5) build financial keys & carry technician info
//     {
//       $addFields: {
//         fyStartYear: { $cond: [{ $gte: ["$month", 4] }, "$year", { $subtract: ["$year", 1] }] },
//         monthName: {
//           $arrayElemAt: [
//             [ null, "January","February","March","April","May","June","July","August","September","October","November","December" ],
//             "$month"
//           ]
//         },
//         financialMonthKey: {
//           $concat: [
//             { $toString: "$year" }, "-",
//             { $cond: [ { $lt: ["$month", 10] }, { $concat: ["0", { $toString: "$month" }] }, { $toString: "$month" } ] }
//           ]
//         },
//         financialYearLabel: {
//           $concat: [
//             { $toString: "$fyStartYear" }, "-", { $toString: { $add: ["$fyStartYear", 1] } }
//           ]
//         },

//         technicianType: "$technicianDoc.technicianCategoryType",
//         technicianId: "$technicianDoc._id",
//         technicianName: "$technicianDoc.name",
//         technicianDeclaredSalary: { $ifNull: ["$technicianDoc.salary", 0] } // keep declared salary if needed
//       }
//     },

//     // 6) GROUP #1: aggregate per (month, technician) to preserve per-tech values
//     {
//       $group: {
//         _id: {
//           financialMonthKey: "$financialMonthKey",
//           financialYearLabel: "$financialYearLabel",
//           year: "$year",
//           month: "$month",
//           monthName: "$monthName",
//           technicianId: "$technicianId",
//           technicianName: "$technicianName",
//           technicianType: "$technicianType"
//         },

//         ticketCountForTech: { $sum: 1 },
//         vehicleCountForTech: { $sum: "$ticketVehicleCount" },
//         totalCustomerChargesForTech: { $sum: "$totalCustomerChargesSafe" },
//         totalTechChargesForTech: { $sum: "$totalTechChargesSafe" },

//         ticketDaysSet: { $addToSet: "$ticketDay" },
//         ticketIds: { $addToSet: "$_id" },

//         // carry monthDaysCount (same for this month) and declared salary (if you want to keep original salary)
//         monthDaysCount: { $first: "$monthDaysCount" },
//         technicianDeclaredSalary: { $first: "$technicianDeclaredSalary" }
//       }
//     },

//     // 7) compute per-technician declaredSalary (fixed per-day 1000 * monthDaysCount)
//     {
//       $addFields: {
//         ticketDaysCount: { $size: { $ifNull: ["$ticketDaysSet", []] } },
//         declaredSalaryForTech: { $multiply: [{ $ifNull: ["$monthDaysCount", 0] }, 1000] } // fixed per-day = 1000
//       }
//     },

//     // 8) GROUP #2: roll-up to per-month and sum payrollDeclaredSalaries for payroll techs
//     {
//       $group: {
//         _id: {
//           financialMonthKey: "$_id.financialMonthKey",
//           financialYearLabel: "$_id.financialYearLabel",
//           year: "$_id.year",
//           month: "$_id.month",
//           monthName: "$_id.monthName"
//         },

//         // payroll aggregates (conditional sums)
//         payrollTicketCount: {
//           $sum: { $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, "$ticketCountForTech", 0] }
//         },
//         payrollVehicleCount: {
//           $sum: { $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, "$vehicleCountForTech", 0] }
//         },
//         payrollTotalCustomerCharges: {
//           $sum: { $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, "$totalCustomerChargesForTech", 0] }
//         },

//         // THIS is the field you required: declared salaries = monthDaysCount * 1000 summed per payroll technician
//         payrollDeclaredSalaries: {
//           $sum: {
//             $cond: [
//               { $eq: ["$_id.technicianType", "payroll"] },
//               { $ifNull: ["$declaredSalaryForTech", 0] },
//               0
//             ]
//           }
//         },

//         // (optional) if you still want to keep payrollTotalTechCharges etc.
//         payrollTotalTechCharges: {
//           $sum: { $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, "$totalTechChargesForTech", 0] }
//         },

//         // freelance aggregates
//         freelanceTicketCount: {
//           $sum: { $cond: [{ $eq: ["$_id.technicianType", "freelance"] }, "$ticketCountForTech", 0] }
//         },
//         freelanceVehicleCount: {
//           $sum: { $cond: [{ $eq: ["$_id.technicianType", "freelance"] }, "$vehicleCountForTech", 0] }
//         },
//         freelanceTotalCustomerCharges: {
//           $sum: { $cond: [{ $eq: ["$_id.technicianType", "freelance"] }, "$totalCustomerChargesForTech", 0] }
//         },
//         freelanceTotalTechCharges: {
//           $sum: { $cond: [{ $eq: ["$_id.technicianType", "freelance"] }, "$totalTechChargesForTech", 0] }
//         },

//         // totals across types
//         totalTicketsInMonth: { $sum: "$ticketCountForTech" },
//         totalVehiclesInMonth: { $sum: "$vehicleCountForTech" },
//         totalCustomerChargesAll: { $sum: "$totalCustomerChargesForTech" },

//         // combine ticketIds arrays
//         ticketIdsNested: { $addToSet: "$ticketIds" },

//         // optionally push arrays of per-tech rows
//         payrollTechRows: {
//           $push: {
//             $cond: [
//               { $eq: ["$_id.technicianType", "payroll"] },
//               {
//                 technicianId: "$_id.technicianId",
//                 technicianName: "$_id.technicianName",
//                 ticketCountForTech: "$ticketCountForTech",
//                 declaredSalaryForTech: "$declaredSalaryForTech",
//                 totalCustomerChargesForTech: "$totalCustomerChargesForTech"
//               },
//               "$$REMOVE"
//             ]
//           }
//         },
//         freelanceTechRows: {
//           $push: {
//             $cond: [
//               { $eq: ["$_id.technicianType", "freelance"] },
//               {
//                 technicianId: "$_id.technicianId",
//                 technicianName: "$_id.technicianName",
//                 ticketCountForTech: "$ticketCountForTech",
//                 totalCustomerChargesForTech: "$totalCustomerChargesForTech",
//                 totalTechChargesForTech: "$totalTechChargesForTech"
//               },
//               "$$REMOVE"
//             ]
//           }
//         }
//       }
//     },

//     // 9) flatten ticketIds and compute margins (use payrollDeclaredSalaries)
//     {
//       $addFields: {
//         ticketIds: {
//           $reduce: {
//             input: { $ifNull: ["$ticketIdsNested", []] },
//             initialValue: [],
//             in: { $setUnion: ["$$value", "$$this"] }
//           }
//         },
//         payrollMargin: { $subtract: ["$payrollTotalCustomerCharges", "$payrollDeclaredSalaries"] },
//         freelanceMargin: { $subtract: ["$freelanceTotalCustomerCharges", "$freelanceTotalTechCharges"] }
//       }
//     },

//     // 10) final projection
//     {
//       $project: {
//         _id: 0,
//         financialMonthKey: "$_id.financialMonthKey",
//         financialYearLabel: "$_id.financialYearLabel",
//         year: "$_id.year",
//         month: "$_id.month",
//         monthName: "$_id.monthName",

//         // payroll
//         payrollTicketCount: 1,
//         payrollVehicleCount: 1,
//         payrollTotalCustomerCharges: 1,
//         payrollTotalTechCharges: 1,
//         payrollDeclaredSalaries: 1,      // <--- declared fixed monthly cost (monthDaysCount * 1000 per tech summed)
//         payrollMargin: 1,
//         payrollTechRows: 1,

//         // freelance
//         freelanceTicketCount: 1,
//         freelanceVehicleCount: 1,
//         freelanceTotalCustomerCharges: 1,
//         freelanceTotalTechCharges: 1,
//         freelanceMargin: 1,
//         freelanceTechRows: 1,

//         // totals
//         totalTicketsInMonth: 1,
//         totalVehiclesInMonth: 1,
//         totalCustomerChargesAll: 1,
//         ticketIds: 1
//       }
//     },

//     { $sort: { year: 1, month: 1 } }
//   ];

//   // run aggregation (Ticket is the mongoose model)
//   const monthly = await Ticket.aggregate(pipeline).allowDiskUse(true);

//   // add convenience totals (totalMargin, totalTickets, totalVehicles)
//   for (const m of monthly) {
//     m.totalMargin = (m.payrollMargin || 0) + (m.freelanceMargin || 0);
//     m.totalTickets = m.totalTicketsInMonth || 0;
//     m.totalVehicles = m.totalVehiclesInMonth || 0;
//   }

//   return { monthly };
// }

// /------------------------------------------------------------------
async function getTechnicianMargins({ from = null, to = null, month = null, financialYearLabel = null } = {}) {
  // If month + financialYearLabel provided, convert to from/to
  if (month != null && financialYearLabel != null) {
    const r = getFinancialMonthRange(month, financialYearLabel);
    from = r.from;
    to = r.to;
  }

  const baseMatch = {
    isTicketClosed: true,
    ticketStatus: "work done",
    technician: { $ne: null }
  };

  if (from || to) {
    baseMatch.ticketAvailabilityDate = {};
    if (from) baseMatch.ticketAvailabilityDate.$gte = from;
    if (to) baseMatch.ticketAvailabilityDate.$lt = to;
  } else {
    baseMatch.ticketAvailabilityDate = { $ne: null };
  }

  const pipeline = [
    // 1) filter tickets
    { $match: baseMatch },

    // 2) compute safe fields
    {
      $addFields: {
        ticketDate: "$ticketAvailabilityDate",
        month: { $month: "$ticketAvailabilityDate" },
        year: { $year: "$ticketAvailabilityDate" },
        ticketDay: { $dateToString: { format: "%Y-%m-%d", date: "$ticketAvailabilityDate" } },

        ticketVehicleCount: {
          $cond: [
            { $isArray: "$vehicleNumbers" },
            { $size: "$vehicleNumbers" },
            { $ifNull: ["$noOfVehicles", 1] }
          ]
        },

        totalCustomerChargesSafe: { $ifNull: ["$totalCustomerCharges", 0] },
        totalTechChargesSafe: { $ifNull: ["$totalTechCharges", 0] }
      }
    },

    // 3) compute month first day and month days count
    {
      $addFields: {
        monthFirstDay: { $dateFromParts: { year: "$year", month: "$month", day: 1 } }
      }
    },
    {
      $addFields: {
        monthDaysCount: {
          $dayOfMonth: {
            $dateSubtract: {
              startDate: { $dateAdd: { startDate: "$monthFirstDay", unit: "month", amount: 1 } },
              unit: "day",
              amount: 1
            }
          }
        }
      }
    },

    // 4) lookup technician
    {
      $lookup: {
        from: "technicians",
        localField: "technician",
        foreignField: "_id",
        as: "technicianDoc"
      }
    },
    { $unwind: { path: "$technicianDoc", preserveNullAndEmptyArrays: false } },

    // 5) build financial keys
    {
      $addFields: {
        fyStartYear: { $cond: [{ $gte: ["$month", 4] }, "$year", { $subtract: ["$year", 1] }] },
        monthName: {
          $arrayElemAt: [
            [
              null,
              "January", "February", "March", "April", "May", "June",
              "July", "August", "September", "October", "November", "December"
            ],
            "$month"
          ]
        },
        financialMonthKey: {
          $concat: [
            { $toString: "$year" }, "-",
            { $cond: [{ $lt: ["$month", 10] }, { $concat: ["0", { $toString: "$month" }] }, { $toString: "$month" }] }
          ]
        },
        financialYearLabel: {
          $concat: [
            { $toString: "$fyStartYear" }, "-", { $toString: { $add: ["$fyStartYear", 1] } }
          ]
        },

        technicianType: "$technicianDoc.technicianCategoryType",
        technicianId: "$technicianDoc._id",
        technicianName: "$technicianDoc.name",
        technicianDeclaredSalary: { $ifNull: ["$technicianDoc.salary", 0] }
      }
    },

    // 6) group per (month, technician)
    {
      $group: {
        _id: {
          financialMonthKey: "$financialMonthKey",
          financialYearLabel: "$financialYearLabel",
          year: "$year",
          month: "$month",
          monthName: "$monthName",
          technicianId: "$technicianId",
          technicianName: "$technicianName",
          technicianType: "$technicianType"
        },

        ticketCountForTech: { $sum: 1 },
        vehicleCountForTech: { $sum: "$ticketVehicleCount" },
        totalCustomerChargesForTech: { $sum: "$totalCustomerChargesSafe" },
        totalTechChargesForTech: { $sum: "$totalTechChargesSafe" },

        ticketDaysSet: { $addToSet: "$ticketDay" },
        ticketIds: { $addToSet: "$_id" },

        monthDaysCount: { $first: "$monthDaysCount" },
        technicianDeclaredSalary: { $first: "$technicianDeclaredSalary" }
      }
    },

    // 7) compute declaredSalaryForTech
    {
      $addFields: {
        ticketDaysCount: { $size: { $ifNull: ["$ticketDaysSet", []] } },
        declaredSalaryForTech: { $multiply: [{ $ifNull: ["$monthDaysCount", 0] }, 1000] } // fixed daily 1000
      }
    },

    // 8) group per month across technicians
    {
      $group: {
        _id: {
          financialMonthKey: "$_id.financialMonthKey",
          financialYearLabel: "$_id.financialYearLabel",
          year: "$_id.year",
          month: "$_id.month",
          monthName: "$_id.monthName"
        },

        payrollTicketCount: {
          $sum: { $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, "$ticketCountForTech", 0] }
        },
        payrollVehicleCount: {
          $sum: { $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, "$vehicleCountForTech", 0] }
        },
        payrollTotalCustomerCharges: {
          $sum: { $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, "$totalCustomerChargesForTech", 0] }
        },
        payrollDeclaredSalaries: {
          $sum: {
            $cond: [
              { $eq: ["$_id.technicianType", "payroll"] },
              { $ifNull: ["$declaredSalaryForTech", 0] },
              0
            ]
          }
        },
        payrollTotalTechCharges: {
          $sum: { $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, "$totalTechChargesForTech", 0] }
        },

        // 👉 new: number of payroll technicians in this month
        payrollTechnicianCount: {
          $sum: { $cond: [{ $eq: ["$_id.technicianType", "payroll"] }, 1, 0] }
        },

        freelanceTicketCount: {
          $sum: { $cond: [{ $eq: ["$_id.technicianType", "freelance"] }, "$ticketCountForTech", 0] }
        },
        freelanceVehicleCount: {
          $sum: { $cond: [{ $eq: ["$_id.technicianType", "freelance"] }, "$vehicleCountForTech", 0] }
        },
        freelanceTotalCustomerCharges: {
          $sum: { $cond: [{ $eq: ["$_id.technicianType", "freelance"] }, "$totalCustomerChargesForTech", 0] }
        },
        freelanceTotalTechCharges: {
          $sum: { $cond: [{ $eq: ["$_id.technicianType", "freelance"] }, "$totalTechChargesForTech", 0] }
        },

        totalTicketsInMonth: { $sum: "$ticketCountForTech" },
        totalVehiclesInMonth: { $sum: "$vehicleCountForTech" },
        totalCustomerChargesAll: { $sum: "$totalCustomerChargesForTech" },

        ticketIdsNested: { $addToSet: "$ticketIds" },

        payrollTechRows: {
          $push: {
            $cond: [
              { $eq: ["$_id.technicianType", "payroll"] },
              {
                technicianId: "$_id.technicianId",
                technicianName: "$_id.technicianName",
                ticketCountForTech: "$ticketCountForTech",
                declaredSalaryForTech: "$declaredSalaryForTech",
                totalCustomerChargesForTech: "$totalCustomerChargesForTech"
              },
              "$$REMOVE"
            ]
          }
        },
        freelanceTechRows: {
          $push: {
            $cond: [
              { $eq: ["$_id.technicianType", "freelance"] },
              {
                technicianId: "$_id.technicianId",
                technicianName: "$_id.technicianName",
                ticketCountForTech: "$ticketCountForTech",
                totalCustomerChargesForTech: "$totalCustomerChargesForTech",
                totalTechChargesForTech: "$totalTechChargesForTech"
              },
              "$$REMOVE"
            ]
          }
        }
      }
    },

    // 9) flatten ticketIds and compute margins
    {
      $addFields: {
        ticketIds: {
          $reduce: {
            input: { $ifNull: ["$ticketIdsNested", []] },
            initialValue: [],
            in: { $setUnion: ["$$value", "$$this"] }
          }
        },
        payrollMargin: { $subtract: ["$payrollTotalCustomerCharges", "$payrollDeclaredSalaries"] },
        freelanceMargin: { $subtract: ["$freelanceTotalCustomerCharges", "$freelanceTotalTechCharges"] },

        // 👉 new: grossMargin = all customer charges - payroll salaries - freelance tech charges
        grossMargin: {
          $subtract: [
            { $subtract: ["$totalCustomerChargesAll", "$payrollDeclaredSalaries"] },
            "$freelanceTotalTechCharges"
          ]
        }
      }
    },

    {
      $addFields: {
        // 👉 new: margin per vehicle
        marginPerVehicle: {
          $cond: [
            { $eq: ["$totalVehiclesInMonth", 0] },
            0,
            { $divide: ["$grossMargin", "$totalVehiclesInMonth"] }
          ]
        }
      }
    },

    // 10) final projection
    {
      $project: {
        _id: 0,
        financialMonthKey: "$_id.financialMonthKey",
        financialYearLabel: "$_id.financialYearLabel",
        year: "$_id.year",
        month: "$_id.month",
        monthName: "$_id.monthName",

        payrollTicketCount: 1,
        payrollVehicleCount: 1,
        payrollTotalCustomerCharges: 1,
        payrollTotalTechCharges: 1,
        payrollDeclaredSalaries: 1,
        payrollMargin: 1,
        payrollTechnicianCount: 1,   // 👉 include in result
        payrollTechRows: 1,

        freelanceTicketCount: 1,
        freelanceVehicleCount: 1,
        freelanceTotalCustomerCharges: 1,
        freelanceTotalTechCharges: 1,
        freelanceMargin: 1,
        freelanceTechRows: 1,

        totalTicketsInMonth: 1,
        totalVehiclesInMonth: 1,
        totalCustomerChargesAll: 1,
        ticketIds: 1,

        grossMargin: 1,          // 👉 include in result
        marginPerVehicle: 1      // 👉 include in result
      }
    },

    { $sort: { year: 1, month: 1 } }
  ];

  const monthly = await Ticket.aggregate(pipeline).allowDiskUse(true);

  for (const m of monthly) {
    m.totalMargin = (m.payrollMargin || 0) + (m.freelanceMargin || 0);
    m.totalTickets = m.totalTicketsInMonth || 0;
    m.totalVehicles = m.totalVehiclesInMonth || 0;
  }

  return { monthly };
}




async function getTicketsByAvailabilityRange(req, res) {
  try {
    const { from: fromQ, to: toQ } = req.query;

    // Build baseMatch (your snippet)
    const baseMatch = {
      isTicketClosed: true,
      ticketStatus: "work done",
      technician: { $ne: null }
    };

    // Parse and validate dates if provided
    let from = null;
    let to = null;
    if (fromQ) {
      from = new Date(fromQ);
      if (isNaN(from.getTime())) {
        return res.status(400).json({ error: 'Invalid "from" date' });
      }
    }
    if (toQ) {
      to = new Date(toQ);
      if (isNaN(to.getTime())) {
        return res.status(400).json({ error: 'Invalid "to" date' });
      }
    }

    if (from || to) {
      baseMatch.ticketAvailabilityDate = {};
      if (from) baseMatch.ticketAvailabilityDate.$gte = from;
      if (to) baseMatch.ticketAvailabilityDate.$lte = to; // inclusive as requested
    } else {
      baseMatch.ticketAvailabilityDate = { $ne: null };
    }

    // Optionally pick which fields to return; use null or [] to return all
    // Example: projection to exclude large fields like attachments
    const projection = {
      // remove attachedFiles if you don't want them in response
      // attachedFiles: 0
    };

    // Run the query
    const tickets = await Ticket.find(baseMatch, projection).select("_id")

    return res.json({ count: tickets.length, tickets });
  } catch (err) {
    console.error('getTicketsByAvailabilityRange error', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}






const softCloseTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status, reason, technicianId } = req.body; // reason should be the _id of the TicketCloser reason

    if (!ticketId) {
      return res.status(400).json({ success: false, message: "Ticket ID is required" });
    }

    if (!technicianId) {
      return res.status(400).json({ success: false, message: "Technician ID is required" });
    }

    if (status !== "Work Done" && status !== "Work Not Done") {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    // Verify the technician is assigned to this ticket
    const ticket = await Ticket.findById(ticketId).select('technician');
    if (!ticket) {
      return res.status(404).json({ success: false, message: "Ticket not found" });
    }
    if (String(ticket.technician) !== String(technicianId)) {
      return res.status(403).json({ success: false, message: "You are not assigned to this ticket" });
    }

    const updateData = {
      softCloseByTechnician: true,
      softCloseByTechnicianDate: new Date(),
    };

    if (status === "Work Not Done") {
      if (!reason) {
        return res.status(400).json({ success: false, message: "Reason is required for Work Not Done" });
      }
      updateData.softCloseByTechnicianComment = reason;
    } else {
      updateData.softCloseByTechnicianComment = null;
    }

    const updatedTicket = await Ticket.findByIdAndUpdate(
      ticketId,
      updateData,
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: "Ticket soft closed successfully",
      data: updatedTicket,
    });

  } catch (error) {
    console.error("Error soft closing ticket:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

const exportAllTickets = async (req, res) => {
  try {
    const tickets = await Ticket.find({})
      .populate("qstClientName", "companyShortName companyName")
      .populate("assignee", "name")
      .populate("taskType", "taskName")
      .populate("deviceType", "deviceName")
      .populate("technician", "name")
      .populate("resolutionRef", "ResolutionName")
      .populate("issueFoundRef", "issueFoundName")
      .populate("creator", "name")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: tickets.length,
      data: tickets,
    });
  } catch (error) {
    console.error("Error exporting all tickets:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

module.exports = {
  exportAllTickets,
  getAllTickets,
  createTicket,
  createNewTicket,
  getTicketById,
  deleteTicketById,
  updateTicket,
  saveImageAndVideoURlToTicketUploadByCSE,
  getAllOpenTicketsForApplyCharge,
  updateTicketApplyCharges,
  ExportTicketDataByDateRange,
  getClientTicketsByUserId,
  exportClientTicketsByDateRange,
  getClosedTicketsSummaryforNeft,
  exportClosedTicketsSummaryforNeft,
  getTicketStatsForDashboard,
  getTicketTrends,
  getClientTicketforsuperadminforReport,
  exportClientTicketforsuperadminforReportDaterange,
  getTicketStatusClosedOrOpenForTechFileUpload,
  getExportTicketsByBillingCategory,
  getAllOwnCreatedTicketsForTelecallerDashboard,
  getDueDateChangeLogs,
  exportTechnicianPaymentTicketsReport,


  createTicketByQSTClientWithAutoAssignment,

  ExportNEFTbyIndividualTicketId,



  getDeletedTicketLogs,
  getDeletedTicketLogById,
  getDeletedLogsByTicketId,
  getTechnicianMargins,
  getTicketsByAvailabilityRange,
  ExportCanceledTicketDataByDateRange,
  softCloseTicket,
  sendTicketDataOnSecondSystem
};
