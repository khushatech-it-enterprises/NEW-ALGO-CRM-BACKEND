// controllers/bulkPairing.controller.js
const ExcelJS = require("exceljs");
const XLSX = require("xlsx"); // only used for parsing the uploaded file
const multer = require("multer");
const mongoose = require("mongoose");

const Server = require("../models/server.model");
const QstClient = require("../models/qstClient.model");
const DeviceMaster = require("../models/deviceMaster");
const MainData = require("../models/mainData.model");

/* ─────────────────────────────────────────────────────────────────────────────
   MULTER – memory storage for Excel uploads
───────────────────────────────────────────────────────────────────────────── */
const storage = multer.memoryStorage();
const excelFilter = (req, file, cb) => {
  const ext = file.originalname.split(".").pop().toLowerCase();
  if (ext === "xlsx" || ext === "xls") {
    cb(null, true);
  } else {
    cb(new Error("Only Excel files (.xlsx / .xls) are allowed"), false);
  }
};
const uploadExcel = multer({
  storage,
  fileFilter: excelFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
}).single("file");

exports.uploadExcelMiddleware = uploadExcel;

/* ─────────────────────────────────────────────────────────────────────────────
   HELPER STYLES
───────────────────────────────────────────────────────────────────────────── */
const RED_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD93024" },
};
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
const HEADER_ALIGN = { horizontal: "center", vertical: "middle" };
const LABEL_FONT = { bold: true, size: 10 };
const NOTE_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFF8E7" },
};

/* ─────────────────────────────────────────────────────────────────────────────
   GET /device/bulk-pairing-template
   Generates & streams an Excel workbook with working dropdowns via exceljs.
───────────────────────────────────────────────────────────────────────────── */
exports.downloadTemplate = async (req, res) => {
  try {
    /* ── Fetch live data ─────────────────────────────────────────────────── */
    const [servers, clients] = await Promise.all([
      Server.find({ isActive: { $ne: false } }).sort({ serverName: 1 }).lean(),
      QstClient.find({}).sort({ companyName: 1 }).select("companyName companyShortName").lean(),
    ]);

    const serverNames = servers.map((s) => s.serverName);
    const clientLabels = clients.map(
      (c) => c.companyName || c.companyShortName || String(c._id)
    );

    /* ── Create workbook ─────────────────────────────────────────────────── */
    const wb = new ExcelJS.Workbook();
    wb.creator = "AlgoCRM";
    wb.created = new Date();

    /* ════════════════════════════════════════════════════════════════════════
       SHEET 1 – PairingData  (the data-entry sheet, opens first)
    ════════════════════════════════════════════════════════════════════════ */
    const wsData = wb.addWorksheet("PairingData", {
      views: [{ state: "normal" }],
    });

    // ── Column widths ──
    wsData.columns = [
      { key: "server", width: 25 },
      { key: "client", width: 38 },
      { key: "regNo", width: 28 },
      { key: "deviceId", width: 28 },
    ];

    // ── Header row ──
    const headerRow = wsData.addRow(["Server", "Client Name", "Registration No", "Device ID"]);
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.fill = RED_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = HEADER_ALIGN;
      cell.border = {
        bottom: { style: "medium", color: { argb: "FF9B1F1A" } },
      };
    });

    // ── 200 blank data rows with dropdowns ──
    const TOTAL_DATA_ROWS = 200;

    // Server dropdown formula — ExcelJS uses standard Excel formula string
    const serverFormula =
      serverNames.length > 0
        ? `"${serverNames.join(",")}"`
        : '"No servers available"';

    // Client formula — if few enough, inline; otherwise reference helper sheet
    // Excel inline list limit is ~255 chars. For large client lists we use a named range.
    // We always use the helper sheet reference which is more robust.
    // Named range "ClientList" will be defined on sheet "Clients"
    const clientFormula =
      clientLabels.length > 0
        ? `Clients!$A$1:$A$${clientLabels.length}`
        : '"No clients available"';

    for (let r = 2; r <= TOTAL_DATA_ROWS + 1; r++) {
      const row = wsData.addRow(["", "", "", ""]);
      row.height = 20;

      // Alternating row color
      if (r % 2 === 0) {
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF9F9F9" },
          };
        });
      }

      // ── Data Validation: Server (column A) ──
      const serverCell = wsData.getCell(r, 1);
      serverCell.dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [serverFormula],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Invalid Server",
        error: "Please select a server from the dropdown list.",
        showInputMessage: true,
        promptTitle: "Server",
        prompt: "Select a server from the list",
      };

      // ── Data Validation: Client (column B) ──
      const clientCell = wsData.getCell(r, 2);
      clientCell.dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [clientFormula],
        showErrorMessage: true,
        errorStyle: "stop",
        errorTitle: "Invalid Client",
        error: "Please select a client from the dropdown list.",
        showInputMessage: true,
        promptTitle: "Client Name",
        prompt: "Select a client from the list",
      };
    }

    // Freeze the header row
    wsData.views = [
      { state: "frozen", ySplit: 1, activeCell: "A2" },
    ];

    /* ════════════════════════════════════════════════════════════════════════
       SHEET 2 – Clients helper (visible but informational)
       ExcelJS cross-sheet data validation references work with visible sheets.
    ════════════════════════════════════════════════════════════════════════ */
    const wsClients = wb.addWorksheet("Clients", {
      state: "veryHidden", // hidden from tab bar
    });
    wsClients.getColumn(1).width = 42;
    // Write client names starting at A1 (no header — formula refs A1:An directly)
    clientLabels.forEach((label, i) => {
      wsClients.getCell(i + 1, 1).value = label;
    });

    /* ════════════════════════════════════════════════════════════════════════
       SHEET 3 – Instructions
    ════════════════════════════════════════════════════════════════════════ */
    const wsInstr = wb.addWorksheet("Instructions");
    wsInstr.columns = [
      { width: 22 },
      { width: 50 },
      { width: 12 },
      { width: 72 },
    ];

    // Title
    wsInstr.mergeCells("A1:D1");
    const titleCell = wsInstr.getCell("A1");
    titleCell.value = "BULK PAIRING TEMPLATE – Instructions";
    titleCell.font = { bold: true, size: 14, color: { argb: "FFD93024" } };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    wsInstr.getRow(1).height = 32;

    // Header row
    const instrHeader = wsInstr.addRow(["Column", "Description", "Required", "Notes"]);
    instrHeader.eachCell((cell) => {
      cell.fill = RED_FILL;
      cell.font = HEADER_FONT;
      cell.alignment = HEADER_ALIGN;
    });

    const instrRows = [
      ["Server", "Select from dropdown (Col A)", "Yes", "Must match an active server exactly"],
      ["Client Name", "Select from dropdown (Col B)", "Yes", "Must match an existing client exactly"],
      ["Registration No", "Vehicle/asset registration number", "Yes", "Free-text; must NOT already exist in the database for this client"],
      ["Device ID", "Physical device identifier (deviceId field)", "Yes", "Must be in STOCK, testing status = 'tested ok', and NOT already paired"],
    ];
    instrRows.forEach((r) => {
      const row = wsInstr.addRow(r);
      row.getCell(3).alignment = { horizontal: "center" };
    });

    wsInstr.addRow([]);

    // Rules section
    const rulesTitle = wsInstr.addRow(["RULES"]);
    rulesTitle.getCell(1).font = { bold: true, size: 11 };

    const rules = [
      "1. Do NOT edit column headers in PairingData sheet.",
      "2. Each row = one vehicle/asset pairing.",
      "3. You may copy a row down and change Registration No and Device ID.",
      "4. If ANY row fails validation, the ENTIRE import is rejected.",
      "5. Device IDs must be unique within the sheet and unpaired in the database.",
      "6. Registration Numbers must be unique within the sheet.",
      "7. Go to the PairingData sheet to enter data.",
    ];
    rules.forEach((rule) => {
      const row = wsInstr.addRow([rule]);
      wsInstr.mergeCells(`A${row.number}:D${row.number}`);
    });

    // Note box
    wsInstr.addRow([]);
    wsInstr.mergeCells(`A${wsInstr.lastRow.number + 1}:D${wsInstr.lastRow.number + 1}`);
    const noteRow = wsInstr.addRow(["⚠️  Go to the PairingData sheet tab to fill in your data. Server and Client columns have dropdowns."]);
    wsInstr.mergeCells(`A${noteRow.number}:D${noteRow.number}`);
    noteRow.getCell(1).fill = NOTE_FILL;
    noteRow.getCell(1).font = { bold: true, size: 11, color: { argb: "FF856404" } };
    noteRow.getCell(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    noteRow.height = 32;

    /* ── Make PairingData the active sheet ── */
    // In ExcelJS, the first added sheet is active by default.
    // We added PairingData first, so it will open there.
    wb.views = [{ activeTab: 0 }]; // 0 = PairingData (first added)

    /* ── Stream response ── */
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="BulkPairing_Template.xlsx"'
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error generating bulk pairing template:", err);
    // Only send error if headers not already sent
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: "Failed to generate template",
        error: err.message,
      });
    }
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   POST /device/bulk-pairing-import
   Accepts multipart/form-data with field "file" = Excel workbook.
   Validates ALL rows first, then inserts ALL at once (atomic).
   On any error → stops entire import and returns descriptive message.
───────────────────────────────────────────────────────────────────────────── */
exports.importBulkPairing = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded. Please attach an Excel file.",
      });
    }

    /* ── Parse workbook ─────────────────────────────────────────────────── */
    let wb;
    try {
      wb = XLSX.read(req.file.buffer, { type: "buffer" });
    } catch (parseErr) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot read the uploaded file. Make sure it is a valid Excel file (.xlsx / .xls).",
      });
    }

    const sheetName = wb.SheetNames.find((n) => n === "PairingData");
    if (!sheetName) {
      return res.status(400).json({
        success: false,
        message:
          'Sheet "PairingData" not found. Please use the official template and do not rename sheets.',
      });
    }

    const ws = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

    // Skip header row (index 0), collect non-empty data rows
    const dataRows = rawRows
      .slice(1)
      .map((r, i) => ({ row: i + 2, data: r }))
      .filter((r) => r.data.some((cell) => String(cell).trim() !== ""));

    if (dataRows.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "The PairingData sheet is empty. Please fill in at least one row.",
      });
    }

    /* ── Fetch lookup data ──────────────────────────────────────────────── */
    const [servers, clients] = await Promise.all([
      Server.find({ isActive: { $ne: false } }).lean(),
      QstClient.find({}).select("companyName companyShortName").lean(),
    ]);

    const serverMap = new Map(
      servers.map((s) => [s.serverName.trim().toLowerCase(), s])
    );
    const clientMap = new Map(
      clients.map((c) => [
        (c.companyName || c.companyShortName || "").trim().toLowerCase(),
        c,
      ])
    );

    /* ── Validate rows ──────────────────────────────────────────────────── */
    const errors = [];
    const parsed = [];
    const sheetDeviceIds = new Set();
    const sheetRegNos = new Set();

    for (const { row, data } of dataRows) {
      const serverRaw = String(data[0] || "").trim();
      const clientRaw = String(data[1] || "").trim();
      const regNoRaw = String(data[2] || "").trim();
      const deviceIdRaw = String(data[3] || "").trim();

      const rowErrors = [];

      if (!serverRaw) rowErrors.push("Server is required");
      if (!clientRaw) rowErrors.push("Client Name is required");
      if (!regNoRaw) rowErrors.push("Registration No is required");
      if (!deviceIdRaw) rowErrors.push("Device ID is required");

      if (rowErrors.length > 0) {
        errors.push({ row, fields: rowErrors });
        continue;
      }

      const serverObj = serverMap.get(serverRaw.toLowerCase());
      if (!serverObj) {
        rowErrors.push(
          `Server "${serverRaw}" not found. Please select from the dropdown.`
        );
      }

      const clientObj = clientMap.get(clientRaw.toLowerCase());
      if (!clientObj) {
        rowErrors.push(
          `Client "${clientRaw}" not found. Please select from the dropdown.`
        );
      }

      if (sheetRegNos.has(regNoRaw.toUpperCase())) {
        rowErrors.push(
          `Registration No "${regNoRaw}" is duplicated within the sheet.`
        );
      } else {
        sheetRegNos.add(regNoRaw.toUpperCase());
      }

      if (sheetDeviceIds.has(deviceIdRaw.toUpperCase())) {
        rowErrors.push(
          `Device ID "${deviceIdRaw}" is duplicated within the sheet.`
        );
      } else {
        sheetDeviceIds.add(deviceIdRaw.toUpperCase());
      }

      if (rowErrors.length > 0) {
        errors.push({ row, fields: rowErrors });
        continue;
      }

      parsed.push({
        row,
        serverName: serverObj.serverName,
        serverReferType: serverObj.referType || "",
        serverAssetTypes: serverObj.assetTypes || [],
        clientId: clientObj._id,
        clientName: clientObj.companyName || clientObj.companyShortName,
        registrationNumber: regNoRaw,
        deviceIdStr: deviceIdRaw,
      });
    }

    if (errors.length > 0) {
      return res.status(422).json({
        success: false,
        message: `Validation failed on ${errors.length} row(s). Fix all errors and re-import.`,
        errors,
      });
    }

    /* ── Database validation ────────────────────────────────────────────── */
    const deviceIdStrings = parsed.map((p) => p.deviceIdStr);
    const deviceDocs = await DeviceMaster.find({
      deviceId: { $in: deviceIdStrings },
    }).lean();

    const deviceByIdStr = new Map(
      deviceDocs.map((d) => [d.deviceId.trim().toUpperCase(), d])
    );

    const deviceObjectIds = deviceDocs.map((d) => d._id);
    const alreadyPaired = await MainData.find({
      deviceDetails: { $in: deviceObjectIds },
    })
      .select("deviceDetails registrationNumber")
      .lean();

    const pairedDeviceObjIds = new Set(
      alreadyPaired.map((m) => String(m.deviceDetails))
    );

    const clientIds = [...new Set(parsed.map((p) => String(p.clientId)))];
    const existingRegNos = await MainData.find({
      company: { $in: clientIds },
      registrationNumber: { $in: parsed.map((p) => p.registrationNumber) },
    })
      .select("company registrationNumber")
      .lean();

    const pairedRegNos = new Set(
      existingRegNos.map(
        (m) => `${String(m.company)}::${m.registrationNumber.toUpperCase()}`
      )
    );

    const dbErrors = [];
    for (const p of parsed) {
      const rowErrs = [];
      const devDoc = deviceByIdStr.get(p.deviceIdStr.toUpperCase());

      if (!devDoc) {
        rowErrs.push(
          `Device ID "${p.deviceIdStr}" does not exist in the system.`
        );
      } else {
        if (devDoc.status !== "stock") {
          rowErrs.push(
            `Device "${p.deviceIdStr}" is not in stock (current status: "${devDoc.status}"). Only stock devices can be paired.`
          );
        }
        if (devDoc.testingStatus !== "tested ok") {
          rowErrs.push(
            `Device "${p.deviceIdStr}" has not passed testing (testing status: "${devDoc.testingStatus || "none"}"). Only "tested ok" devices can be paired.`
          );
        }
        if (pairedDeviceObjIds.has(String(devDoc._id))) {
          const pairedRecord = alreadyPaired.find(
            (m) => String(m.deviceDetails) === String(devDoc._id)
          );
          rowErrs.push(
            `Device "${p.deviceIdStr}" is already paired${pairedRecord ? ` with Registration No: ${pairedRecord.registrationNumber}` : ""}.`
          );
        }
      }

      const regKey = `${String(p.clientId)}::${p.registrationNumber.toUpperCase()}`;
      if (pairedRegNos.has(regKey)) {
        rowErrs.push(
          `Registration No "${p.registrationNumber}" already exists in the database for client "${p.clientName}".`
        );
      }

      if (rowErrs.length > 0) {
        dbErrors.push({ row: p.row, fields: rowErrs });
      } else {
        p.deviceObjId = devDoc._id;
        p.assetType =
          p.serverAssetTypes.length >= 1 ? p.serverAssetTypes[0] : "";
        p.referType = p.serverReferType;
      }
    }

    if (dbErrors.length > 0) {
      return res.status(422).json({
        success: false,
        message: `Database validation failed on ${dbErrors.length} row(s). Fix all errors and re-import.`,
        errors: dbErrors,
      });
    }

    /* ── Insert all rows ────────────────────────────────────────────────── */
    const documents = parsed.map((p) => ({
      company: p.clientId,
      server: p.serverName,
      referType: p.referType,
      assetType: p.assetType,
      registrationNumber: p.registrationNumber,
      deviceDetails: p.deviceObjId,
      simDetails: null,
      accessoryDetails: [],
    }));

    const inserted = await MainData.insertMany(documents);

    return res.status(201).json({
      success: true,
      message: `Bulk pairing successful! ${inserted.length} record(s) created.`,
      count: inserted.length,
    });
  } catch (err) {
    console.error("Error in bulk pairing import:", err);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred during import. Please try again.",
      error: err.message,
    });
  }
};
