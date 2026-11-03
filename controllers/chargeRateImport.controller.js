const XLSX = require("xlsx");
const multer = require("multer");
const mongoose = require("mongoose");
const CustomerChargeRateModel = require("../models/customerChargeRateList.model");
const QstClient = require("../models/qstClient.model");
const Device = require("../models/device.model");
const Task = require("../models/task.model");

// ── Multer ────────────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error("Only .xlsx / .xls files are allowed"), false);
  },
});

// ── Expected Excel columns ────────────────────────────────────────────────────
// Client Short Name | Device Name | Task Name | Flat Rate | 1-10 | 11-20 | 21-25 | 26-30 | 31-40 | 41-50 | 51+

const QUANTITY_KEYS = [
  { col: "1-10",  field: "quantity_1_10"  },
  { col: "11-20", field: "quantity_11_20" },
  { col: "21-25", field: "quantity_21_25" },
  { col: "26-30", field: "quantity_26_30" },
  { col: "31-40", field: "quantity_31_40" },
  { col: "41-50", field: "quantity_41_50" },
  { col: "51+",   field: "quantity_51_plus" },
];

// ── Parse a single Excel row ──────────────────────────────────────────────────
function parseRow(row) {
  const clientName = String(row["Client Short Name"] || "").trim();
  const deviceName = String(row["Device Name"] || "").trim();
  const taskName   = String(row["Task Name"] || "").trim();
  const flatRateRaw = row["Flat Rate"];
  const flatRate   = flatRateRaw !== "" && flatRateRaw !== undefined ? parseFloat(flatRateRaw) : null;

  const rates = {};
  let hasQuantityRates = false;
  for (const { col, field } of QUANTITY_KEYS) {
    const val = row[col];
    if (val !== "" && val !== undefined && !isNaN(parseFloat(val))) {
      rates[field] = parseFloat(val);
      hasQuantityRates = true;
    }
  }

  return { clientName, deviceName, taskName, flatRate, rates: hasQuantityRates ? rates : null };
}

// ── Build lookup maps for clients, devices, tasks ─────────────────────────────
async function buildLookupMaps() {
  const [clients, devices, tasks] = await Promise.all([
    QstClient.find({}, "_id companyShortName companyName").lean(),
    Device.find({}, "_id deviceName").lean(),
    Task.find({}, "_id taskName").lean(),
  ]);

  const clientMap = new Map(
    clients.map((c) => [(c.companyShortName || c.companyName).toLowerCase().trim(), c._id.toString()])
  );
  const deviceMap = new Map(
    devices.map((d) => [d.deviceName.toLowerCase().trim(), d._id.toString()])
  );
  const taskMap = new Map(
    tasks.map((t) => [t.taskName.toLowerCase().trim(), t._id.toString()])
  );

  return { clientMap, deviceMap, taskMap };
}

// ── Generate Excel template ───────────────────────────────────────────────────
const downloadTemplate = async (req, res) => {
  try {
    const { clientMap, deviceMap, taskMap } = await buildLookupMaps();

    // Build sample rows showing available names
    const sampleRows = [
      {
        "Client Short Name": [...clientMap.keys()][0] || "Qubo",
        "Device Name": [...deviceMap.keys()][0] || "Dashcam usb - front",
        "Task Name": [...taskMap.keys()][0] || "Service",
        "Flat Rate": 500,
        "1-10": "", "11-20": "", "21-25": "", "26-30": "", "31-40": "", "41-50": "", "51+": "",
      },
      {
        "Client Short Name": [...clientMap.keys()][0] || "Qubo",
        "Device Name": [...deviceMap.keys()][0] || "Dashcam usb - front",
        "Task Name": "Installation",
        "Flat Rate": "",
        "1-10": 600, "11-20": 580, "21-25": 560, "26-30": 550, "31-40": 540, "41-50": 530, "51+": 520,
      },
    ];

    const ws = XLSX.utils.json_to_sheet(sampleRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ChargeRates");

    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
    res.setHeader("Content-Disposition", "attachment; filename=charge_rate_template.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.send(buffer);
  } catch (err) {
    console.error("Error generating template:", err);
    res.status(500).json({ success: false, message: "Failed to generate template" });
  }
};

// ── Preview: dry-run ──────────────────────────────────────────────────────────
const previewChargeRateImport = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) {
      return res.status(400).json({ success: false, message: "Excel file is empty" });
    }

    // Validate required columns
    const headers = Object.keys(rows[0]);
    const required = ["Client Short Name", "Device Name", "Task Name"];
    const missing = required.filter((h) => !headers.includes(h));
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `Missing required columns: ${missing.join(", ")}`,
        hint: "Download the template to see the correct format",
      });
    }

    const { clientMap, deviceMap, taskMap } = await buildLookupMaps();
    const results = { willUpdate: [], willCreate: [], errors: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Excel row number (1-indexed + header)
      const { clientName, deviceName, taskName, flatRate, rates } = parseRow(row);

      if (!clientName || !deviceName || !taskName) {
        results.errors.push({ row: rowNum, reason: "Missing Client, Device or Task name" });
        continue;
      }

      const clientId = clientMap.get(clientName.toLowerCase());
      const deviceId = deviceMap.get(deviceName.toLowerCase());
      const taskId   = taskMap.get(taskName.toLowerCase());

      if (!clientId) {
        results.errors.push({ row: rowNum, clientName, reason: `Client "${clientName}" not found in system` });
        continue;
      }
      if (!deviceId) {
        results.errors.push({ row: rowNum, deviceName, reason: `Device "${deviceName}" not found in system` });
        continue;
      }
      if (!taskId) {
        results.errors.push({ row: rowNum, taskName, reason: `Task "${taskName}" not found in system` });
        continue;
      }

      if (flatRate === null && !rates) {
        results.errors.push({ row: rowNum, reason: "Must provide either Flat Rate or at least one quantity range rate" });
        continue;
      }

      // Check if record already exists
      const existing = await CustomerChargeRateModel.findOne({
        qstClient: clientId,
        device: deviceId,
        taskType: taskId,
        project: { $exists: false },
      }).lean();

      const entry = {
        row: rowNum,
        clientName,
        deviceName,
        taskName,
        newFlatRate: flatRate,
        newRates: rates,
        isQuantityBased: !!rates,
      };

      if (existing) {
        results.willUpdate.push({
          ...entry,
          existingId: existing._id,
          oldFlatRate: existing.flatRate,
          oldRates: existing.rates,
        });
      } else {
        results.willCreate.push(entry);
      }
    }

    return res.status(200).json({
      success: true,
      summary: {
        totalRows: rows.length,
        willUpdate: results.willUpdate.length,
        willCreate: results.willCreate.length,
        errors: results.errors.length,
      },
      data: results,
    });
  } catch (err) {
    console.error("Error in previewChargeRateImport:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

// ── Confirm: apply updates + creates ─────────────────────────────────────────
const confirmChargeRateImport = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (!rows.length) {
      return res.status(400).json({ success: false, message: "Excel file is empty" });
    }

    const { clientMap, deviceMap, taskMap } = await buildLookupMaps();
    const bulkOps = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const { clientName, deviceName, taskName, flatRate, rates } = parseRow(row);

      if (!clientName || !deviceName || !taskName) {
        errors.push({ row: rowNum, reason: "Missing Client, Device or Task name" });
        continue;
      }

      const clientId = clientMap.get(clientName.toLowerCase());
      const deviceId = deviceMap.get(deviceName.toLowerCase());
      const taskId   = taskMap.get(taskName.toLowerCase());

      if (!clientId || !deviceId || !taskId) {
        errors.push({
          row: rowNum,
          reason: `Not found: ${!clientId ? `Client "${clientName}"` : ""} ${!deviceId ? `Device "${deviceName}"` : ""} ${!taskId ? `Task "${taskName}"` : ""}`.trim(),
        });
        continue;
      }

      if (flatRate === null && !rates) {
        errors.push({ row: rowNum, reason: "No rate values provided" });
        continue;
      }

      const updateDoc = {
        qstClient: new mongoose.Types.ObjectId(clientId),
        device: new mongoose.Types.ObjectId(deviceId),
        taskType: new mongoose.Types.ObjectId(taskId),
        isQuantityBased: !!rates,
        flatRate: flatRate !== null ? flatRate : null,
        ...(rates ? { rates } : { rates: {} }),
      };

      bulkOps.push({
        updateOne: {
          filter: {
            qstClient: new mongoose.Types.ObjectId(clientId),
            device: new mongoose.Types.ObjectId(deviceId),
            taskType: new mongoose.Types.ObjectId(taskId),
            $or: [{ project: { $exists: false } }, { project: null }],
          },
          update: { $set: updateDoc },
          upsert: true, // create if not exists
        },
      });
    }

    let updatedCount = 0;
    let createdCount = 0;

    if (bulkOps.length > 0) {
      const result = await CustomerChargeRateModel.bulkWrite(bulkOps, { ordered: false });
      updatedCount = result.modifiedCount;
      createdCount = result.upsertedCount;
    }

    return res.status(200).json({
      success: true,
      message: "Import complete",
      summary: {
        totalRows: rows.length,
        updated: updatedCount,
        created: createdCount,
        errors: errors.length,
      },
      errors,
    });
  } catch (err) {
    console.error("Error in confirmChargeRateImport:", err);
    return res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
};

module.exports = {
  upload,
  downloadTemplate,
  previewChargeRateImport,
  confirmChargeRateImport,
};
