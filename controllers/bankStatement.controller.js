const XLSX = require("xlsx");
const Ticket = require("../models/ticket.model");
const Technician = require("../models/technician.model");
const Employee = require("../models/employee.model");
const multer = require("multer");
const mongoose = require("mongoose");
const { parse } = require("date-fns");

const { zonedTimeToUtc, fromZonedTime, toDate } = require("date-fns-tz");

const ClientpaymentCollection = require("../models/clientPaymentCollection.model");
const SalesRegisterSample = require("../models/salesRegisterSample.model");
const QstClient = require("../models/qstClient.model");
const TransactionReport = require("../models/clientTransactionReportCollection.model"); // adjust path
const BankStatement = require("../models/bankStatement.model");

// Multer Configuration with Enhanced Error Handling
const paymentFileUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only Excel files are allowed."));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
}).single("paymentFile");

// Process Excel and Update Payments helper function
// console.log("Available functions from date-fns-tz:", Object.keys(require("date-fns-tz")));
const parseExcelDate = (dateValue) => {
  // console.log("running parseExcelDate function",typeof dateValue );
  if (!dateValue) return null;

  // If it's already a Date
  if (dateValue instanceof Date && !isNaN(dateValue)) {
    return dateValue;
    // return zonedTimeToUtc(dateValue, "Asia/Kolkata"); // normalize to UTC but from IST
  }

  // If it's a string - try multiple date formats (old: dd/MM/yyyy hh:mm:ss a, new: dd-MM-yyyy HH:mm:ss)
  if (typeof dateValue === "string") {
    const trimmed = dateValue.trim().replace(/\n/g, " ");
    const formats = [
      "dd/MM/yyyy hh:mm:ss a",
      "dd-MM-yyyy HH:mm:ss",
      "dd-MM-yyyy hh:mm:ss a",
      "dd/MM/yyyy HH:mm:ss",
      "dd-MM-yyyy",
      "dd/MM/yyyy",
    ];
    for (const fmt of formats) {
      try {
        const parsed = parse(trimmed, fmt, new Date());
        if (!isNaN(parsed)) {
          const converted = fromZonedTime(parsed, "Asia/Kolkata");
          return converted;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  // If it's a number (Excel serial date)
  if (typeof dateValue === "number") {
    const parsed = XLSX.SSF.parse_date_code(dateValue);
    if (parsed) {
      const jsDate = new Date(
        parsed.y,
        parsed.m - 1,
        parsed.d,
        parsed.H || 0,
        parsed.M || 0,
        parsed.S || 0,
      );
      // it is review
      return zonedTimeToUtc(jsDate, "Asia/Kolkata");
    }
  }

  return null;
};

// Categorize transaction description (supports QuikServ slash format and algoCRM NEFT format)
const parseTransactionDescription = (description) => {
  if (!description) return { type: "UNKNOWN", reason: "Empty description" };
  const s = String(description).trim();

  // 1. Bank charges
  if (/^charges\b|^sms charges\b/i.test(s)) {
    return { type: "BANK_CHARGES", skip: true, reason: "Bank Charges" };
  }

  // 2. Taxes and statutory payments
  if (/^gst\//i.test(s) || /^epay\/to:.*(tax|epfo|esic|epay)/i.test(s)) {
    return { type: "STATUTORY_TAX", skip: true, reason: "Tax/EPFO/Statutory Payment" };
  }

  // 3. Operational expenses / Internal transfers
  if (/^(trf|sweep transfer|salary|employee payments|conveyance|conv|self|voucher)\b/i.test(s)) {
    return { type: "OPERATIONAL_EXPENSE", skip: true, reason: "Internal Transfer / Salary / Operational Expense" };
  }

  // 4. eTXN/To:... advance/internal
  const eTxnMatch = s.match(/^eTXN\/To:[^\/]+\/(.+)$/i);
  if (eTxnMatch) {
    const remark = eTxnMatch[1].trim();
    return { type: "ADVANCE_OR_EXPENSE", skip: true, reason: `Advance/Internal transfer (${remark})` };
  }

  // 5. Slash format (QuikServ) with potential Ticket SKU (e.g. MMT/IMPS/.../<ticketSKUId>/...)
  const slashParts = s.split("/");
  if (slashParts.length >= 4) {
    const commonJunk = ["MMT", "IMPS", "UPI", "RTGS", "NEFT", "TRANSFER", "PAY", "EPAY", "GST", "ETXN"];
    let sku = null;
    if (slashParts[3] && slashParts[3].trim().length >= 8 && !commonJunk.includes(slashParts[3].trim().toUpperCase())) {
      sku = slashParts[3].trim();
    } else {
      sku = slashParts.find(p => p.trim().length >= 8 && !commonJunk.includes(p.toUpperCase().trim()))?.trim();
    }
    if (sku) {
      return { type: "TICKET_SKU", sku };
    }
  }

  // 6. NEFT TO <NAME>:<REF>
  const neftToMatch = s.match(/^NEFT\s+TO\s+([^:]+):?([A-Za-z0-9]*)/i);
  if (neftToMatch) {
    return { type: "TECHNICIAN_NAME", name: neftToMatch[1].trim(), ref: neftToMatch[2]?.trim() || "" };
  }

  // 7. NEFTO-<NAME> <REF/ACC>
  const neftoMatch = s.match(/^NEFTO[\s\-]+(.*?)(?:\s+\d{6,})?$/i);
  if (neftoMatch) {
    return { type: "TECHNICIAN_NAME", name: neftoMatch[1].trim(), ref: "" };
  }

  return { type: "UNKNOWN", reason: "Unrecognized description format", description: s };
};

const cleanName = (name = "") => {
  return String(name)
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|shri|m\/s)\b/gi, "")
    .replace(/^mr(?=[a-z]{3})/i, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const isCompanyOrVendorName = (name = "") => {
  return /\b(pvt|ltd|limited|corp|corpora|corporation|enterprises|technologies|solutions|advisory|consultants|logistics|software|electronics|infotech|graphics|inc|co|telematics|automobiles|stationery)\b/i.test(name);
};

const matchPersonByName = (rawName, people) => {
  if (!rawName) return null;
  const normRaw = cleanName(rawName);
  const alphaRaw = normRaw.replace(/[^a-z0-9]/g, "");
  const rawTokens = normRaw.split(" ").filter(t => t.length > 1);
  if (!normRaw || normRaw.length < 2) return null;

  for (const person of people) {
    const candidateNames = [person.name, person.beneficiaryName, person.nickName, person.employeeName].filter(Boolean);
    for (const cName of candidateNames) {
      const normC = cleanName(cName);
      const alphaC = normC.replace(/[^a-z0-9]/g, "");
      const cTokens = normC.split(" ").filter(t => t.length > 1);

      // 1. Exact or compact alpha match
      if (normRaw === normC || (alphaRaw.length >= 4 && alphaRaw === alphaC)) {
        return person;
      }

      // 2. Token overlap: e.g. "DEBASHIS PRATIHAR" matches "Debashish Pratihar"
      let matchCount = 0;
      for (const rt of rawTokens) {
        if (cTokens.some(ct => ct === rt || (ct.length >= 4 && rt.length >= 4 && (ct.startsWith(rt.slice(0, 5)) || rt.startsWith(ct.slice(0, 5)))))) {
          matchCount++;
        }
      }
      if (matchCount >= 2 || (matchCount >= 1 && (rawTokens.length === 1 || cTokens.length === 1))) {
        return person;
      }

      // 3. Compact alpha substring: e.g. "mohamedjamsith" vs "mmohamedjamsith"
      if (alphaC.length >= 6 && alphaRaw.length >= 6) {
        if (alphaC.includes(alphaRaw) || alphaRaw.includes(alphaC)) {
          return person;
        }
      }
    }
  }
  return null;
};

const findMatchingTechnician = (rawName, technicians) => matchPersonByName(rawName, technicians);
const findMatchingEmployee = (rawName, employees) => matchPersonByName(rawName, employees);

const processPaymentFile = async (fileBuffer) => {
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Read as 2D array to manually find the header row
  const allRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

  // Find the header row (supports both old Cr/Dr format and new Deposit/Withdrawal format)
  let headerIndex = -1;
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i].map(cell => String(cell || "").trim().toLowerCase());

    const hasDesc = row.some(cell => cell === "description" || cell === "remarks");
    const hasCrDr = row.some(cell => cell.includes("cr/dr") || cell.includes("type"));
    const hasAmount = row.some(cell => cell.includes("amount"));
    const hasDate = row.some(cell => cell.includes("date"));
    const hasDepositWithdrawal = row.some(cell => cell.includes("withdrawal")) && row.some(cell => cell.includes("deposit"));

    const markers = [hasDesc, hasCrDr || hasDepositWithdrawal, hasAmount || hasDepositWithdrawal, hasDate].filter(Boolean).length;

    if (markers >= 3 || (hasDesc && (hasCrDr || hasDepositWithdrawal))) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error("Could not find the header row in the Excel file. Please ensure columns like 'Description'/'Remarks', 'Cr/Dr' or 'Withdrawals'/'Deposits' are present.");
  }

  const headers = allRows[headerIndex].map(h => String(h || "").trim());
  const dataRows = allRows.slice(headerIndex + 1);

  // Detect format: new format has Withdrawals/Deposits columns instead of Cr/Dr + Amount
  const isNewFormat = headers.some(h => /withdrawal/i.test(h)) && headers.some(h => /deposit/i.test(h));

  // Preload all technicians for memory-based matching
  const allTechnicians = await Technician.find(
    {},
    "_id name nickName beneficiaryName accountNumber ifscCode phoneNumber"
  ).lean();

  const allEmployees = await Employee.find(
    {},
    "_id name email role phoneNumber employeeName"
  ).lean();

  const report = {
    totalRows: dataRows.length,
    successCount: 0,
    failedCount: 0,
    alreadyPaidCount: 0,
    drRowsCount: 0,
    crRowsCount: 0,
    unknownTypeCount: 0,
    ticketNotFoundCount: 0,
    failures: [],
    skippedCount: 0,
    skipped: [],
  };

  const bulkOps = [];
  const skuToRowMap = {}; // Map SKU to Excel row numbers for reporting

  for (let index = 0; index < dataRows.length; index++) {
    const rowData = dataRows[index];
    const rowNum = index + headerIndex + 2; // Offset for Excel UI row numbering
    try {
      // Map array to object based on headers
      const row = {};
      headers.forEach((header, i) => {
        row[header] = rowData[i];
      });

      // Determine transaction type based on format (old: Cr/Dr column, new: Withdrawals/Deposits)
      let transactionType;
      let withdrawalVal = 0;
      if (isNewFormat) {
        const withdrawalKey = headers.find(k => k.toLowerCase().includes("withdrawal"));
        const depositKey = headers.find(k => k.toLowerCase().includes("deposit"));
        withdrawalVal = parseFloat(row[withdrawalKey]) || 0;
        const depositVal = parseFloat(row[depositKey]) || 0;
        transactionType = withdrawalVal > 0 ? "DR" : (depositVal > 0 ? "CR" : "");
      } else {
        const crDrKey = headers.find(k => k.toLowerCase().includes("cr/dr") || k.toLowerCase().includes("type"));
        transactionType = String(row[crDrKey] || "").trim().toUpperCase();
        const amtKey = headers.find(k => k.toLowerCase().includes("transaction amount") || k.toLowerCase().includes("amount"));
        withdrawalVal = parseFloat(row[amtKey]) || 0;
      }

      if (transactionType !== "DR") {
        if (transactionType === "CR") {
          report.crRowsCount++;
        } else {
          report.unknownTypeCount++;
        }
        report.skippedCount++;
        report.skipped.push({
          row: rowNum,
          reason: `Skipped because this is a ${transactionType || 'UNKNOWN'} transaction (Technician Payment requires DR)`,
          data: { transactionType },
        });
        continue;
      }
      report.drRowsCount++;

      // Flexible matching for Description and Date (supports both old and new column names)
      const descKey = headers.find(k => k.toLowerCase() === "description" || k.toLowerCase() === "remarks") || "Description";
      const dateKey = headers.find(k => k.toLowerCase().includes("txn posted date") || k.toLowerCase().includes("posted date") || k.toLowerCase() === "date") || "Txn Posted Date";

      const description = String(row[descKey] || "").trim();
      const txnPostedDate = parseExcelDate(row[dateKey]) || new Date();

      // Categorize and parse transaction description
      const parsed = parseTransactionDescription(description);

      // 1. Skip non-technician entries (Bank charges, Taxes, Operational Expenses, internal advances)
      if (parsed.skip) {
        report.skippedCount++;
        report.skipped.push({
          row: rowNum,
          reason: `Skipped: ${parsed.reason}`,
          data: { description, amount: withdrawalVal },
        });
        continue;
      }

      // 2. Format with Ticket SKU (QuikServ)
      if (parsed.type === "TICKET_SKU") {
        const ticketSKUId = parsed.sku;
        skuToRowMap[ticketSKUId] = rowNum;

        bulkOps.push({
          updateOne: {
            filter: {
              ticketSKUId,
              isTechnicianPaymentSuccess: { $ne: true },
            },
            update: {
              $set: {
                isTechnicianPaymentSuccess: true,
                isTechnicianPaymentSuccessDate: txnPostedDate,
              },
            },
          },
        });
        continue;
      }

      // 3. Format with Technician / Payee Name (algoCRM NEFT)
      if (parsed.type === "TECHNICIAN_NAME") {
        const rawName = parsed.name;

        // Check if obvious vendor/company before technician lookup
        if (isCompanyOrVendorName(rawName)) {
          report.skippedCount++;
          report.skipped.push({
            row: rowNum,
            reason: `Skipped: Vendor/Company payee (${rawName})`,
            data: { payeeName: rawName, amount: withdrawalVal, description },
          });
          continue;
        }

        const tech = findMatchingTechnician(rawName, allTechnicians);

        if (!tech) {
          // Check if internal employee / founder
          const emp = findMatchingEmployee(rawName, allEmployees);
          if (emp) {
            report.skippedCount++;
            report.skipped.push({
              row: rowNum,
              reason: `Skipped: Internal Staff/Employee payout ("${emp.name}" - ${emp.role})`,
              data: { payeeName: rawName, employee: emp.name, role: emp.role, amount: withdrawalVal, description },
            });
            continue;
          }

          // Unregistered outside payee or contractor
          report.skippedCount++;
          report.skipped.push({
            row: rowNum,
            reason: `Skipped: Outside payee / No registered technician matched payee "${rawName}"`,
            data: { payeeName: rawName, amount: withdrawalVal, description },
          });
          continue;
        }

        // Search for unpaid completed tickets for this technician (work done or closed)
        const candidateTickets = await Ticket.find({
          technician: tech._id,
          $or: [
            { ticketStatus: "work done" },
            { isTicketClosed: true },
          ],
          isTechnicianPaymentSuccess: { $ne: true },
        }).sort({ createdAt: 1 });

        if (candidateTickets.length === 0) {
          report.skippedCount++;
          report.skipped.push({
            row: rowNum,
            reason: `Technician "${tech.name}" found, but no unpaid completed tickets exist`,
            data: { technician: tech.name, amount: withdrawalVal },
          });
          continue;
        }

        // Check 1: Exact single-ticket amount match
        const matchedTicket = candidateTickets.find(t => {
          const charge = t.totalTechCharges !== undefined && t.totalTechCharges !== null ? t.totalTechCharges : t.technicianCharges;
          return Math.abs((charge || 0) - withdrawalVal) < 0.01;
        });

        if (matchedTicket) {
          await Ticket.updateOne(
            { _id: matchedTicket._id },
            {
              $set: {
                isTechnicianPaymentSuccess: true,
                isTechnicianPaymentSuccessDate: txnPostedDate,
              },
            }
          );
          report.successCount++;
          continue;
        }

        // Check 2: Total sum of pending closed tickets matches withdrawal amount
        const totalPendingCharges = candidateTickets.reduce((sum, t) => {
          const charge = t.totalTechCharges !== undefined && t.totalTechCharges !== null ? t.totalTechCharges : t.technicianCharges;
          return sum + (charge || 0);
        }, 0);

        if (Math.abs(totalPendingCharges - withdrawalVal) < 0.01) {
          const ticketIds = candidateTickets.map(t => t._id);
          await Ticket.updateMany(
            { _id: { $in: ticketIds } },
            {
              $set: {
                isTechnicianPaymentSuccess: true,
                isTechnicianPaymentSuccessDate: txnPostedDate,
              },
            }
          );
          report.successCount += candidateTickets.length;
          continue;
        }

        // Check 3: FIFO allocation if withdrawal amount covers full ticket charges
        let remainingAmount = withdrawalVal;
        const allocatedTicketIds = [];
        for (const t of candidateTickets) {
          const charge = (t.totalTechCharges !== undefined && t.totalTechCharges !== null ? t.totalTechCharges : t.technicianCharges) || 0;
          if (charge > 0 && charge <= remainingAmount) {
            allocatedTicketIds.push(t._id);
            remainingAmount -= charge;
          }
        }

        if (allocatedTicketIds.length > 0 && remainingAmount < 0.01) {
          await Ticket.updateMany(
            { _id: { $in: allocatedTicketIds } },
            {
              $set: {
                isTechnicianPaymentSuccess: true,
                isTechnicianPaymentSuccessDate: txnPostedDate,
              },
            }
          );
          report.successCount += allocatedTicketIds.length;
          continue;
        }

        // No exact or complete ticket match
        report.skippedCount++;
        report.skipped.push({
          row: rowNum,
          reason: `Technician "${tech.name}" matched, but no combination of unpaid completed tickets matched amount ₹${withdrawalVal}`,
          data: {
            technician: tech.name,
            amount: withdrawalVal,
            unpaidTicketsCount: candidateTickets.length,
            ticketAmounts: candidateTickets.map(t => t.totalTechCharges || t.technicianCharges || 0),
          },
        });
        continue;
      }

      // 4. Unknown format
      report.failedCount++;
      report.failures.push({
        row: rowNum,
        reason: parsed.reason || "Unrecognized description format",
        data: { description },
      });
    } catch (error) {
      report.failedCount++;
      report.failures.push({
        row: rowNum,
        reason: "Unexpected processing error",
        error: error.message,
        data: rowData,
      });
    }
  }

  // Execute bulk operations if we have valid SKU-based updates (from QuikServ)
  if (bulkOps.length > 0) {
    try {
      const result = await Ticket.bulkWrite(bulkOps, {
        ordered: false,
        writeConcern: { w: "majority" },
      });

      report.successCount += (result.modifiedCount || 0);

      const drRecordsInBulk = bulkOps.map(op => op.updateOne.filter.ticketSKUId);

      const foundTickets = await Ticket.find({
        ticketSKUId: { $in: drRecordsInBulk }
      }).select("ticketSKUId isTechnicianPaymentSuccess updatedAt");

      const foundSkuMap = {};
      foundTickets.forEach(t => {
        foundSkuMap[t.ticketSKUId] = {
          isPaid: t.isTechnicianPaymentSuccess,
          updatedRecently: (new Date() - t.updatedAt) < 10000
        };
      });

      drRecordsInBulk.forEach(sku => {
        const ticketState = foundSkuMap[sku];
        const originalRow = skuToRowMap[sku];

        if (!ticketState) {
          report.ticketNotFoundCount++;
          report.skippedCount++;
          report.skipped.push({
            row: originalRow,
            ticketSKUId: sku,
            reason: "Ticket ID not found in database",
          });
        } else if (ticketState.isPaid && !ticketState.updatedRecently) {
          report.alreadyPaidCount++;
          report.skippedCount++;
          report.skipped.push({
            row: originalRow,
            ticketSKUId: sku,
            reason: "Payment was already marked as successful earlier",
          });
        }
      });
    } catch (error) {
      throw new Error(`Bulk write failed: ${error.message}`);
    }
  }

  return report;
};


// Handle payment processing controller
const processPayments = async (req, res) => {
  paymentFileUpload(req, res, async (err) => {
    // Handle upload errors
    if (err) {
      return res.status(400).json({
        success: false,
        message: "File upload failed",
        error: err.message,
        details: {
          code: err.code,
          field: err.field,
        },
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
        details: {
          acceptedTypes: ["xls", "xlsx"],
          maxSize: "10MB",
        },
      });
    }

    try {
      try {
        await processBankStatementBuffer(
          req.file.buffer,
          req.file.originalname,
          req.user ? req.user._id : null
        );
      } catch (bsErr) {
        console.warn("Bank statement storage note:", bsErr.message);
      }

      const report = await processPaymentFile(req.file.buffer);

      // Prepare success response
      const response = {
        success: true,
        message: "Payment processing completed",
        report: {
          summary: {
            totalRecords: report.totalRows,
            drRecords: report.drRowsCount,
            crRecords: report.crRowsCount,
            unknownTypeRecords: report.unknownTypeCount,
            successfulUpdates: report.successCount,
            alreadyPaidCount: report.alreadyPaidCount,
            ticketNotFoundCount: report.ticketNotFoundCount,
            failedUpdates: report.failedCount,
            skippedUpdates: report.skippedCount,
            completionDate: new Date(),
          },
          details: {
            failures: report.failures.slice(0, 100), // Limit to 100 failures
            skipped: report.skipped.slice(0, 100), // Limit to 100 skipped
          },
        },
      };

      // Add warning if there were failures
      if (report.failedCount > 0 || report.skippedCount > 0) {
        response.warning = "Some records were not processed. Check details.";
      }

      res.json(response);
    } catch (error) {
      console.error("Payment processing error:", error);
      res.status(500).json({
        success: false,
        message: "Payment processing failed",
        error: error.message,
        timestamp: new Date(),
      });
    }
  });
};

// Improved extractor: scans for the first meaningful company token (no normalization)
function extractCompanyName(description) {
  if (!description || typeof description !== "string") return null;
  const s = description.trim();

  // Junk tokens that are not company names
  const JUNK = [
    "vendor",
    "installation",
    "installation ch",
    "installation ch/",
    "install",
    "install ch",
    "payment",
    "advance",
    "transfer",
    "txn",
    "transaction",
    "imps",
    "mm t",
    "mmt",
    "upi",
    "na",
    "return",
    "failure",
    "failed",
    "quick serv",
    "quik serv",
    "quickserv",
    "quikserv",
    "quick serv tech",
    "quik serv tech",
    "quick serv tech/",
    "quik serv tech/",
    "service charges",
    "service",
    "charges",
    "installation and service",
    "installation charges",
    "installation service",
    "mobil",

  ];

  function isNumericOnly(tok) {
    if (!tok) return true;
    return /^[0-9\s\-]+$/.test(tok);
  }

  function isJunkToken(tok) {
    if (!tok) return true;
    const t = String(tok).trim().toLowerCase();
    if (!/[a-z]/i.test(t)) return true; // no letters -> not meaningful
    // if token is short and generic like "ch" or "fr"
    if (t.length <= 2 && /^[a-z]+$/.test(t)) return true;
    // check in JUNK list (substring match)
    for (const j of JUNK) {
      if (t === j) return true;
    }
    // contains words that are all junk (e.g., "installation ch")
    const words = t
      .split(/\s+/)
      .map((w) => w.trim())
      .filter(Boolean);
    const allWordsJunk = words.every((w) => JUNK.includes(w));
    if (allWordsJunk) return true;
    return false;
  }

  // scan tokens from startIdx for first meaningful token
  function firstMeaningful(parts, startIdx = 0) {
    for (let i = startIdx; i < parts.length; i++) {
      const tok = String(parts[i] || "").trim();
      if (!tok) continue;
      if (isNumericOnly(tok)) continue;
      if (isJunkToken(tok)) continue;
      return tok;
    }
    return null;
  }

  // return last meaningful token (search backwards)
  function lastMeaningful(parts) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const tok = String(parts[i] || "").trim();
      if (!tok) continue;
      if (isNumericOnly(tok)) continue;
      if (isJunkToken(tok)) continue;
      return tok;
    }
    return null;
  }

  // Utility: split preserving tokens but trimming
  function tokensBy(sepRegex, str) {
    return String(str)
      .split(sepRegex)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  // NEFT with colon separator (new algoCRM format): "NEFT:RAJVIR LOGISTICS YESB62447464099"
  if (/^NEFT:/i.test(s)) {
    // Extract everything after "NEFT:" and remove trailing bank reference codes (alphanumeric IDs)
    const afterNeft = s.replace(/^NEFT:/i, "").trim();
    // Remove trailing alphanumeric bank reference (e.g., "YESB62447464099")
    const cleaned = afterNeft.replace(/\s+[A-Z]{3,5}\d{5,}$/i, "").trim();
    if (cleaned && !isNumericOnly(cleaned) && !isJunkToken(cleaned)) {
      return cleaned;
    }
    // Fallback: try to find first meaningful token by splitting on spaces
    const spaceParts = afterNeft.split(/\s+/).filter(Boolean);
    const found = firstMeaningful(spaceParts, 0);
    if (found) return found.trim();
  }

  // NEFT with dash separator (old quikServ format): "NEFT-BANKCODE-COMPANY_NAME"
  if (/^NEFT-/i.test(s)) {
    const parts = s.split("-");
    const found = firstMeaningful(parts, 2);
    if (found) return found.trim();
    if (parts.length >= 3 && !isNumericOnly(parts[2])) return parts[2].trim();
  }

  // CMS: company usually parts[2], but validate and fallback
  if (/^CMS\//i.test(s)) {
    const parts = s.split("/");
    if (parts.length >= 3) {
      const cand = parts[2].trim();
      if (!isNumericOnly(cand) && !isJunkToken(cand)) return cand;
      // else search forward
      const f = firstMeaningful(parts, 2);
      if (f) return f;
      return lastMeaningful(parts) || cand;
    }
  }

  // UPI: payer often at index 1, else choose first meaningful token after index 1
  if (/^UPI\//i.test(s)) {
    const parts = s.split("/");
    if (parts.length >= 2) {
      const cand = parts[1].trim();
      if (!isNumericOnly(cand) && !isJunkToken(cand)) return cand;
      const f = firstMeaningful(parts, 2);
      if (f) return f;
    }
  }

  // MMT/IMPS: often company near the end (second-last), but validate
  if (/^MMT\/IMPS/i.test(s)) {
    const parts = s
      .split("/")
      .map((p) => p.trim())
      .filter(Boolean);
    // try second-last meaningful
    if (parts.length >= 4) {
      const cand = parts[parts.length - 2];
      if (cand && !isNumericOnly(cand) && !isJunkToken(cand)) return cand;
      // search backward for last meaningful
      const lm = lastMeaningful(parts);
      if (lm) return lm;
      // fallback to first meaningful after txn id (index 2)
      const f = firstMeaningful(parts, 2);
      if (f) return f;
    }
  }

  // INF/INFT: tokens vary; skip numeric/junk and pick first meaningful after token index 2 or 3
  if (/^INF\/INFT/i.test(s)) {
    const parts = s
      .split("/")
      .map((p) => p.trim())
      .filter(Boolean);
    // try scanning from index 2 onward (skip ids)
    const f = firstMeaningful(parts, 2);
    if (f) return f;
    // fallback to last meaningful
    const lm = lastMeaningful(parts);
    if (lm) return lm;
  }

  // RTGS/IMPS with colon separator (new algoCRM format): "RTGS:COMPANY BANKREF"
  if (/^(RTGS|IMPS):/i.test(s)) {
    const afterPrefix = s.replace(/^(RTGS|IMPS):/i, "").trim();
    // Remove trailing alphanumeric bank reference (e.g., "YESB62447464099")
    const cleaned = afterPrefix.replace(/\s+[A-Z]{3,5}\d{5,}$/i, "").trim();
    if (cleaned && !isNumericOnly(cleaned) && !isJunkToken(cleaned)) {
      return cleaned;
    }
    const spaceParts = afterPrefix.split(/\s+/).filter(Boolean);
    const found = firstMeaningful(spaceParts, 0);
    if (found) return found.trim();
  }

  // RTGS with dash separator (old quikServ format): company often parts[2]
  if (/^RTGS-/i.test(s)) {
    const parts = s.split("-");
    if (parts.length >= 3) {
      const cand = parts[2].trim();
      if (!isNumericOnly(cand) && !isJunkToken(cand)) return cand;
      // search forward
      const f = firstMeaningful(parts, 2);
      if (f) return f;
    }
  }

  // Generic fallback: try slash penultimate but validate
  {
    const slashParts = s
      .split("/")
      .map((p) => p.trim())
      .filter(Boolean);
    if (slashParts.length >= 2) {
      const cand = slashParts[slashParts.length - 2];
      if (cand && !isNumericOnly(cand) && !isJunkToken(cand)) return cand;
      // else pick last meaningful
      const lm = lastMeaningful(slashParts);
      if (lm) return lm;
    }
  }

  // Last resort: find any sequence in description that looks like an alphabetic phrase
  const match = s.match(/([A-Za-z][A-Za-z0-9&\s\.\-]{2,})/);
  if (match) {
    const cand = match[0].trim();
    if (!isNumericOnly(cand) && !isJunkToken(cand)) return cand;
  }

  return null;
}

// Escape user-provided string for RegExp
function escapeRegExp(str = "") {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Normalize company name: lowercase, trim, remove common suffixes & extra spaces
function normalizeCompanyName(name = "") {
  if (!name) return "";
  let s = String(name).toLowerCase().trim();

  // remove punctuation and extra spaces
  s = s.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  // remove common company suffixes (extend this list as needed)
  const suffixes = [
    "private limited",
    "pvt ltd",
    "pvt.",
    "pvt",
    "limited",
    "ltd",
    "llp",
    "technologies",
    "technology",
    "solutions",
    "services",
    "enterprise",
    "enterprises",
    "company",
    "co",
    "logistics",
    "logistic",
    "logistics solutions",
    "logistic solutions",
    "india",
    "ind",
  ];
  for (const suf of suffixes) {
    const re = new RegExp(`\\b${escapeRegExp(suf)}\\b`, "g");
    s = s.replace(re, "");
  }

  // Handle "glued" suffixes like "FINANCEPRIV" or "TECHNOLOGIESLTD"
  s = s.replace(/(priv|pvt|ltd|limited|corp|inc|llp|india)$/i, "");

  s = s.replace(/\s+/g, " ").trim();
  return s;
}
// console.log();

// ✅ Parse Txn Posted Date (string or Excel serial)
function parseExcelDateCollection(dateValue) {
  if (!dateValue) return null;

  // Already a Date
  if (dateValue instanceof Date && !isNaN(dateValue)) {
    console.log("1");

    return zonedTimeToUtc(dateValue, "Asia/Kolkata");
  }

  // If it's a string - try multiple date formats (old: dd/MM/yyyy hh:mm:ss a, new: dd-MM-yyyy HH:mm:ss)
  if (typeof dateValue === "string") {
    const trimmed = dateValue.trim().replace(/\n/g, " ");
    const formats = [
      "dd/MM/yyyy hh:mm:ss a",
      "dd-MM-yyyy HH:mm:ss",
      "dd-MM-yyyy hh:mm:ss a",
      "dd/MM/yyyy HH:mm:ss",
      "dd-MM-yyyy",
      "dd/MM/yyyy",
    ];
    for (const fmt of formats) {
      try {
        const parsed = parse(trimmed, fmt, new Date());
        if (!isNaN(parsed)) {
          return parsed;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  // If it's a number (Excel serial date)
  if (typeof dateValue === "number") {
    const parsed = XLSX.SSF.parse_date_code(dateValue);
    if (parsed) {
      const jsDate = new Date(
        parsed.y,
        parsed.m - 1,
        parsed.d,
        parsed.H || 0,
        parsed.M || 0,
        parsed.S || 0,
      );
      return zonedTimeToUtc(jsDate, "Asia/Kolkata");
    }
  }

  return null;
}

const processPaymentFileForCollection = async (fileBuffer, userId) => {
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Read as 2D array to manually find the header row
  const allRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

  // Find the header row (supports both old Cr/Dr format and new Deposit/Withdrawal format)
  let headerIndex = -1;
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i].map(cell => String(cell || "").trim().toLowerCase());

    const hasDesc = row.some(cell => cell === "description" || cell === "remarks");
    const hasCrDr = row.some(cell => cell.includes("cr/dr") || cell.includes("type"));
    const hasAmount = row.some(cell => cell.includes("amount"));
    const hasDate = row.some(cell => cell.includes("date"));
    const hasDepositWithdrawal = row.some(cell => cell.includes("withdrawal")) && row.some(cell => cell.includes("deposit"));

    const markers = [hasDesc, hasCrDr || hasDepositWithdrawal, hasAmount || hasDepositWithdrawal, hasDate].filter(Boolean).length;

    if (markers >= 3 || (hasDesc && (hasCrDr || hasDepositWithdrawal))) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error("Could not find the header row in the Excel file. Please ensure columns like 'Description'/'Remarks', 'Cr/Dr' or 'Withdrawals'/'Deposits' are present.");
  }

  const headers = allRows[headerIndex].map(h => String(h || "").trim());
  const dataRows = allRows.slice(headerIndex + 1);

  // Detect format: new format has Withdrawals/Deposits columns instead of Cr/Dr + Amount
  const isNewFormat = headers.some(h => /withdrawal/i.test(h)) && headers.some(h => /deposit/i.test(h));

  const report = {
    totalRows: dataRows.length,
    successCount: 0,
    failedCount: 0,
    crRowsCount: 0,
    duplicateCount: 0,
    companyDetails: [],
    duplicates: [],
    failures: [],
    missingFields: [],
    clientNotFound: [],
    skipped: [], // List of non-CRrows
  };

  // ✅ Fetch all existing excelTransactionIds once (better performance)
  const existingTransactions = await ClientpaymentCollection.find(
    {},
    "excelTransactionId",
  ).lean();
  // normalize existing ids to trimmed strings to avoid numeric/string mismatch
  const existingIds = new Set(
    existingTransactions.map((t) =>
      t && t.excelTransactionId !== undefined && t.excelTransactionId !== null
        ? String(t.excelTransactionId).trim()
        : "",
    ),
  );

  // ---------- Preload QstClient into memory for faster & flexible matching ----------
  const allClients = await QstClient.find(
    {},
    "_id companyName companyShortName",
  ).lean(); // load minimal fields

  // Build normalized map: normalizedName -> array of clients
  const clientMap = {};
  for (const c of allClients) {
    // index primary name
    const normName = normalizeCompanyName(c.companyName || "");
    if (normName) {
      if (!clientMap[normName]) clientMap[normName] = [];
      clientMap[normName].push(c);
    }

    // index short name if different
    const normShort = normalizeCompanyName(c.companyShortName || "");
    if (normShort && normShort !== normName) {
      if (!clientMap[normShort]) clientMap[normShort] = [];
      clientMap[normShort].push(c);
    }
  }

  // Also build a small flattened list of client normalized names for substring scanning
  const clientNormEntries = Object.entries(clientMap); // [ [normName, [clients...]], ... ]
  // -------------------------------------------------------------------------------

  function findClientByExtractedName(extractedName) {
    if (!extractedName) return { client: null, method: null };

    const normExtracted = normalizeCompanyName(extractedName);
    if (!normExtracted) return { client: null, method: null };

    const tokens = normExtracted.split(" ").filter(Boolean);

    // 1) Exact normalized match
    if (clientMap[normExtracted] && clientMap[normExtracted].length > 0) {
      return { client: clientMap[normExtracted][0], method: "exact" };
    }

    // 2) Prefer first-token match (but skip very short tokens like 1-2 chars)
    if (tokens.length > 0) {
      const first = tokens[0];
      if (first.length >= 3) {
        for (const [clientNorm, arr] of clientNormEntries) {
          if (
            new RegExp(`\\b${escapeRegExp(first)}\\b`, "i").test(clientNorm)
          ) {
            return { client: arr[0], method: "firstToken" };
          }
        }
      }
    }

    // 3) Try any token match (longer tokens only) - Use word boundaries to avoid partial matches
    for (const t of tokens.filter((t) => t.length >= 3)) {
      for (const [clientNorm, arr] of clientNormEntries) {
        if (new RegExp(`\\b${escapeRegExp(t)}\\b`, "i").test(clientNorm)) {
          return { client: arr[0], method: "token" };
        }
      }
    }

    // 4) Substring fallback: only if the match is significant (e.g. at least 4 chars and a word boundary)
    for (const [clientNorm, arr] of clientNormEntries) {
      if (!clientNorm || clientNorm.length < 3) continue;
      if (
        new RegExp(`\\b${escapeRegExp(clientNorm)}\\b`, "i").test(normExtracted)
      ) {
        return { client: arr[0], method: "substring" };
      }
    }

    // no match
    return { client: null, method: null };
  }

  for (let index = 0; index < dataRows.length; index++) {
    const rowData = dataRows[index];
    const rowNum = index + headerIndex + 2;
    try {
      // Map array to object based on headers
      const row = {};
      headers.forEach((header, i) => {
        row[header] = rowData[i];
      });

      // Determine transaction type based on format (old: Cr/Dr column, new: Withdrawals/Deposits)
      let transactionType;
      let crDrKey = null;
      if (isNewFormat) {
        const withdrawalKey = headers.find(k => k.toLowerCase().includes("withdrawal"));
        const depositKey = headers.find(k => k.toLowerCase().includes("deposit"));
        const withdrawalVal = parseFloat(row[withdrawalKey]) || 0;
        const depositVal = parseFloat(row[depositKey]) || 0;
        transactionType = depositVal > 0 ? "CR" : (withdrawalVal > 0 ? "DR" : "");
      } else {
        crDrKey = headers.find(k => k.toLowerCase().includes("cr/dr") || k.toLowerCase().includes("type"));
        transactionType = String(row[crDrKey] || "").trim().toUpperCase();
      }

      // ✅ Only process CR records
      if (transactionType !== "CR") {
        report.skippedCount++;
        report.skipped.push({
          row: rowNum,
          reason: `Skipped because this is a ${transactionType || 'UNKNOWN'} transaction (Client Collection requires CR)`,
          data: { transactionType },
        });
        continue;
      }

      report.crRowsCount++;

      const descKey = headers.find(k => k.toLowerCase() === "description" || k.toLowerCase() === "remarks") || "Description";
      const txIdKey = headers.find(k => k.toLowerCase().includes("transaction id") || k.toLowerCase().includes("tran id")) || "Transaction ID";
      const amountKey = isNewFormat
        ? headers.find(k => k.toLowerCase().includes("deposit"))
        : (headers.find(k => k.toLowerCase().includes("transaction amount")) || "Transaction Amount(INR)");
      const dateKey = headers.find(k => k.toLowerCase().includes("txn posted date") || k.toLowerCase().includes("posted date") || k.toLowerCase() === "date") || "Txn Posted Date";

      const description = row[descKey] || "";
      const companyName = extractCompanyName(description);
      console.log("com", companyName);
      const exceltransactionid = row[txIdKey] || null;

      // ✅ Check for missing required fields
      const requiredFields = [
        descKey,
        txIdKey,
        amountKey,
        dateKey,
        crDrKey,
      ].filter(Boolean);

      // find missing ones in this row
      const missing = requiredFields.filter((fieldKey) => {
        const val = row[fieldKey];
        return val === undefined || val === null || String(val).trim() === "";
      });

      if (missing.length > 0) {
        report.failedCount++;
        report.missingFields.push({
          row: rowNum,
          reason: "Missing required field(s) for CR row",
          missingFields: missing,
          data: {
            Description: description,
            companyName: companyName,
            TransactionID: exceltransactionid,
            TransactionAmount: row[amountKey],
            TxnPostedDate: row[dateKey],
            CrOrDr: transactionType,
          },
        });
        continue;
      }

      // ✅ Duplicate check (normalize exceltransactionid to string)
      const normalizedExcelTxnId =
        exceltransactionid !== null && exceltransactionid !== undefined
          ? String(exceltransactionid).trim()
          : "";
      if (existingIds.has(normalizedExcelTxnId)) {
        report.duplicateCount++;
        report.duplicates.push({
          row: rowNum,
          reason: "Duplicate Transaction ID - Skipped",
          data: {
            exceltransactionid: normalizedExcelTxnId,
            description,
            companyName,
          },
        });
        continue;
      }

      if (!companyName) {
        report.failedCount++;
        report.failures.push({
          row: rowNum,
          reason: "Company name could not be extracted",
          data: { description },
        });
        continue;
      }

      // ✅ Parse Txn Posted Date
      const txnPostedDateRaw = row[dateKey];
      const txnPostedDate = parseExcelDateCollection(txnPostedDateRaw);

      if (!txnPostedDate) {
        report.failedCount++;
        report.failures.push({
          row: rowNum,
          reason: "Invalid Txn Posted Date",
          data: { txnPostedDateRaw },
        });
        continue;
      }

      console.log("txnPostedDate", txnPostedDate);

      // ✅ Find matching QstClient in DB
      const { client, method: matchMethod } =
        findClientByExtractedName(companyName);

      const transactionAmount = row[amountKey] || null;

      // ✅ Save to DB even if client is not found
      await ClientpaymentCollection.create({
        description,
        transaction_posted_date: txnPostedDate,
        transaction_amount: transactionAmount,
        excelTransactionId: normalizedExcelTxnId,
        qstClient: client ? client._id : null,
        matchedCompanyName: client ? client.companyName : companyName,
        matchMethod: client ? matchMethod : null,
        // companyName: companyName || "",        // <-- empty if not found or UPI
        // availableBalance,
      });

      existingIds.add(normalizedExcelTxnId); // ✅ Update in-memory set
      report.successCount++;
      report.companyDetails.push({
        row: rowNum,
        companyName: companyName || "",
        transactionAmount,
        txnPostedDate,
        client: client ? client._id : null,
        matchMethod: client ? matchMethod : null,
      });

      // ✅ If no client found, log it for reporting (but still saved above)
      if (!client) {
        report.clientNotFound.push({
          row: rowNum,
          reason: companyName
            ? "Company not found in QstClient"
            : "UPI transaction (no company name)",
          data: {
            companyName: companyName || "",
            transactionAmount,
            txnPostedDate,
            matchMethod: matchMethod || null,
          },
        });
      }
    } catch (error) {
      report.failedCount++;
      report.failures.push({
        row: rowNum,
        reason: "Unexpected processing error",
        error: error.message,
        data: rowData,
      });
    }
  }
  //  console.log("userid",userId);

  await TransactionReport.create({
    reportType: "Client_Payment_Collection", // or DR if processing DR file
    data: report,
    generatedBy: userId,
  });

  return report;
};

// Controller
const processPaymentsCRForCollection = async (req, res) => {
  paymentFileUpload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: "File upload failed",
        error: err.message,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    try {
      const report = await processPaymentFileForCollection(
        req.file.buffer,
        req.user?._id,
      );

      return res.json({
        success: true,
        message: "CR transactions processed successfully",
        report,
      });
    } catch (error) {
      console.error("Error processing file:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  });
};

// const getClientPaymentsCollectionData = async (req, res) => {
//   try {
//     const payments = await ClientpaymentCollection.find()
//       .populate("qstClient") // ✅ populate qstClient details
//       .sort({ createdAt: -1 }); // latest first

//     res.status(200).json({
//       success: true,
//       count: payments.length,
//       data: payments,
//     });
//   } catch (error) {
//     console.error("Error fetching client payments:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to fetch client payments",
//     });
//   }
// };

// Process single technician payment

const getClientPaymentsCollectionData = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";

    // ===============================
    // UTC DATE RANGES (BANK TIME AS-IS)
    // ===============================
    const now = new Date();

    const thisMonthStartUTC = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
    );

    const todayEndUTC = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );

    const lastMonthStartUTC = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0),
    );

    const lastMonthEndUTC = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999),
    );

    const lastMonthTillDateEndUTC = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() - 1,
        now.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );

    // ===============================
    // SEARCH FILTER
    // ===============================
    const searchFilter = search
      ? {
        $or: [
          { description: { $regex: search, $options: "i" } },
          { excelTransactionId: { $regex: search, $options: "i" } },
          { invoiceNo: { $regex: search, $options: "i" } },
          { transaction_amount: { $regex: search, $options: "i" } },
          { "qstClient.companyName": { $regex: search, $options: "i" } },
          { "qstClient.companyShortName": { $regex: search, $options: "i" } },
        ],
      }
      : {};

    // Exclude only internal / self credits where QUIK SERV (or Nikhil) is the remitter.
    // Do NOT blanket-match "QUIK SERV" anywhere — NEFT client payments often include
    // "QUIK SERV" as the beneficiary/remark (e.g. Covert Eye, Bhipra), which incorrectly
    // hid those rows from Client Payment Collection after a successful upload.
    const exclusionFilter = {
      $nor: [
        { description: { $regex: "NIKHIL\\s+NAIK\\s+N", $options: "i" } },
        // IMPS/UPI/BIL style: remitter segment after a slash
        { description: { $regex: "/\\s*QUIK\\s*SERV", $options: "i" } },
        { description: { $regex: "/\\s*QUIKSERV\\b", $options: "i" } },
        // NEFT/RTGS with dash separator (old quikServ format) where the remitter is Quik Serv itself
        {
          description: {
            $regex: "^(NEFT|RTGS)-[^-]+-QUIK\\s*SERV",
            $options: "i",
          },
        },
        {
          description: {
            $regex: "^(NEFT|RTGS)-[^-]+-QUIKSERV\\b",
            $options: "i",
          },
        },
        // NEFT/RTGS with colon separator (new algoCRM format) where the remitter is Quik Serv / Algo
        {
          description: {
            $regex: "^(NEFT|RTGS):QUIK\\s*SERV",
            $options: "i",
          },
        },
        {
          description: {
            $regex: "^(NEFT|RTGS):ALGO\\s*MATRIX",
            $options: "i",
          },
        },
      ],
    };

    // AGGREGATION PIPELINE
    // ===============================
    const pipeline = [
      // ===============================
      // JOIN QstClient
      // ===============================
      {
        $lookup: {
          from: "qstclients",
          localField: "qstClient",
          foreignField: "_id",
          as: "qstClient",
        },
      },
      {
        $unwind: {
          path: "$qstClient",
          preserveNullAndEmptyArrays: true,
        },
      },

      // ===============================
      // JOIN INVOICE (SAFE VERSION)
      // ===============================
      {
        $lookup: {
          from: "salesregistersamples",
          let: {
            invNoSafe: {
              $cond: {
                if: { $isArray: "$invoiceNo" },
                then: "$invoiceNo",
                else: [
                  {
                    $convert: {
                      input: "$invoiceNo",
                      to: "string",
                      onError: null,
                      onNull: null,
                    },
                  },
                ],
              },
            },
            invDateSafe: {
              $cond: {
                if: { $isArray: "$invoiceDate" },
                then: { $arrayElemAt: ["$invoiceDate", 0] },
                else: "$invoiceDate",
              },
            },
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    {
                      $in: [
                        {
                          $convert: {
                            input: "$invoiceNo",
                            to: "string",
                            onError: null,
                            onNull: null,
                          },
                        },
                        "$$invNoSafe",
                      ],
                    },
                    {
                      $cond: {
                        if: { $ne: ["$$invDateSafe", null] },
                        then: {
                          $eq: ["$invoiceDate", "$$invDateSafe"],
                        },
                        else: true,
                      },
                    },
                  ],
                },
              },
            },
            {
              $project: {
                totalRevenue: 1,
                grossTotal: 1,
                invoiceDate: 1,
              },
            },
          ],
          as: "invoice",
        },
      },
      // ===============================
      // SAFE CALCULATED FIELDS
      // ===============================
      {
        $addFields: {
          invoiceTotal: {
            $sum: {
              $map: {
                input: "$invoice",
                as: "inv",
                in: { $ifNull: ["$$inv.totalRevenue", "$$inv.grossTotal", 0] },
              },
            },
          },
          amountPaid: {
            $ifNull: ["$paymentDetails.amountPaid", null],
          },
        },
      },

      // ===============================
      // FILTERS
      // ===============================
      { $match: exclusionFilter },
      { $match: searchFilter },

      // ===============================
      // FACET: PAGINATION + TOTALS
      // ===============================
      {
        $facet: {
          paginatedResults: [
            { $sort: { transaction_posted_date: -1 } },
            { $skip: (page - 1) * limit },
            { $limit: limit },
          ],
          totalCount: [{ $count: "count" }],
          thisMonthTillDate: [
            {
              $match: {
                transaction_posted_date: {
                  $gte: thisMonthStartUTC,
                  $lte: todayEndUTC,
                },
              },
            },
            {
              $group: {
                _id: null,
                total: {
                  $sum: {
                    $convert: {
                      input: "$transaction_amount",
                      to: "double",
                      onError: 0,
                      onNull: 0,
                    },
                  },
                },
              },
            },
          ],
          fullLastMonth: [
            {
              $match: {
                transaction_posted_date: {
                  $gte: lastMonthStartUTC,
                  $lte: lastMonthEndUTC,
                },
              },
            },
            {
              $group: {
                _id: null,
                total: {
                  $sum: {
                    $convert: {
                      input: "$transaction_amount",
                      to: "double",
                      onError: 0,
                      onNull: 0,
                    },
                  },
                },
              },
            },
          ],
          lastMonthTillDate: [
            {
              $match: {
                transaction_posted_date: {
                  $gte: lastMonthStartUTC,
                  $lte: lastMonthTillDateEndUTC,
                },
              },
            },
            {
              $group: {
                _id: null,
                total: {
                  $sum: {
                    $convert: {
                      input: "$transaction_amount",
                      to: "double",
                      onError: 0,
                      onNull: 0,
                    },
                  },
                },
              },
            },
          ],
        },
      },
    ];

    const result = await ClientpaymentCollection.aggregate(pipeline);

    res.status(200).json({
      success: true,
      total: result[0].totalCount[0]?.count || 0,
      page,
      totalPages: Math.ceil((result[0].totalCount[0]?.count || 0) / limit),
      data: result[0].paginatedResults,
      collectionSummary: {
        thisMonthTillDate: result[0].thisMonthTillDate[0]?.total || 0,
        fullLastMonth: result[0].fullLastMonth[0]?.total || 0,
        lastMonthTillDate: result[0].lastMonthTillDate[0]?.total || 0,
      },
    });
  } catch (error) {
    console.error("Error fetching client payments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch client payments",
    });
  }
};

const processSingleTechnicianPayment = async (req, res) => {
  try {
    const { ticketSKUId, transactionDate } = req.body;

    // Validate required fields
    if (!ticketSKUId || !transactionDate) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: ticketSKUId and transactionDate are required",
      });
    }

    // Validate transaction date
    const parsedDate = new Date(transactionDate);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid transaction date format",
      });
    }

    // Find the ticket by SKU ID
    const ticket = await Ticket.findOne({ ticketSKUId });

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Ticket not found with the provided SKU ID",
        data: { ticketSKUId },
      });
    }

    // Check if payment is already marked as successful
    if (ticket.isTechnicianPaymentSuccess) {
      return res.status(409).json({
        success: false,
        message: "Payment already marked as successful for this ticket",
        data: {
          ticketSKUId,
          existingPaymentDate: ticket.isTechnicianPaymentSuccessDate,
        },
      });
    }

    // Update the ticket with payment information
    const updateData = {
      isTechnicianPaymentSuccess: true,
      isTechnicianPaymentSuccessDate: parsedDate,
      updatedAt: new Date(),
    };

    console.log("Updating ticket with data:", updateData);

    // // Add optional fields if provided
    // if (transactionId) updateData.technicianTransactionId = transactionId;
    // if (amount) updateData.technicianPaymentAmount = amount;
    // if (paymentMethod) updateData.technicianPaymentMethod = paymentMethod;
    // if (notes) updateData.technicianPaymentNotes = notes;

    const updatedTicket = await Ticket.findByIdAndUpdate(
      ticket._id,
      updateData,
      { new: true, runValidators: true },
    );

    res.json({
      success: true,
      message: "Payment successfully processed",
      data: {
        ticketSKUId: updatedTicket.ticketSKUId,
        transactionDate: updatedTicket.isTechnicianPaymentSuccessDate,
      },
    });
  } catch (error) {
    console.error("Single payment processing error:", error);
    res.status(500).json({
      success: false,
      message: "Payment processing failed",
      error: error.message,
      timestamp: new Date(),
    });
  }
};

const updateClientPayment = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment ID",
      });
    }

    // const { invoiceDate, invoiceNo, qstClient } = req.body;
    const { invoiceDate, invoiceNo, qstClient, paymentDetails } = req.body;

    // 🔎 Fetch current document first
    const existingPayment = await ClientpaymentCollection.findById(id);
    if (!existingPayment) {
      return res.status(404).json({
        success: false,
        message: "Client Payment not found",
      });
    }

    // Build update data
    const updateData = {};

    // Handle multiple invoice dates
    if (invoiceDate) {
      if (Array.isArray(invoiceDate)) {
        updateData.invoiceDate = invoiceDate.map((d) => new Date(d));
      } else {
        updateData.invoiceDate = [new Date(invoiceDate)];
      }
    }

    if (paymentDetails) {
      updateData.paymentDetails = {
        ...(existingPayment.paymentDetails || {}),
        ...paymentDetails,
      };
    }

    // Handle multiple invoice numbers
    if (invoiceNo !== undefined) {
      if (Array.isArray(invoiceNo)) {
        updateData.invoiceNo = invoiceNo.map((n) => String(n));
      } else {
        updateData.invoiceNo = [String(invoiceNo)];
      }
    }

    // ✅ Allow updating qstClient even if already present (to fix wrong mappings)
    if (qstClient !== undefined) {
      updateData.qstClient = qstClient;
      updateData.matchMethod = "manual"; // Mark as manual so Sync Mappings skips it
    }

    const updatedPayment = await ClientpaymentCollection.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true },
    );

    return res.json({
      success: true,
      message: "Client Payment updated successfully",
      data: updatedPayment,
    });
  } catch (error) {
    console.error("PATCH Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const getAllFullyClosedTicketPendingTechPay = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const skip = (page - 1) * parseInt(limit);

    // Build query filters
    let filters = [
      {
        isTicketClosed: true,
        ticketStatus: "work done",
        isTechnicianPaymentSuccess: false,
      },
    ];

    // Filter tickets based on user role
    if (req.user.role === "cse") {
      filters.push({
        $or: [{ assignee: req.user._id }, { creator: req.user._id }],
      });
    }

    // Add search functionality if search parameter is provided
    if (search) {
      let objectIdMatch = null;
      if (mongoose.Types.ObjectId.isValid(search.trim())) {
        objectIdMatch = new mongoose.Types.ObjectId(search.trim());
      }

      if (objectIdMatch) {
        filters.push({ _id: objectIdMatch });
      } else {
        filters.push({
          $or: [
            {
              "qstClientName.companyShortName": {
                $regex: search,
                $options: "i",
              },
            },
            { location: { $regex: search, $options: "i" } },
            { "taskType.taskName": { $regex: search, $options: "i" } },
            { "technician.technicianName": { $regex: search, $options: "i" } },
            { "assignee.employeeName": { $regex: search, $options: "i" } },
            { ticketSKUId: { $regex: search, $options: "i" } },
          ],
        });
      }
    }

    const query = { $and: filters };

    // Find tickets with pagination
    const pendingPaymentTickets = await Ticket.find(query)
      .populate("qstClientName", "companyName companyShortName") // Populate client details
      .populate("taskType", "taskName") // Populate task type
      .populate("technician", "technicianName name") // Populate technician details
      .populate("assignee", "employeeName name") // Populate assignee details
      .populate("creator", "employeeName name") // Populate creator details
      .sort({ createdAt: -1 }) // Sort by creation date (newest first)
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const totalCount = await Ticket.countDocuments(query);

    // Return the found tickets
    res.status(200).json({
      success: true,
      count: pendingPaymentTickets.length,
      totalCount: totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
      data: pendingPaymentTickets,
    });
  } catch (error) {
    console.error("Error fetching pending technician payment tickets:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch pending technician payment tickets",
      error: error.message,
    });
  }
};

const getAllFullyClosedTicketSucessTechPay = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const skip = (page - 1) * parseInt(limit);

    // Build query filters
    let filters = [
      {
        isTicketClosed: true,
        ticketStatus: "work done",
        isTechnicianPaymentSuccess: true,
      },
    ];

    // Filter tickets based on user role
    if (req.user.role === "cse") {
      filters.push({
        $or: [{ assignee: req.user._id }, { creator: req.user._id }],
      });
    }

    // Add search functionality if search parameter is provided
    if (search) {
      let objectIdMatch = null;
      if (mongoose.Types.ObjectId.isValid(search.trim())) {
        objectIdMatch = new mongoose.Types.ObjectId(search.trim());
      }

      if (objectIdMatch) {
        filters.push({ _id: objectIdMatch });
      } else {
        filters.push({
          $or: [
            {
              "qstClientName.companyShortName": {
                $regex: search,
                $options: "i",
              },
            },
            { location: { $regex: search, $options: "i" } },
            { "taskType.taskName": { $regex: search, $options: "i" } },
            { "technician.technicianName": { $regex: search, $options: "i" } },
            { "assignee.employeeName": { $regex: search, $options: "i" } },
            { ticketSKUId: { $regex: search, $options: "i" } },
          ],
        });
      }
    }

    const query = { $and: filters };

    // Find tickets with pagination
    const pendingPaymentTickets = await Ticket.find(query)
      .populate("qstClientName", "companyName companyShortName") // Populate client details
      .populate("taskType", "taskName") // Populate task type
      .populate("technician", "technicianName name") // Populate technician details
      .populate("assignee", "employeeName name") // Populate assignee details
      .populate("creator", "employeeName name") // Populate creator details
      .sort({ createdAt: -1 }) // Sort by creation date (newest first)
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const totalCount = await Ticket.countDocuments(query);

    // Return the found tickets
    res.status(200).json({
      success: true,
      count: pendingPaymentTickets.length,
      totalCount: totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
      data: pendingPaymentTickets,
    });
  } catch (error) {
    console.error("Error fetching pending technician payment tickets:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch pending technician payment tickets",
      error: error.message,
    });
  }
};

// [[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]

// // Multer Configuration for Sales Register Upload
// const salesRegisterUpload = multer({
//   storage: multer.memoryStorage(),
//   fileFilter: (req, file, cb) => {
//     const allowedMimes = [
//       "application/vnd.ms-excel",
//       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
//     ];

//     if (allowedMimes.includes(file.mimetype)) {
//       cb(null, true);
//     } else {
//       cb(new Error("Invalid file type. Only Excel files are allowed."));
//     }
//   },
//   limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
// }).single("salesRegisterFile");

// // Date parsing function for Sales Register
// const parseSalesRegisterDate = (dateValue) => {
//   if (!dateValue) return null;

//   // If it's already a Date
//   if (dateValue instanceof Date && !isNaN(dateValue)) {
//     return dateValue;
//   }

//   // If it's a string in YYYY-MM-DD HH:mm:ss format (from your sample)
//   if (typeof dateValue === "string") {
//     try {
//       // Handle both formats: "2025-04-02 00:00:00" and possible other formats
//       const trimmed = dateValue.trim();

//       // Try YYYY-MM-DD HH:mm:ss format first
//       if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
//         const parsed = parse(trimmed, "yyyy-MM-dd HH:mm:ss", new Date());
//         const converted = fromZonedTime(parsed, "Asia/Kolkata");
//         if (!isNaN(parsed)) return converted;
//       }

//       // Try other common formats if needed
//       // Add more format attempts here if your data has variations

//     } catch (error) {
//       console.error("Date parsing error:", error);
//       return null;
//     }
//   }

//   // If it's a number (Excel serial date)
//   if (typeof dateValue === "number") {
//     const parsed = XLSX.SSF.parse_date_code(dateValue);
//     if (parsed) {
//       const jsDate = new Date(
//         parsed.y,
//         parsed.m - 1,
//         parsed.d,
//         parsed.H || 0,
//         parsed.M || 0,
//         parsed.S || 0
//       );
//       return jsDate;
//     }
//   }

//   return null;
// };

// // Helper function to clean and convert numeric values
// const cleanNumber = (value) => {
//   if (value === null || value === undefined || value === "") return 0;
//   if (typeof value === "number") return value;
//   if (typeof value === "string") {
//     // Remove any non-numeric characters except decimal point and minus sign
//     const cleaned = value.replace(/[^\d.-]/g, "");
//     const num = parseFloat(cleaned);
//     return isNaN(num) ? 0 : num;
//   }
//   return 0;
// };

// // Helper function to clean string values
// const cleanString = (value) => {
//   if (value === null || value === undefined) return "";
//   return String(value).trim();
// };

// // Main function to process Sales Register Excel file
// const processSalesRegisterFile = async (fileBuffer, fileName, uploadedBy = null) => {
//   const workbook = XLSX.read(fileBuffer, { type: "buffer" });
//   const sheetName = workbook.SheetNames[0];
//   const worksheet = workbook.Sheets[sheetName];

//   // Get the raw data as array of arrays to understand structure
//   const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

//   // Find the row that contains the actual headers (skip metadata rows)
//   let headerRowIndex = 0;
//   for (let i = 0; i < rawData.length; i++) {
//     if (rawData[i] && rawData[i].length > 0 &&
//         String(rawData[i][0]).toLowerCase().includes('date')) {
//       headerRowIndex = i;
//       break;
//     }
//   }

//   // Get data starting from header row
//   const data = XLSX.utils.sheet_to_json(worksheet, { range: headerRowIndex });

//   const report = {
//     totalRows: data.length,
//     successCount: 0,
//     failedCount: 0,
//     failures: [],
//     skippedCount: 0,
//     skipped: [],
//   };

//   const bulkOps = [];
//   const now = new Date();

//   // Map your column headers to database fields
//   const columnMapping = {
//     'Date': 'invoiceDate',
//     'Particulars': 'companyName',
//     'Voucher Type': 'voucherType',
//     'Voucher No.': 'invoiceNo',
//     'GSTIN/UIN': 'gstinUin',
//     'Gross Total': 'grossTotal',
//     'INSTALLATION AND SERVICE CHARGES': 'installationAndServiceCharges',
//     'OUTPUT IGST 18 %': 'outputIGST18',
//     'Courier Services': 'courierServices',
//     'OUTPUT CGST 9%': 'outputCGST9',
//     'OUTPUT SGST 9%': 'outputSGST9',
//     'Dedicated Telecaller for the Month of March 2025': 'dedicatedTelecallerMonth1',
//     'Dedicated Telecaller for the Month of April 2025': 'dedicatedTelecallerMonth2',
//     'Discount': 'discount',
//     'ACCOMMODATION & FOOD SERVICES': 'accommodationAndFoodServices',
//     'Service done on 1st and 2nd July 2500 per day': 'serviceDoneOn1stAnd2nd',
//     'CAMPGN-RETROFT-EXPTRANSPORTATION-CHGS': 'campaignRetrofitTransportCharges',
//     'Total Revenue (this calculation has to be done in software)': 'totalRevenue'
//   };

//   data.forEach((row, index) => {
//     try {
//       const rowNum = index + headerRowIndex + 1;

//       // Skip empty rows or rows without essential data
//       if (!row['Date'] && !row['Particulars'] && !row['Voucher No.']) {
//         report.skippedCount++;
//         report.skipped.push({
//           row: rowNum,
//           reason: "Empty row or missing essential data",
//           data: row
//         });
//         return;
//       }

//       // Prepare document for database
//       const document = {
//         invoiceDate: parseSalesRegisterDate(row['Date']),
//         companyName: cleanString(row['Particulars']),
//         voucherType: cleanString(row['Voucher Type']),
//         invoiceNo: cleanString(row['Voucher No.']),
//         gstinUin: cleanString(row['GSTIN/UIN']),
//         grossTotal: cleanNumber(row['Gross Total']),
//         installationAndServiceCharges: cleanNumber(row['INSTALLATION AND SERVICE CHARGES']),
//         outputIGST18: cleanNumber(row['OUTPUT IGST 18 %']),
//         courierServices: cleanNumber(row['Courier Services']),
//         outputCGST9: cleanNumber(row['OUTPUT CGST 9%']),
//         outputSGST9: cleanNumber(row['OUTPUT SGST 9%']),
//         dedicatedTelecallerMonth1: cleanString(row['Dedicated Telecaller for the Month of March 2025']),
//         dedicatedTelecallerMonth2: cleanString(row['Dedicated Telecaller for the Month of April 2025']),
//         discount: cleanNumber(row['Discount']),
//         accommodationAndFoodServices: cleanNumber(row['ACCOMMODATION & FOOD SERVICES']),
//         serviceDoneOn1stAnd2nd: cleanNumber(row['Service done on 1st and 2nd July 2500 per day']),
//         campaignRetrofitTransportCharges: cleanNumber(row['CAMPGN-RETROFT-EXPTRANSPORTATION-CHGS']),
//         totalRevenue: cleanNumber(row['Total Revenue (this calculation has to be done in software)']),

//         // Metadata
//         uploadedAt: now,
//         uploadedBy: uploadedBy,
//         sourceFileName: fileName
//       };

//       // Validate essential fields
//       if (!document.invoiceDate || !document.invoiceNo) {
//         report.failedCount++;
//         report.failures.push({
//           row: rowNum,
//           reason: "Missing required fields (invoiceDate or invoiceNo)",
//           data: document
//         });
//         return;
//       }

//       // Create bulk operation for upsert (update if exists, insert if new)
//       bulkOps.push({
//         updateOne: {
//           filter: {
//             invoiceNo: document.invoiceNo,
//             invoiceDate: document.invoiceDate,
//             gstinUin: document.gstinUin
//           },
//           update: { $set: document },
//           upsert: true
//         }
//       });

//     } catch (error) {
//       report.failedCount++;
//       report.failures.push({
//         row: index + headerRowIndex + 1,
//         reason: "Unexpected processing error",
//         error: error.message,
//         data: row
//       });
//     }
//   });

//   // Execute bulk operations
//   if (bulkOps.length > 0) {
//     try {
//       const result = await SalesRegisterSample.bulkWrite(bulkOps, {
//         ordered: false,
//         writeConcern: { w: "majority" }
//       });

//       report.successCount = (result.upsertedCount || 0) + (result.modifiedCount || 0);
//       report.skippedCount = bulkOps.length - report.successCount;

//     } catch (error) {
//       throw new Error(`Bulk write failed: ${error.message}`);
//     }
//   }

//   return report;
// };

// // Controller function to handle Sales Register upload
// const uploadSalesRegister = async (req, res) => {
//   salesRegisterUpload(req, res, async (err) => {
//     // Handle upload errors
//     if (err) {
//       return res.status(400).json({
//         success: false,
//         message: "File upload failed",
//         error: err.message
//       });
//     }

//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: "No file uploaded"
//       });
//     }

//     try {
//       // Get uploaded by user ID from request (if available)
//       const uploadedBy = req.user ? req.user._id : null;

//       const report = await processSalesRegisterFile(
//         req.file.buffer,
//         req.file.originalname,
//         uploadedBy
//       );

//       // Prepare success response
//       const response = {
//         success: true,
//         message: "Sales Register processing completed",
//         report: {
//           summary: {
//             totalRecords: report.totalRows,
//             successfulRecords: report.successCount,
//             failedRecords: report.failedCount,
//             skippedRecords: report.skippedCount,
//             processedDate: new Date(),
//           },
//           details: {
//             failures: report.failures.slice(0, 50), // Limit failures in response
//             skipped: report.skipped.slice(0, 50), // Limit skipped in response
//           },
//         },
//       };

//       // Add warning if there were failures
//       if (report.failedCount > 0 || report.skippedCount > 0) {
//         response.warning = "Some records were not processed. Check details.";
//       }

//       res.json(response);

//     } catch (error) {
//       console.error("Sales Register processing error:", error);
//       res.status(500).json({
//         success: false,
//         message: "Sales Register processing failed",
//         error: error.message,
//         timestamp: new Date(),
//       });
//     }
//   });
// };

// // Multer Configuration for Sales Register Upload
// const salesRegisterUpload = multer({
//   storage: multer.memoryStorage(),
//   fileFilter: (req, file, cb) => {
//     const allowedMimes = [
//       "application/vnd.ms-excel",
//       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
//     ];

//     if (allowedMimes.includes(file.mimetype)) {
//       cb(null, true);
//     } else {
//       cb(new Error("Invalid file type. Only Excel files are allowed."));
//     }
//   },
//   limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
// }).single("salesRegisterFile");

// // Date parsing function for Sales Register
// const parseSalesRegisterDate = (dateValue) => {
//   if (!dateValue) return null;

//   if (dateValue instanceof Date && !isNaN(dateValue)) {
//     return dateValue;
//   }

//   if (typeof dateValue === "string") {
//     try {
//       const trimmed = dateValue.trim();
//       if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
//         const parsed = parse(trimmed, "yyyy-MM-dd HH:mm:ss", new Date());
//         const converted = fromZonedTime(parsed, "Asia/Kolkata");
//         if (!isNaN(parsed)) return converted;
//       }
//     } catch (error) {
//       console.error("Date parsing error:", error);
//       return null;
//     }
//   }

//   if (typeof dateValue === "number") {
//     const parsed = XLSX.SSF.parse_date_code(dateValue);
//     if (parsed) {
//       return new Date(
//         parsed.y,
//         parsed.m - 1,
//         parsed.d,
//         parsed.H || 0,
//         parsed.M || 0,
//         parsed.S || 0
//       );
//     }
//   }

//   return null;
// };

// // Helper function to clean and convert numeric values
// const cleanNumber = (value) => {
//   if (value === null || value === undefined || value === "" || value === " ") return 0;
//   if (typeof value === "number") return value;
//   if (typeof value === "string") {
//     const cleaned = value.replace(/[^\d.-]/g, "");
//     const num = parseFloat(cleaned);
//     return isNaN(num) ? 0 : num;
//   }
//   return 0;
// };

// // Helper function to clean string values
// const cleanString = (value) => {
//   if (value === null || value === undefined || value === "") return "";
//   return String(value).trim();
// };

// // Function to extract proper column headers from Excel
// const extractColumnHeaders = (worksheet) => {
//   const range = XLSX.utils.decode_range(worksheet['!ref']);
//   const headers = {};

//   // Look for the header row (usually row 1 or 2)
//   for (let row = range.s.r; row <= Math.min(range.e.r, 5); row++) {
//     const rowData = [];

//     for (let col = range.s.c; col <= range.e.c; col++) {
//       const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
//       const cell = worksheet[cellAddress];
//       const value = cell ? cell.v : '';
//       rowData.push(value);
//     }

//     // Check if this row contains meaningful headers (not empty)
//     const meaningfulHeaders = rowData.filter(val =>
//       val && String(val).trim().length > 0 &&
//       !String(val).match(/^(__EMPTY|A(_\d+)?)$/)
//     );

//     if (meaningfulHeaders.length > 5) { // If we found enough headers
//       // Map column indices to header names
//       rowData.forEach((header, index) => {
//         if (header && String(header).trim().length > 0) {
//           const colLetter = XLSX.utils.encode_col(index);
//           headers[colLetter] = String(header).trim();
//         }
//       });
//       break;
//     }
//   }

//   return headers;
// };

// // Function to map Excel data to proper field names
// const mapRowData = (row, headers, columnMapping) => {
//   const mappedData = {};

//   Object.keys(row).forEach(key => {
//     let columnName = '';

//     // If key is a letter (like 'A', 'B', etc.), use our header mapping
//     if (key.match(/^[A-Z]+$/)) {
//       columnName = headers[key] || key;
//     }
//     // If key is __EMPTY_X, try to find the corresponding column
//     else if (key.startsWith('__EMPTY')) {
//       // This is tricky - we need to infer the column based on position
//       // For now, we'll skip these or try to map them logically
//       return;
//     }
//     else {
//       columnName = key;
//     }

//     // Map to database field name
//     const dbFieldName = columnMapping[columnName];
//     if (dbFieldName) {
//       mappedData[dbFieldName] = row[key];
//     } else {
//       // Keep the original column name if no mapping found
//       mappedData[columnName] = row[key];
//     }
//   });

//   return mappedData;
// };

// // Main function to process Sales Register Excel file
// const processSalesRegisterFile = async (fileBuffer, fileName, uploadedBy = null) => {
//   const workbook = XLSX.read(fileBuffer, { type: "buffer" });
//   const sheetName = workbook.SheetNames[0];
//   const worksheet = workbook.Sheets[sheetName];

//   // Extract proper column headers
//   const headers = extractColumnHeaders(worksheet);
//   console.log("Extracted headers:", headers);

//   // Get the data starting from row 2 (assuming row 1 is headers)
//   const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

//   // Find the actual data starting row (skip header rows)
//   let dataStartRow = 0;
//   for (let i = 0; i < Math.min(data.length, 5); i++) {
//     if (data[i] && data[i].length > 0 && data[i][0] instanceof Date) {
//       dataStartRow = i;
//       break;
//     }
//   }

//   // Convert to JSON with proper header handling
//   const jsonData = XLSX.utils.sheet_to_json(worksheet, {
//     range: dataStartRow,
//     defval: ""
//   });

//   console.log("Raw JSON data sample:", JSON.stringify(jsonData[0], null, 2));

//   const report = {
//     totalRows: jsonData.length,
//     successCount: 0,
//     failedCount: 0,
//     failures: [],
//     skippedCount: 0,
//     skipped: [],
//   };

//   const bulkOps = [];
//   const now = new Date();

//   // Column mapping based on your actual Excel structure
//   const columnMapping = {
//     'Date': 'invoiceDate',
//     'Particulars': 'companyName',
//     'Voucher Type': 'voucherType',
//     'Voucher No.': 'invoiceNo',
//     'GSTIN/UIN': 'gstinUin',
//     'Gross Total': 'grossTotal',
//     'INSTALLATION AND SERVICE CHARGES': 'installationAndServiceCharges',
//     'OUTPUT IGST 18 %': 'outputIGST18',
//     'Courier Services': 'courierServices',
//     'OUTPUT CGST 9%': 'outputCGST9',
//     'OUTPUT SGST 9%': 'outputSGST9',
//     'Dedicated Telecaller for the Month of March 2025': 'dedicatedTelecallerMonth1',
//     'Dedicated Telecaller for the Month of April 2025': 'dedicatedTelecallerMonth2',
//     'Discount': 'discount',
//     'ACCOMMODATION & FOOD SERVICES': 'accommodationAndFoodServices',
//     'Service done on 1st and 2nd July 2500 per day': 'serviceDoneOn1stAnd2nd',
//     'CAMPGN-RETROFT-EXPTRANSPORTATION-CHGS': 'campaignRetrofitTransportCharges',
//     'Total Revenue (this calculation has to be done in software)': 'totalRevenue'
//   };

//   // Alternative mapping for the actual Excel keys we're seeing
//   const actualExcelMapping = {
//     'Invoice date': 'invoiceDate',
//     '__EMPTY': 'companyName',  // Particulars
//     '__EMPTY_1': 'voucherType', // Voucher Type
//     'Invoice no.': 'invoiceNo', // Voucher No.
//     '__EMPTY_2': 'gstinUin', // GSTIN/UIN
//     '__EMPTY_3': 'grossTotal', // Gross Total
//     'A': 'installationAndServiceCharges', // INSTALLATION AND SERVICE CHARGES
//     '__EMPTY_4': 'outputIGST18', // OUTPUT IGST 18 %
//     'A_1': 'courierServices', // Courier Services
//     '__EMPTY_5': 'outputCGST9', // OUTPUT CGST 9%
//     '__EMPTY_6': 'outputSGST9', // OUTPUT SGST 9%
//     'A_2': 'dedicatedTelecallerMonth1', // Dedicated Telecaller March
//     'A_3': 'dedicatedTelecallerMonth2', // Dedicated Telecaller April
//     'A_4': 'discount', // Discount
//     'A ': 'accommodationAndFoodServices', // ACCOMMODATION & FOOD SERVICES
//     'A_5': 'serviceDoneOn1stAnd2nd', // Service done on 1st and 2nd July
//     'A_6': 'campaignRetrofitTransportCharges', // CAMPGN-RETROFT-EXPTRANSPORTATION-CHGS
//     '__EMPTY_7': 'totalRevenue' // Total Revenue
//   };

//   jsonData.forEach((row, index) => {
//     try {
//       const rowNum = index + dataStartRow + 1;

//       console.log(`Processing row ${rowNum}:`, JSON.stringify(row, null, 2));

//       // Skip empty rows
//       if (!row || Object.keys(row).length === 0) {
//         report.skippedCount++;
//         report.skipped.push({
//           row: rowNum,
//           reason: "Completely empty row",
//           data: {}
//         });
//         return;
//       }

//       // Prepare document using the actual Excel keys we're seeing
//       const document = {
//         invoiceDate: parseSalesRegisterDate(row['Invoice date'] || row['Date']),
//         companyName: cleanString(row['__EMPTY'] || row['Particulars']),
//         voucherType: cleanString(row['__EMPTY_1'] || row['Voucher Type']),
//         invoiceNo: cleanString(row['Invoice no.'] || row['Voucher No.']),
//         gstinUin: cleanString(row['__EMPTY_2'] || row['GSTIN/UIN']),
//         grossTotal: cleanNumber(row['__EMPTY_3'] || row['Gross Total']),
//         installationAndServiceCharges: cleanNumber(row['A'] || row['INSTALLATION AND SERVICE CHARGES']),
//         outputIGST18: cleanNumber(row['__EMPTY_4'] || row['OUTPUT IGST 18 %']),
//         courierServices: cleanNumber(row['A_1'] || row['Courier Services']),
//         outputCGST9: cleanNumber(row['__EMPTY_5'] || row['OUTPUT CGST 9%']),
//         outputSGST9: cleanNumber(row['__EMPTY_6'] || row['OUTPUT SGST 9%']),
//         dedicatedTelecallerMonth1: cleanString(row['A_2'] || row['Dedicated Telecaller for the Month of March 2025']),
//         dedicatedTelecallerMonth2: cleanString(row['A_3'] || row['Dedicated Telecaller for the Month of April 2025']),
//         discount: cleanNumber(row['A_4'] || row['Discount']),
//         accommodationAndFoodServices: cleanNumber(row['A '] || row['ACCOMMODATION & FOOD SERVICES']),
//         serviceDoneOn1stAnd2nd: cleanNumber(row['A_5'] || row['Service done on 1st and 2nd July 2500 per day']),
//         campaignRetrofitTransportCharges: cleanNumber(row['A_6'] || row['CAMPGN-RETROFT-EXPTRANSPORTATION-CHGS']),
//         totalRevenue: cleanNumber(row['__EMPTY_7'] || row['Total Revenue (this calculation has to be done in software)']),

//         // Set default values for empty fields based on schema
//         uploadedAt: now,
//         uploadedBy: uploadedBy,
//         sourceFileName: fileName
//       };

//       // Validate essential fields
//       if (!document.invoiceDate || !document.invoiceNo || !document.companyName) {
//         report.failedCount++;
//         report.failures.push({
//           row: rowNum,
//           reason: "Missing required fields (invoiceDate, invoiceNo, or companyName)",
//           data: row // Include the raw row data for debugging
//         });
//         return;
//       }

//       // Create bulk operation
//       bulkOps.push({
//         updateOne: {
//           filter: {
//             invoiceNo: document.invoiceNo,
//             invoiceDate: document.invoiceDate
//           },
//           update: { $set: document },
//           upsert: true
//         }
//       });

//     } catch (error) {
//       report.failedCount++;
//       report.failures.push({
//         row: index + dataStartRow + 1,
//         reason: "Unexpected processing error",
//         error: error.message,
//         data: row
//       });
//     }
//   });

//   // Execute bulk operations
//   if (bulkOps.length > 0) {
//     try {
//       const result = await SalesRegisterSample.bulkWrite(bulkOps, {
//         ordered: false,
//         writeConcern: { w: "majority" }
//       });

//       report.successCount = (result.upsertedCount || 0) + (result.modifiedCount || 0);
//       report.skippedCount = bulkOps.length - report.successCount;

//     } catch (error) {
//       throw new Error(`Bulk write failed: ${error.message}`);
//     }
//   }

//   return report;
// };

// // Controller function to handle Sales Register upload
// const uploadSalesRegister = async (req, res) => {
//   salesRegisterUpload(req, res, async (err) => {
//     if (err) {
//       return res.status(400).json({
//         success: false,
//         message: "File upload failed",
//         error: err.message
//       });
//     }

//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: "No file uploaded"
//       });
//     }

//     try {
//       const uploadedBy = req.user ? req.user._id : null;

//       const report = await processSalesRegisterFile(
//         req.file.buffer,
//         req.file.originalname,
//         uploadedBy
//       );

//       const response = {
//         success: true,
//         message: "Sales Register processing completed",
//         report: {
//           summary: {
//             totalRecords: report.totalRows,
//             successfulRecords: report.successCount,
//             failedRecords: report.failedCount,
//             skippedRecords: report.skippedCount,
//             processedDate: new Date(),
//           },
//           details: {
//             failures: report.failures,
//             skipped: report.skipped,
//           },
//         },
//       };

//       if (report.failedCount > 0 || report.skippedCount > 0) {
//         response.warning = "Some records were not processed. Check details.";
//       }

//       res.json(response);

//     } catch (error) {
//       console.error("Sales Register processing error:", error);
//       res.status(500).json({
//         success: false,
//         message: "Sales Register processing failed",
//         error: error.message,
//         timestamp: new Date(),
//       });
//     }
//   });
// };

// // Multer Configuration for Sales Register Upload
// const salesRegisterUpload = multer({
//   storage: multer.memoryStorage(),
//   fileFilter: (req, file, cb) => {
//     const allowedMimes = [
//       "application/vnd.ms-excel",
//       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
//     ];

//     if (allowedMimes.includes(file.mimetype)) {
//       cb(null, true);
//     } else {
//       cb(new Error("Invalid file type. Only Excel files are allowed."));
//     }
//   },
//   limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
// }).single("salesRegisterFile");

// // Date parsing function
// const parseSalesRegisterDate = (dateValue) => {
//   if (!dateValue) return null;

//   if (dateValue instanceof Date && !isNaN(dateValue)) {
//     return dateValue;
//   }

//   if (typeof dateValue === "string") {
//     try {
//       const trimmed = dateValue.trim();
//       if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
//         const parsed = parse(trimmed, "yyyy-MM-dd HH:mm:ss", new Date());
//         const converted = fromZonedTime(parsed, "Asia/Kolkata");
//         if (!isNaN(parsed)) return converted;
//       }
//     } catch (error) {
//       console.error("Date parsing error:", error);
//       return null;
//     }
//   }

//   if (typeof dateValue === "number") {
//     const parsed = XLSX.SSF.parse_date_code(dateValue);
//     if (parsed) {
//       return new Date(
//         parsed.y,
//         parsed.m - 1,
//         parsed.d,
//         parsed.H || 0,
//         parsed.M || 0,
//         parsed.S || 0
//       );
//     }
//   }

//   return null;
// };

// // Helper functions
// const cleanNumber = (value) => {
//   if (value === null || value === undefined || value === "" || value === " ") return 0;
//   if (typeof value === "number") return value;
//   if (typeof value === "string") {
//     const cleaned = value.replace(/[^\d.-]/g, "");
//     const num = parseFloat(cleaned);
//     return isNaN(num) ? 0 : num;
//   }
//   return 0;
// };

// const cleanString = (value) => {
//   if (value === null || value === undefined || value === "") return "";
//   return String(value).trim();
// };

// // Main function to process Sales Register Excel file
// const processSalesRegisterFile = async (fileBuffer, fileName, uploadedBy = null) => {
//   const workbook = XLSX.read(fileBuffer, { type: "buffer" });
//   const sheetName = workbook.SheetNames[0];
//   const worksheet = workbook.Sheets[sheetName];

//   // Get all data as array of arrays
//   const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

//   console.log("Raw data length:", rawData.length);
//   console.log("First few rows:", rawData.slice(0, 3));

//   const report = {
//     totalRows: rawData.length,
//     successCount: 0,
//     failedCount: 0,
//     failures: [],
//     skippedCount: 0,
//     skipped: [],
//     processedData: [] // This will contain all processed data with column names
//   };

//   const bulkOps = [];
//   const now = new Date();

//   // Find the header row (row that contains "Date" or "Invoice date")
//   let headerRowIndex = -1;
//   let headers = [];

//   for (let i = 0; i < Math.min(rawData.length, 10); i++) {
//     if (rawData[i] && rawData[i].length > 0) {
//       const firstCell = String(rawData[i][0]).toLowerCase();
//       if (firstCell.includes('date') || firstCell.includes('invoice')) {
//         headerRowIndex = i;
//         headers = rawData[i].map(h => String(h).trim());
//         break;
//       }
//     }
//   }

//   if (headerRowIndex === -1) {
//     throw new Error("Could not find header row in the Excel file");
//   }

//   console.log("Header row index:", headerRowIndex);
//   console.log("Headers found:", headers);

//   // Process data rows (skip header row)
//   for (let i = headerRowIndex + 1; i < rawData.length; i++) {
//     try {
//       const rowData = rawData[i];
//       const rowNum = i + 1;

//       // Skip empty rows
//       if (!rowData || rowData.length === 0 || rowData.every(cell => !cell)) {
//         report.skippedCount++;
//         report.skipped.push({
//           row: rowNum,
//           reason: "Empty row",
//           data: {}
//         });
//         continue;
//       }

//       // Create object with header names as keys
//       const rowObject = {};
//       headers.forEach((header, index) => {
//         if (header && header.trim() !== "") {
//           rowObject[header] = rowData[index] !== undefined ? rowData[index] : "";
//         }
//       });

//       console.log(`Row ${rowNum} data:`, rowObject);

//       // Map to database fields
//       const document = {
//         invoiceDate: parseSalesRegisterDate(rowObject['Date'] || rowObject['Invoice date']),
//         companyName: cleanString(rowObject['Particulars']),
//         voucherType: cleanString(rowObject['Voucher Type']),
//         invoiceNo: cleanString(rowObject['Voucher No.'] || rowObject['Invoice no.']),
//         gstinUin: cleanString(rowObject['GSTIN/UIN']),
//         grossTotal: cleanNumber(rowObject['Gross Total']),
//         installationAndServiceCharges: cleanNumber(rowObject['INSTALLATION AND SERVICE CHARGES']),
//         outputIGST18: cleanNumber(rowObject['OUTPUT IGST 18 %']),
//         courierServices: cleanNumber(rowObject['Courier Services']),
//         outputCGST9: cleanNumber(rowObject['OUTPUT CGST 9%']),
//         outputSGST9: cleanNumber(rowObject['OUTPUT SGST 9%']),
//         dedicatedTelecallerMonth1: cleanString(rowObject['Dedicated Telecaller for the Month of March 2025']),
//         dedicatedTelecallerMonth2: cleanString(rowObject['Dedicated Telecaller for the Month of April 2025']),
//         discount: cleanNumber(rowObject['Discount']),
//         accommodationAndFoodServices: cleanNumber(rowObject['ACCOMMODATION & FOOD SERVICES']),
//         serviceDoneOn1stAnd2nd: cleanNumber(rowObject['Service done on 1st and 2nd July 2500 per day']),
//         campaignRetrofitTransportCharges: cleanNumber(rowObject['CAMPGN-RETROFT-EXPTRANSPORTATION-CHGS']),
//         totalRevenue: cleanNumber(rowObject['Total Revenue (this calculation has to be done in software)']),

//         uploadedAt: now,
//         uploadedBy: uploadedBy,
//         sourceFileName: fileName
//       };

//       // Add to processed data for response
//       report.processedData.push({
//         row: rowNum,
//         data: document
//       });

//       // Validate essential fields
//       if (!document.invoiceDate || !document.invoiceNo || !document.companyName) {
//         report.failedCount++;
//         report.failures.push({
//           row: rowNum,
//           reason: "Missing required fields (invoiceDate, invoiceNo, or companyName)",
//           data: rowObject
//         });
//         continue;
//       }

//       // Create bulk operation
//       bulkOps.push({
//         updateOne: {
//           filter: {
//             invoiceNo: document.invoiceNo,
//             invoiceDate: document.invoiceDate
//           },
//           update: { $set: document },
//           upsert: true
//         }
//       });

//       report.successCount++;

//     } catch (error) {
//       report.failedCount++;
//       report.failures.push({
//         row: i + 1,
//         reason: "Unexpected processing error",
//         error: error.message,
//         data: rawData[i] || {}
//       });
//     }
//   }

//   // Execute bulk operations
//   if (bulkOps.length > 0) {
//     try {
//       const result = await SalesRegisterSample.bulkWrite(bulkOps, {
//         ordered: false,
//         writeConcern: { w: "majority" }
//       });

//       console.log("Bulk write result:", result);

//     } catch (error) {
//       throw new Error(`Bulk write failed: ${error.message}`);
//     }
//   }

//   return report;
// };

// // Controller function to handle Sales Register upload
// const uploadSalesRegister = async (req, res) => {
//   salesRegisterUpload(req, res, async (err) => {
//     if (err) {
//       return res.status(400).json({
//         success: false,
//         message: "File upload failed",
//         error: err.message
//       });
//     }

//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: "No file uploaded"
//       });
//     }

//     try {
//       const uploadedBy = req.user ? req.user._id : null;

//       const report = await processSalesRegisterFile(
//         req.file.buffer,
//         req.file.originalname,
//         uploadedBy
//       );

//       // Format response as you wanted - with actual data
//       const response = {
//         success: true,
//         message: "Sales Register processing completed",
//         report: {
//           summary: {
//             totalRecords: report.totalRows,
//             successfulRecords: report.successCount,
//             failedRecords: report.failedCount,
//             skippedRecords: report.skippedCount,
//             processedDate: new Date(),
//           },
//           data: report.processedData.map(item => ({
//             rowNumber: item.row,
//             ...item.data
//           })),
//           details: {
//             failures: report.failures,
//             skipped: report.skipped,
//           },
//         },
//       };

//       if (report.failedCount > 0 || report.skippedCount > 0) {
//         response.warning = "Some records were not processed. Check details.";
//       }

//       res.json(response);

//     } catch (error) {
//       console.error("Sales Register processing error:", error);
//       res.status(500).json({
//         success: false,
//         message: "Sales Register processing failed",
//         error: error.message,
//         timestamp: new Date(),
//       });
//     }
//   });
// };

// ........................................................................................

// // Multer Configuration for Sales Register Upload
// const salesRegisterUpload = multer({
//   storage: multer.memoryStorage(),
//   fileFilter: (req, file, cb) => {
//     const allowedMimes = [
//       "application/vnd.ms-excel",
//       "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
//     ];
//     if (allowedMimes.includes(file.mimetype)) {
//       cb(null, true);
//     } else {
//       cb(new Error("Invalid file type. Only Excel files are allowed."));
//     }
//   },
//   limits: { fileSize: 5 * 1024 * 1024 },
// }).single("salesRegisterFile");

// // Date parsing function
// const parseSalesRegisterDate = (dateValue) => {
//   if (!dateValue) return null;

//   if (dateValue instanceof Date && !isNaN(dateValue)) {
//     return dateValue;
//   }

//   // Handle Excel serial numbers (like 45749, 45750)
//   if (typeof dateValue === "number") {
//     // Excel date serial number (days since 1900-01-01)
//     const excelEpoch = new Date(1900, 0, 1);
//     const jsDate = new Date(excelEpoch.getTime() + (dateValue - 1) * 24 * 60 * 60 * 1000);
//     return jsDate;
//   }

//   if (typeof dateValue === "string") {
//     try {
//       const trimmed = dateValue.trim();
//       if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
//         const parsed = parse(trimmed, "yyyy-MM-dd HH:mm:ss", new Date());
//         const converted = fromZonedTime(parsed, "Asia/Kolkata");
//         if (!isNaN(parsed)) return converted;
//       }
//     } catch (error) {
//       return null;
//     }
//   }

//   return null;
// };

// // Helper functions
// const cleanNumber = (value) => {
//   if (value === null || value === undefined || value === "" || value === " ") return 0;
//   if (typeof value === "number") return value;
//   if (typeof value === "string") {
//     const cleaned = value.replace(/[^\d.-]/g, "");
//     const num = parseFloat(cleaned);
//     return isNaN(num) ? 0 : num;
//   }
//   return 0;
// };

// const cleanString = (value) => {
//   if (value === null || value === undefined || value === "") return "";
//   return String(value).trim();
// };

// // Main function to process Sales Register Excel file
// const processSalesRegisterFile = async (fileBuffer, fileName, uploadedBy = null) => {
//   const workbook = XLSX.read(fileBuffer, { type: "buffer" });
//   const sheetName = workbook.SheetNames[0];
//   const worksheet = workbook.Sheets[sheetName];

//   // Get all data as array of arrays to understand the structure
//   const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

//   console.log("Raw data structure:");
//   rawData.slice(0, 5).forEach((row, i) => {
//     console.log(`Row ${i + 1}:`, row);
//   });

//   const report = {
//     totalRows: rawData.length,
//     successCount: 0,
//     failedCount: 0,
//     failures: [],
//     skippedCount: 0,
//     skipped: [],
//     processedData: []
//   };

//   const bulkOps = [];
//   const now = new Date();

//   // Based on your Excel structure, we know:
//   // Row 1: Main headers with merged cells
//   // Row 2: Actual column headers
//   // Row 3 onwards: Data

//   if (rawData.length < 3) {
//     throw new Error("Excel file doesn't have enough data rows");
//   }

//   // Get actual headers from row 2 (index 1)
//   const headers = rawData[1] || [];
//   console.log("Headers found:", headers);

//   // Process data rows starting from row 3 (index 2)
//   for (let i = 2; i < rawData.length; i++) {
//     try {
//       const rowData = rawData[i];
//       const rowNum = i + 1;

//       // Skip empty rows
//       if (!rowData || rowData.length === 0 || rowData.every(cell =>
//         cell === null || cell === undefined || cell === "" || cell === " ")) {
//         report.skippedCount++;
//         report.skipped.push({
//           row: rowNum,
//           reason: "Empty row",
//           data: {}
//         });
//         continue;
//       }

//       console.log(`Processing row ${rowNum}:`, rowData);

//       // Map row data to headers
//       const rowObject = {};
//       headers.forEach((header, colIndex) => {
//         if (header && header.trim() !== "") {
//           rowObject[header] = rowData[colIndex] !== undefined ? rowData[colIndex] : "";
//         }
//       });

//       // Also include all raw data for debugging
//       const rawRowObject = {};
//       rowData.forEach((cell, index) => {
//         rawRowObject[`col_${index}`] = cell;
//       });

//       console.log(`Row ${rowNum} mapped data:`, rowObject);
//       console.log(`Row ${rowNum} raw data:`, rawRowObject);

//       // Extract data based on column positions (since headers might not map correctly)
//       // Using the actual column positions from your Excel structure
//       const document = {
//         // Column A: Date (index 0)
//         invoiceDate: parseSalesRegisterDate(rowData[0]),

//         // Column B: Particulars (index 1)
//         companyName: cleanString(rowData[1]),

//         // Column C: Voucher Type (index 2)
//         voucherType: cleanString(rowData[2]),

//         // Column D: Voucher No. (index 3)
//         invoiceNo: cleanString(rowData[3]),

//         // Column E: GSTIN/UIN (index 4)
//         gstinUin: cleanString(rowData[4]),

//         // Column F: Gross Total (index 5)
//         grossTotal: cleanNumber(rowData[5]),

//         // Column G: INSTALLATION AND SERVICE CHARGES (index 6)
//         installationAndServiceCharges: cleanNumber(rowData[6]),

//         // Column H: OUTPUT IGST 18 % (index 7)
//         outputIGST18: cleanNumber(rowData[7]),

//         // Column I: Courier Services (index 8)
//         courierServices: cleanNumber(rowData[8]),

//         // Column J: OUTPUT CGST 9% (index 9)
//         outputCGST9: cleanNumber(rowData[9]),

//         // Column K: OUTPUT SGST 9% (index 10)
//         outputSGST9: cleanNumber(rowData[10]),

//         // Column L: Dedicated Telecaller March 2025 (index 11)
//         dedicatedTelecallerMonth1: cleanString(rowData[11]),

//         // Column M: Dedicated Telecaller April 2025 (index 12)
//         dedicatedTelecallerMonth2: cleanString(rowData[12]),

//         // Column N: Discount (index 13)
//         discount: cleanNumber(rowData[13]),

//         // Column O: ACCOMMODATION & FOOD SERVICES (index 14)
//         accommodationAndFoodServices: cleanNumber(rowData[14]),

//         // Column P: Service done on 1st and 2nd July (index 15)
//         serviceDoneOn1stAnd2nd: cleanNumber(rowData[15]),

//         // Column Q: CAMPGN-RETROFT-EXPTRANSPORTATION-CHGS (index 16)
//         campaignRetrofitTransportCharges: cleanNumber(rowData[16]),

//         // Column R: Total Revenue (index 17)
//         totalRevenue: cleanNumber(rowData[17]),

//         uploadedAt: now,
//         uploadedBy: uploadedBy,
//         sourceFileName: fileName
//       };

//       console.log(`Row ${rowNum} processed document:`, document);

//       // Validate essential fields
//       if (!document.invoiceDate || !document.invoiceNo || !document.companyName) {
//         report.failedCount++;
//         report.failures.push({
//           row: rowNum,
//           reason: "Missing required fields (invoiceDate, invoiceNo, or companyName)",
//           data: {
//             rawRowData: rowData,
//             mappedData: rowObject,
//             processedDocument: document
//           }
//         });
//         continue;
//       }

//       // Add to processed data for response
//       report.processedData.push({
//         row: rowNum,
//         data: document
//       });

//       // Create bulk operation
//       bulkOps.push({
//         updateOne: {
//           filter: {
//             invoiceNo: document.invoiceNo,
//             invoiceDate: document.invoiceDate
//           },
//           update: { $set: document },
//           upsert: true
//         }
//       });

//       report.successCount++;

//     } catch (error) {
//       report.failedCount++;
//       report.failures.push({
//         row: i + 1,
//         reason: "Unexpected processing error",
//         error: error.message,
//         data: rawData[i] || {}
//       });
//     }
//   }

//   // Execute bulk operations
//   if (bulkOps.length > 0) {
//     try {
//       const result = await SalesRegisterSample.bulkWrite(bulkOps, {
//         ordered: false,
//         writeConcern: { w: "majority" }
//       });
//       console.log("Bulk write result:", result);
//     } catch (error) {
//       throw new Error(`Bulk write failed: ${error.message}`);
//     }
//   }

//   return report;
// };

// // Controller function to handle Sales Register upload
// const uploadSalesRegister = async (req, res) => {
//   salesRegisterUpload(req, res, async (err) => {
//     if (err) {
//       return res.status(400).json({
//         success: false,
//         message: "File upload failed",
//         error: err.message
//       });
//     }

//     if (!req.file) {
//       return res.status(400).json({
//         success: false,
//         message: "No file uploaded"
//       });
//     }

//     try {
//       const uploadedBy = req.user ? req.user._id : null;

//       const report = await processSalesRegisterFile(
//         req.file.buffer,
//         req.file.originalname,
//         uploadedBy
//       );

//       // Format response with actual data
//       const response = {
//         success: true,
//         message: "Sales Register processing completed",
//         report: {
//           summary: {
//             totalRecords: report.totalRows,
//             successfulRecords: report.successCount,
//             failedRecords: report.failedCount,
//             skippedRecords: report.skippedCount,
//             processedDate: new Date(),
//           },
//           data: report.processedData.map(item => ({
//             rowNumber: item.row,
//             ...item.data
//           })),
//           details: {
//             failures: report.failures.slice(0, 10), // Limit failures in response
//             skipped: report.skipped,
//           },
//         },
//       };

//       if (report.failedCount > 0 || report.skippedCount > 0) {
//         response.warning = "Some records were not processed. Check details.";
//       }

//       res.json(response);

//     } catch (error) {
//       console.error("Sales Register processing error:", error);
//       res.status(500).json({
//         success: false,
//         message: "Sales Register processing failed",
//         error: error.message,
//         timestamp: new Date(),
//       });
//     }
//   });
// };

// '''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''''

// Multer Configuration for Sales Register Upload
const salesRegisterUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only Excel files are allowed."));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("salesRegisterFile");

// Date parsing function
const parseSalesRegisterDate = (value) => {
  if (!value) return null;

  let date;

  // ✅ Case 1: Excel Serial Number
  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    date = new Date(excelEpoch.getTime() + value * 86400000);
  }

  // ✅ Case 2: String Date
  else if (typeof value === "string") {
    const trimmed = value.trim();

    // Format: DD/MM/YYYY or DD-MM-YYYY
    const parts = trimmed.split(/[\/\-\.]/);

    if (parts.length === 3) {
      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);

      date = new Date(Date.UTC(year, month, day));
    } else {
      return null;
    }
  }

  // ✅ Case 3: Already Date Object
  else if (value instanceof Date && !isNaN(value)) {
    date = new Date(
      Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()),
    );
  }

  if (!date || isNaN(date)) return null;

  // 🔥 CRITICAL: Return DATE ONLY (NO TIMEZONE)
  return date.toISOString().split("T")[0];
};

// Helper functions
const cleanNumber = (value) => {
  if (value === null || value === undefined || value === "" || value === " ")
    return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.-]/g, "");
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
};

const calculateTotalRevenue = (rowData) => {
  return (
    cleanNumber(rowData[6]) + // installationAndServiceCharges
    cleanNumber(rowData[8]) + // courierServices
    cleanNumber(rowData[11]) + // dedicatedTelecallerMonth1
    cleanNumber(rowData[12]) + // dedicatedTelecallerMonth2
    cleanNumber(rowData[13]) + // discount
    cleanNumber(rowData[14]) + // accommodationAndFoodServices
    cleanNumber(rowData[15]) + // serviceDoneOn1stAnd2nd
    cleanNumber(rowData[16]) // campaignRetrofitTransportCharges
  );
};

const cleanString = (value) => {
  if (value === null || value === undefined || value === "") return "";
  return String(value).trim();
};

// Main function to process Sales Register Excel file
const processSalesRegisterFile = async (
  fileBuffer,
  fileName,
  uploadedBy = null,
) => {
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Get all data as array of arrays to understand the structure
  const rawData = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
  });

  console.log("Raw data structure:");
  rawData.slice(0, 5).forEach((row, i) => {
    console.log(`Row ${i + 1}:`, row);
  });

  const report = {
    totalRows: rawData.length,
    successCount: 0,
    failedCount: 0,
    failures: [],
    skippedCount: 0,
    skipped: [],
    processedData: [],
  };

  const bulkOps = [];
  const now = new Date();
  const seenInvoices = new Set();

  // Based on your Excel structure, we know:
  // Row 1: Main headers with merged cells
  // Row 2: Actual column headers
  // Row 3 onwards: Data

  if (rawData.length < 3) {
    throw new Error("Excel file doesn't have enough data rows");
  }

  // Get actual headers from row 2 (index 1)
  const headers = rawData[0] || [];
  console.log("Headers found:", headers);

  // --- Fetch existing invoices from DB once (for duplicate check) ---
  const existingInvoices = await SalesRegisterSample.find(
    {},
    { invoiceNo: 1, invoiceDate: 1, gstinUin: 1 },
  );
  const existingKeys = new Set(
    existingInvoices.map(
      (doc) => `${doc.invoiceNo}_${doc.invoiceDate}_${doc.gstinUin}`,
    ),
  );

  // Process data rows starting from row 3 (index 2)
  for (let i = 1; i < rawData.length; i++) {
    try {
      const rowData = rawData[i];
      const rowNum = i + 1;

      // Skip empty rows
      if (
        !rowData ||
        rowData.length === 0 ||
        rowData.every(
          (cell) =>
            cell === null || cell === undefined || cell === "" || cell === " ",
        )
      ) {
        report.skippedCount++;
        report.skipped.push({
          row: rowNum,
          reason: "Empty row",
          data: {},
        });
        continue;
      }

      console.log(`Processing row ${rowNum}:`, rowData);

      // Map row data to headers
      const rowObject = {};
      headers.forEach((header, colIndex) => {
        if (header && header.trim() !== "") {
          rowObject[header] =
            rowData[colIndex] !== undefined ? rowData[colIndex] : "";
        }
      });

      // Also include all raw data for debugging
      const rawRowObject = {};
      rowData.forEach((cell, index) => {
        rawRowObject[`col_${index}`] = cell;
      });

      console.log(`Row ${rowNum} mapped data:`, rowObject);
      console.log(`Row ${rowNum} raw data:`, rawRowObject);

      // Extract data based on column positions (since headers might not map correctly)
      // Using the actual column positions from your Excel structure
      const document = {
        // Column A: Date (index 0)
        invoiceDate: parseSalesRegisterDate(rowData[0]),

        // Column B: Particulars (index 1)
        companyName: cleanString(rowData[1]),

        // Column C: Voucher Type (index 2)
        voucherType: cleanString(rowData[2]),

        // Column D: Voucher No. (index 3)
        invoiceNo: cleanString(rowData[3]),

        // Column E: GSTIN/UIN (index 4)
        gstinUin: cleanString(rowData[4]),

        // Column F: Gross Total (index 5)
        grossTotal: cleanNumber(rowData[5]),

        // Column G: INSTALLATION AND SERVICE CHARGES (index 6)
        installationAndServiceCharges: cleanNumber(rowData[6]),

        // Column H: OUTPUT IGST 18 % (index 7)
        outputIGST18: cleanNumber(rowData[7]),

        // Column I: Courier Services (index 8)
        courierServices: cleanNumber(rowData[8]),

        // Column J: OUTPUT CGST 9% (index 9)
        outputCGST9: cleanNumber(rowData[9]),

        // Column K: OUTPUT SGST 9% (index 10)
        outputSGST9: cleanNumber(rowData[10]),

        // Column L: Dedicated Telecaller March 2025 (index 11)
        // dedicatedTelecallerMonth1: cleanString(rowData[11]),
        dedicatedTelecallerMonth1: cleanNumber(rowData[11]),

        // Column M: Dedicated Telecaller April 2025 (index 12)
        // dedicatedTelecallerMonth2: cleanString(rowData[12]),
        dedicatedTelecallerMonth2: cleanNumber(rowData[12]),

        // Column N: Discount (index 13)
        discount: cleanNumber(rowData[13]),

        // Column O: ACCOMMODATION & FOOD SERVICES (index 14)
        accommodationAndFoodServices: cleanNumber(rowData[14]),

        // Column P: Service done on 1st and 2nd July (index 15)
        serviceDoneOn1stAnd2nd: cleanNumber(rowData[15]),

        // Column Q: CAMPGN-RETROFT-EXPTRANSPORTATION-CHGS (index 16)
        campaignRetrofitTransportCharges: cleanNumber(rowData[16]),

        // Column R: Total Revenue (index 17)
        // totalRevenue: cleanNumber(rowData[17]),
        totalRevenue: calculateTotalRevenue(rowData),

        uploadedAt: now,
        uploadedBy: uploadedBy,
        sourceFileName: fileName,
      };

      console.log(`Row ${rowNum} processed document:`, document);

      // Validate essential fields
      if (
        !document.invoiceDate ||
        !document.invoiceNo ||
        !document.companyName
      ) {
        report.failedCount++;
        report.failures.push({
          row: rowNum,
          reason:
            "Missing required fields (invoiceDate, invoiceNo, or companyName)",
          data: {
            rawRowData: rowData,
            mappedData: rowObject,
            processedDocument: document,
          },
        });
        continue;
      }

      // Generate a unique key for this invoice
      const invoiceKey = `${document.invoiceNo
        }_${document.invoiceDate}_${document.gstinUin}`;

      // Skip if duplicate in Excel
      if (seenInvoices.has(invoiceKey)) {
        report.skippedCount++;
        report.skipped.push({
          row: rowNum,
          reason: "Duplicate in Excel file",
          data: document,
        });
        continue; // Skip this row
      }
      seenInvoices.add(invoiceKey);

      // Skip DB duplicates
      if (existingKeys.has(invoiceKey)) {
        report.skippedCount++;
        report.skipped.push({
          row: rowNum,
          reason: "Duplicate in database",
          data: document,
        });
        continue; // Skip this row
      }

      // Add to processed data for response
      report.processedData.push({
        row: rowNum,
        data: document,
      });

      // Create bulk operation
      bulkOps.push({
        updateOne: {
          filter: {
            invoiceNo: document.invoiceNo,
            invoiceDate: document.invoiceDate,
            gstinUin: document.gstinUin,
          },
          update: { $set: document },
          upsert: true,
        },
      });

      report.successCount++;
    } catch (error) {
      report.failedCount++;
      report.failures.push({
        row: i + 1,
        reason: "Unexpected processing error",
        error: error.message,
        data: rawData[i] || {},
      });
    }
  }

  // Execute bulk operations
  if (bulkOps.length > 0) {
    try {
      const result = await SalesRegisterSample.bulkWrite(bulkOps, {
        ordered: false,
        writeConcern: { w: "majority" },
      });
      console.log("Bulk write result:", result);
    } catch (error) {
      throw new Error(`Bulk write failed: ${error.message}`);
    }
  }

  return report;
};

// Controller function to handle Sales Register upload
const uploadSalesRegister = async (req, res) => {
  salesRegisterUpload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: "File upload failed",
        error: err.message,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    try {
      const uploadedBy = req.user ? req.user._id : null;

      const report = await processSalesRegisterFile(
        req.file.buffer,
        req.file.originalname,
        uploadedBy,
      );

      // Format response with actual data
      const response = {
        success: true,
        message: "Sales Register processing completed",
        report: {
          summary: {
            totalRecords: report.totalRows,
            successfulRecords: report.successCount,
            failedRecords: report.failedCount,
            skippedRecords: report.skippedCount,
            processedDate: new Date(),
          },
          data: report.processedData.map((item) => ({
            rowNumber: item.row,
            ...item.data,
          })),
          details: {
            failures: report.failures.slice(0, 10), // Limit failures in response
            skipped: report.skipped,
          },
        },
      };

      if (report.failedCount > 0 || report.skippedCount > 0) {
        response.warning = "Some records were not processed. Check details.";
      }

      res.json(response);
    } catch (error) {
      console.error("Sales Register processing error:", error);
      res.status(500).json({
        success: false,
        message: "Sales Register processing failed",
        error: error.message,
        timestamp: new Date(),
      });
    }
  });
};

function escapeRegex(str = "") {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const getSalesRegisters = async function (req, res) {
  try {
    const q = (req.query.q || "").trim();
    //console.log(q);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      1000,
      Math.max(1, parseInt(req.query.limit, 10) || 25),
    ); // limit clamp
    const sortBy = req.query.sortBy || "invoiceDate";
    // const sortBy = req.query.sortBy || "invoiceNo";
    // const order = (req.query.order || "desc").toLowerCase() === "asc" ? 1 : -1;
    const order = (req.query.order || "asc").toLowerCase() === "desc" ? -1 : 1; // Changed default to "asc"

    const paymentStatus = req.query.paymentStatus; // 'Y' or 'N'
    const overdueDays = req.query.overdueDays ? parseInt(req.query.overdueDays, 10) : null;
    const filter = {};

    // Handle payment status filtering
    if (paymentStatus) {
      const allPayments = await ClientpaymentCollection.find(
        {},
        "invoiceNo",
      ).lean();
      const allPaidInvoices = new Set();
      allPayments.forEach((p) => {
        if (Array.isArray(p.invoiceNo)) {
          p.invoiceNo.forEach((no) => allPaidInvoices.add(String(no)));
        } else if (p.invoiceNo) {
          allPaidInvoices.add(String(p.invoiceNo));
        }
      });
      const paidInvoiceArry = Array.from(allPaidInvoices);

      if (paymentStatus === "Y") {
        filter.invoiceNo = { $in: paidInvoiceArry };
      } else if (paymentStatus === "N") {
        filter.invoiceNo = { $nin: paidInvoiceArry };
      }
    }

    if (q) {
      const safe = escapeRegex(q);
      const regex = new RegExp(safe, "i");
      filter.$or = [{ companyName: regex }, { invoiceNo: regex }];
    }

    // Handle overdue days filtering (only for pending invoices)
    if (overdueDays && paymentStatus === 'N') {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - overdueDays);
      cutoffDate.setHours(0, 0, 0, 0);
      // Convert to YYYY-MM-DD string format to match stored invoiceDate format
      const cutoffDateString = cutoffDate.toISOString().split('T')[0];
      filter.invoiceDate = { $lt: cutoffDateString };
      // console.log('Overdue filter applied:', { overdueDays, paymentStatus, cutoffDate, cutoffDateString, finalFilter: filter });
    }

    // Optional: support date range filters if passed (yyyy-mm-dd)
    // e.g. ?from=2025-04-01&to=2025-04-30
    if (req.query.from || req.query.to) {
      filter.invoiceDate = filter.invoiceDate || {};
      if (req.query.from) {
        const from = new Date(req.query.from);
        if (!isNaN(from.getTime())) filter.invoiceDate.$gte = from;
      }
      if (req.query.to) {
        const to = new Date(req.query.to);
        if (!isNaN(to.getTime())) {
          // include whole day
          to.setHours(23, 59, 59, 999);
          filter.invoiceDate.$lte = to;
        }
      }
      // if invoiceDate ended up empty, delete
      if (Object.keys(filter.invoiceDate).length === 0)
        delete filter.invoiceDate;
    }

    const skip = (page - 1) * limit;

    // count total matching documents
    const [total, rawData] = await Promise.all([
      SalesRegisterSample.countDocuments(filter),
      SalesRegisterSample.find(filter)
        .sort({ [sortBy]: order, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
    ]);

    // Check for payment received for each record
    const invoiceNos = rawData.map((d) => d.invoiceNo).filter(Boolean);
    const payments = await ClientpaymentCollection.find(
      {
        invoiceNo: { $in: invoiceNos },
      },
      "invoiceNo",
    ).lean();

    const paidInvoices = new Set();
    payments.forEach((p) => {
      if (Array.isArray(p.invoiceNo)) {
        p.invoiceNo.forEach((no) => paidInvoices.add(String(no)));
      } else if (p.invoiceNo) {
        paidInvoices.add(String(p.invoiceNo));
      }
    });

    const data = rawData.map((d) => ({
      ...d,
      isPaymentReceived: paidInvoices.has(String(d.invoiceNo)),
    }));

    const pages = Math.max(1, Math.ceil(total / limit));

    return res.json({
      success: true,
      data,
      meta: {
        total,
        pages,
        page,
        limit,
        sortBy,
        order: order === 1 ? "asc" : "desc", // Include sort info in response
      },
    });
  } catch (err) {
    console.error("Error in getSalesRegisters:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

const getReportforUploadedFile = async (req, res) => {
  try {
    const reports = await TransactionReport.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, reports });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching reports",
      error: error.message,
    });
  }
};

// Create single client payment collection record manually
const createClientPaymentRecord = async (req, res) => {
  try {
    const {
      qstClientId,
      description,
      transactionId,
      transactionAmount,
      transactionDate,
      invoiceNo,
      invoiceDate,
    } = req.body;

    // Validation
    if (
      !qstClientId ||
      !description ||
      !transactionId ||
      !transactionAmount ||
      !transactionDate
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: qstClientId, description, transactionId, transactionAmount, and transactionDate are required",
      });
    }

    // Validate client exists
    const client = await QstClient.findById(qstClientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    // Check for duplicate transaction ID
    const existingTransaction = await ClientpaymentCollection.findOne({
      excelTransactionId: transactionId,
    });

    if (existingTransaction) {
      return res.status(409).json({
        success: false,
        message: "Transaction ID already exists",
      });
    }

    // Parse transaction date
    const parsedDate = new Date(transactionDate);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid transaction date format",
      });
    }

    // Parse invoice date if provided
    let parsedInvoiceDate = null;
    if (invoiceDate) {
      parsedInvoiceDate = new Date(invoiceDate);
      if (isNaN(parsedInvoiceDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid invoice date format",
        });
      }
    }

    // Create the record
    const paymentRecord = await ClientpaymentCollection.create({
      qstClient: qstClientId,
      description: description.trim(),
      excelTransactionId: transactionId.trim(),
      transaction_amount: parseFloat(transactionAmount),
      transaction_posted_date: parsedDate,
      invoiceNo: invoiceNo || null,
      invoiceDate: parsedInvoiceDate,
      matchMethod: "manual", // Indicate this was manually created
      matchedCompanyName: client.companyName,
    });

    // Populate the response
    await paymentRecord.populate("qstClient", "companyName companyShortName");

    res.status(201).json({
      success: true,
      message: "Client payment record created successfully",
      data: paymentRecord,
    });
  } catch (error) {
    console.error("Error creating client payment record:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

const repairClientMappings = async (req, res) => {
  try {
    // 1) Load all clients for matching
    const allClients = await QstClient.find(
      {},
      "_id companyName companyShortName",
    ).lean();

    const clientMap = {};
    for (const c of allClients) {
      const normName = normalizeCompanyName(c.companyName || "");
      if (normName) {
        if (!clientMap[normName]) clientMap[normName] = [];
        clientMap[normName].push(c);
      }
      const normShort = normalizeCompanyName(c.companyShortName || "");
      if (normShort && normShort !== normName) {
        if (!clientMap[normShort]) clientMap[normShort] = [];
        clientMap[normShort].push(c);
      }
    }
    const clientNormEntries = Object.entries(clientMap);

    // Internal matcher same as process function
    function findClientByExtractedName(extractedName) {
      if (!extractedName) return { client: null, method: null };
      const normExtracted = normalizeCompanyName(extractedName);
      if (!normExtracted) return { client: null, method: null };
      const tokens = normExtracted.split(" ").filter(Boolean);
      if (clientMap[normExtracted])
        return { client: clientMap[normExtracted][0], method: "exact" };
      if (tokens.length > 0) {
        const first = tokens[0];
        if (first.length >= 3) {
          for (const [clientNorm, arr] of clientNormEntries) {
            if (
              new RegExp(`\\b${escapeRegExp(first)}\\b`, "i").test(clientNorm)
            ) {
              return { client: arr[0], method: "firstToken" };
            }
          }
        }
      }
      for (const t of tokens.filter((t) => t.length >= 3)) {
        for (const [clientNorm, arr] of clientNormEntries) {
          if (new RegExp(`\\b${escapeRegExp(t)}\\b`, "i").test(clientNorm)) {
            return { client: arr[0], method: "token" };
          }
        }
      }
      for (const [clientNorm, arr] of clientNormEntries) {
        if (!clientNorm || clientNorm.length < 3) continue;
        if (
          new RegExp(`\\b${escapeRegExp(clientNorm)}\\b`, "i").test(
            normExtracted,
          )
        ) {
          return { client: arr[0], method: "substring" };
        }
      }
      return { client: null, method: null };
    }

    // 2) Fetch all existing records
    const collections = await ClientpaymentCollection.find({}).lean();
    const bulkOps = [];

    for (const item of collections) {
      // 🛡️ Skip rows that were manually mapped or modified by user
      if (item.matchMethod === "manual") continue;

      const companyName = extractCompanyName(item.description);
      if (!companyName) continue;

      const { client, method: matchMethod } =
        findClientByExtractedName(companyName);

      // Only prepare update if we actually find a client (to avoid overwriting manual fixes with null)
      if (client) {
        bulkOps.push({
          updateOne: {
            filter: { _id: item._id },
            update: {
              $set: {
                qstClient: client._id,
                matchedCompanyName: client.companyName || "",
                matchMethod: matchMethod,
              },
            },
          },
        });
      } else {
        // If not found, at least store the extracted name for UI display
        bulkOps.push({
          updateOne: {
            filter: { _id: item._id },
            update: {
              $set: {
                matchedCompanyName: companyName,
              },
            },
          },
        });
      }
    }

    if (bulkOps.length > 0) {
      await ClientpaymentCollection.bulkWrite(bulkOps);
    }

    res.json({
      success: true,
      message: `${bulkOps.length} mappings re-synced successfully`,
    });
  } catch (error) {
    console.error("Repair error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getCollectionSummaryForDashboard = async (req, res) => {
  try {
    const now = new Date();

    // ===== THIS MONTH START (UTC SAFE)
    const thisMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
    );

    // ===== TODAY END (UTC SAFE)
    const todayEnd = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        23,
        59,
        59,
        999,
      ),
    );

    // ===== LAST MONTH START (UTC SAFE)
    const lastMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0),
    );

    // ===== LAST MONTH END (UTC SAFE)
    const lastMonthEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999),
    );

    // ===== SAFE LAST MONTH TILL DATE (UTC SAFE)
    const lastMonthDays = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0),
    ).getUTCDate();

    const safeDay = Math.min(now.getUTCDate(), lastMonthDays);

    const lastMonthTillDateEnd = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() - 1,
        safeDay,
        23,
        59,
        59,
        999,
      ),
    );

    // ===============================
    // SINGLE AGGREGATION (FAST)
    // ===============================
    const result = await ClientpaymentCollection.aggregate([
      {
        $facet: {
          // ---- THIS MONTH TILL DATE
          thisMonthTillDate: [
            {
              $match: {
                transaction_posted_date: {
                  $gte: thisMonthStart,
                  $lte: todayEnd,
                }, // Changed from createdAt
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: { $toDouble: "$transaction_amount" } },
              },
            },
          ],

          // ---- FULL LAST MONTH
          fullLastMonth: [
            {
              $match: {
                transaction_posted_date: {
                  $gte: lastMonthStart,
                  $lte: lastMonthEnd,
                }, // Changed from createdAt
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: { $toDouble: "$transaction_amount" } },
              },
            },
          ],

          // ---- LAST MONTH TILL DATE
          lastMonthTillDate: [
            {
              $match: {
                transaction_posted_date: {
                  // Changed from createdAt
                  $gte: lastMonthStart,
                  $lte: lastMonthTillDateEnd,
                },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: { $toDouble: "$transaction_amount" } },
              },
            },
          ],
        },
      },
    ]);
    console.log("result:", result);

    const thisMonthTillDate =
      Math.round(result[0].thisMonthTillDate[0]?.total) || 0;
    const fullLastMonth = Math.round(result[0].fullLastMonth[0]?.total) || 0;
    const lastMonthTillDate =
      Math.round(result[0].lastMonthTillDate[0]?.total) || 0;

    res.status(200).json({
      success: true,
      collectionSummary: {
        thisMonthTillDate,
        fullLastMonth,
        lastMonthTillDate,
      },
    });
  } catch (error) {
    console.error("Error fetching collection summary:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch collection summary",
    });
  }
};

const bankStatementUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "application/csv",
      "text/plain",
    ];
    const isExtensionValid = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    if (allowedMimes.includes(file.mimetype) || isExtensionValid) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only Excel and CSV files are allowed."));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 },
}).single("paymentFile");

const processBankStatementBuffer = async (fileBuffer, originalName = "", uploadedBy = null) => {
  const workbook = XLSX.read(fileBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const allRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

  let headerIndex = -1;
  for (let i = 0; i < Math.min(allRows.length, 25); i++) {
    const row = allRows[i];
    if (!row || !Array.isArray(row)) continue;
    const rowStr = row.map((cell) => String(cell || "").trim().toLowerCase()).join(" ");
    if (
      rowStr.includes("date") &&
      (rowStr.includes("tran id") ||
        rowStr.includes("trans id") ||
        rowStr.includes("remarks") ||
        rowStr.includes("deposits") ||
        rowStr.includes("utr"))
    ) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error(
      "Could not find the header row in the file. Please ensure columns like 'Date', 'Tran Id', 'Remarks', 'UTR Number', 'Deposits' are present."
    );
  }

  const headers = Array.from(allRows[headerIndex] || []).map((h) => String(h || "").trim());

  const dateIdx = headers.findIndex((h) => h && (/^date$/i.test(h) || h.toLowerCase().includes("date")));
  const transIdIdx = headers.findIndex(
    (h) => h && (/tran\s*id/i.test(h) || /trans\s*id/i.test(h) || /transaction\s*id/i.test(h))
  );
  const remarksIdx = headers.findIndex((h) => h && (/remark/i.test(h) || /description/i.test(h)));
  const utrIdx = headers.findIndex((h) => h && /utr/i.test(h));
  const depositsIdx = headers.findIndex((h) => h && /deposit/i.test(h));

  const dataRows = allRows.slice(headerIndex + 1);
  const bulkOps = [];
  let validRowsCount = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    if (!r || !Array.isArray(r)) continue;

    const dateVal = dateIdx !== -1 && r[dateIdx] !== undefined ? String(r[dateIdx]).trim() : "";
    const transIdVal = transIdIdx !== -1 && r[transIdIdx] !== undefined ? String(r[transIdIdx]).trim() : "";
    const remarksVal = remarksIdx !== -1 && r[remarksIdx] !== undefined ? String(r[remarksIdx]).trim() : "";
    let utrVal = utrIdx !== -1 && r[utrIdx] !== undefined ? String(r[utrIdx]).trim() : "";
    if (utrVal === "'-") utrVal = "";

    const depRaw = depositsIdx !== -1 ? r[depositsIdx] : undefined;
    const depositsVal =
      depRaw !== undefined && depRaw !== null && depRaw !== "" && !isNaN(parseFloat(depRaw))
        ? parseFloat(depRaw)
        : null;

    if (!dateVal && !transIdVal && !remarksVal && depositsVal === null) {
      continue;
    }

    validRowsCount++;

    let transactionDate = parseExcelDate(dateVal);
    if (!transactionDate && dateVal) {
      try {
        const parsed = parse(dateVal, "dd-MM-yyyy HH:mm:ss", new Date());
        if (!isNaN(parsed)) transactionDate = parsed;
      } catch (e) {
        // ignore
      }
    }

    bulkOps.push({
      updateOne: {
        filter: {
          transId: transIdVal,
          date: dateVal,
          remarks: remarksVal,
        },
        update: {
          $set: {
            date: dateVal,
            transactionDate: transactionDate || null,
            transId: transIdVal,
            remarks: remarksVal,
            utrNo: utrVal,
            deposits: depositsVal,
            rawDeposits: depRaw !== undefined && depRaw !== null ? String(depRaw).trim() : "",
            sourceFileName: originalName || "",
            uploadedBy: uploadedBy || null,
          },
        },
        upsert: true,
      },
    });
  }

  let result = null;
  if (bulkOps.length > 0) {
    result = await BankStatement.bulkWrite(bulkOps, { ordered: false });
  }

  return {
    totalRows: dataRows.length,
    validRows: validRowsCount,
    upsertedCount: result ? result.upsertedCount : 0,
    modifiedCount: result ? result.modifiedCount : 0,
    matchedCount: result ? result.matchedCount : 0,
  };
};

const uploadBankStatement = async (req, res) => {
  bankStatementUpload(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: "File upload failed",
        error: err.message,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    try {
      const uploadedBy = req.user ? req.user._id : null;
      const report = await processBankStatementBuffer(
        req.file.buffer,
        req.file.originalname,
        uploadedBy
      );

      try {
        await processPaymentFile(req.file.buffer);
      } catch (payErr) {
        console.warn("Technician payment processing note:", payErr.message);
      }

      return res.status(200).json({
        success: true,
        message: "Bank statement processed successfully",
        report,
      });
    } catch (error) {
      console.error("Error processing bank statement file:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to process bank statement",
      });
    }
  });
};

const getBankStatements = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", all = false } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 10);
    const skip = (pageNum - 1) * limitNum;

    const filter = {};

    if (search && search.trim()) {
      const s = search.trim();
      const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const searchRegex = new RegExp(escaped, "i");
      filter.$or = [
        { transId: searchRegex },
        { remarks: searchRegex },
        { utrNo: searchRegex },
        { date: searchRegex },
      ];
      const num = parseFloat(s);
      if (!isNaN(num)) {
        filter.$or.push({ deposits: num });
      }
    }

    if (all === "true" || all === true) {
      const data = await BankStatement.find(filter).sort({ createdAt: 1, _id: 1 }).lean();
      return res.status(200).json({
        success: true,
        data,
        total: data.length,
      });
    }

    const [data, total] = await Promise.all([
      BankStatement.find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      BankStatement.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limitNum) || 1;

    return res.status(200).json({
      success: true,
      data,
      total,
      totalPages,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    console.error("Error fetching bank statements:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch bank statements",
      error: error.message,
    });
  }
};

const updateBankStatementDeposit = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid statement ID",
      });
    }

    const { deposits } = req.body;

    const parsedDeposits =
      deposits === null || deposits === "" || deposits === undefined
        ? null
        : parseFloat(deposits);

    if (parsedDeposits !== null && isNaN(parsedDeposits)) {
      return res.status(400).json({
        success: false,
        message: "Deposits must be a valid number",
      });
    }

    const updatedStatement = await BankStatement.findByIdAndUpdate(
      id,
      {
        $set: {
          deposits: parsedDeposits,
          rawDeposits: parsedDeposits !== null ? String(parsedDeposits) : "",
        },
      },
      { new: true }
    );

    if (!updatedStatement) {
      return res.status(404).json({
        success: false,
        message: "Bank statement record not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Deposit updated successfully",
      data: updatedStatement,
    });
  } catch (error) {
    console.error("Error updating bank statement deposit:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update deposit",
      error: error.message,
    });
  }
};

module.exports = {
  processBankStatementBuffer,
  uploadBankStatement,
  getBankStatements,
  updateBankStatementDeposit,
  processPayments,
  getAllFullyClosedTicketPendingTechPay,
  processSingleTechnicianPayment,
  processPaymentsCRForCollection,
  repairClientMappings,

  getClientPaymentsCollectionData,
  updateClientPayment,
  createClientPaymentRecord, // Add the new method
  // getClosedWorkDoneTickets

  processSalesRegisterFile,
  uploadSalesRegister,
  getSalesRegisters,

  getReportforUploadedFile,
  // uploadSalesRegisterExcel, processSalesRegisterFile,
  // importSalesRegisterFromExcel
  getCollectionSummaryForDashboard,
  getAllFullyClosedTicketSucessTechPay,
};
