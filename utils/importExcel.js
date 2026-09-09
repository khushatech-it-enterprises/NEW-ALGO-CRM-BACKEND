// import xlsx from "xlsx";
// import { MongoClient } from "mongodb";

// async function importExcel() {
//   try {
//     const workbook = xlsx.readFile("ALGOCUSTOMERS.xlsx");
//     const sheet = workbook.Sheets[workbook.SheetNames[0]];

//     // Read sheet as raw 2D array
//     const rows = xlsx.utils.sheet_to_json(sheet, {
//       header: 1,    // read header row as array
//       defval: ""    // empty cells = empty string
//     });

//     // First row is header
//     const headers = rows[0].map(h => h.toString().trim());

//     // Remaining rows = data rows
//     const dataRows = rows.slice(1);

//     // Convert each row into clean object
//     const finalData = dataRows.map((row) => {
//       const doc = {};
//       headers.forEach((header, index) => {
//         const value = row[index] !== undefined && row[index] !== null
//           ? row[index].toString().trim()
//           : "";
//         doc[header] = value;
//       });
//       return doc;
//     });

//     console.log("Total documents ready:", finalData.length);
//     console.log("Sample document:", finalData[0]);

//     // MongoDB connection
//     const client = await MongoClient.connect(
//       "mongodb+srv://Zod:Zaaves7560@cluster1.feijb.mongodb.net/AlgoMatrixCRM"
//     );

//     const db = client.db("customersEOD");

//     await db.collection("customersData").insertMany(finalData);

//     console.log("Data Imported Successfully!");
//     client.close();
//   } catch (err) {
//     console.error("Error:", err);
//   }
// }

// importExcel();

// import xlsx from "xlsx";
// import { MongoClient } from "mongodb";

// async function importExcel() {
//   try {
//     const workbook = xlsx.readFile("ALGOCUSTOMERS.xlsx");
//     const sheet = workbook.Sheets[workbook.SheetNames[0]];

//     // Read entire sheet as rows
//     const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });

//     const rawHeaders = rows[0];

//     // Filter out empty headers
//     const headers = rawHeaders
//       .map(h => (h || "").toString().trim())
//       .filter(h => h !== "");

//     // Build array of valid column indices
//     const validIndexes = rawHeaders
//       .map((h, i) => ({ h, i }))
//       .filter(col => (col.h || "").toString().trim() !== "")
//       .map(col => col.i);

//     const finalData = rows.slice(1).map(row => {
//       const obj = {};

//       validIndexes.forEach((colIndex, idx) => {
//         const key = headers[idx];
//         let value = row[colIndex];

//         if (value === undefined || value === null) value = "";

//         obj[key] = value.toString().trim();
//       });

//       return obj;
//     });

//     console.log("Sample output:", finalData[0]);

//     const client = await MongoClient.connect(
//       "mongodb+srv://Zod:Zaaves7560@cluster1.feijb.mongodb.net/AlgoMatrixCRM"
//     );
//     const db = client.db("customersEOD");

//     await db.collection("customersData").insertMany(finalData);

//     console.log("Imported:", finalData.length, "records");
//     client.close();

//   } catch (err) {
//     console.error("IMPORT ERROR:", err);
//   }
// }

// importExcel();


// import xlsx from "xlsx";
// import mongoose from "mongoose";
// import Customer from "../models/customerModel.js";

// async function importExcel() {
//   await mongoose.connect("mongodb+srv://Zod:Zaaves7560@cluster1.feijb.mongodb.net/AlgoMatrixCRM");

//   const workbook = xlsx.readFile("./Book1.xlsx");
//   const sheet = workbook.Sheets[workbook.SheetNames[0]];

//   const rows = xlsx.utils.sheet_to_json(sheet, {
//     header: 1,
//     defval: ""
//   });

//   // Remove header row
//   const data = rows.slice(1);

//   for (const row of data) {
//     const doc = {
//       dateOfVisit: row[0] || "",
//       month: row[1] || "",
//       customerName: row[2] || "",
//       state: row[3] || "",
//       location: row[4] || "",
//       callType: row[5] || "",
//       deviceType: row[6] || "",
//       deviceManufacturer: row[7] || "",
//       deviceModel: row[8] || "",
//       oldVehicleNo: row[9] || "",
//       newVehicleNo: row[10] || "",
//       oldImeiNo: row[11] || "",
//       simProvider: row[12] || "",
//       oldSimNo: row[13] || "",
//       newImeiNo: row[14] || "",
//       newSimNo: row[15] || "",
//       payrollOutsource: row[16] || "",
//       technicianName: row[17] || "",
//       additionalTechnician: row[18] || "",
//       cseName: row[19] || "",
//       issueFound: row[20] || "",
//       resolutionDone: row[21] || "",
//       remarks: row[22] || "",
//       completionStatus: row[23] || ""
//     };

//     await Customer.create(doc);
//   }

//   console.log("DONE: Imported all records");
//   process.exit();
// }

// importExcel();



import xlsx from "xlsx";
import mongoose from "mongoose";
import Customer from "../models/customerModel.js";

// -----------------------------
// 💠 1. Excel Date Conversion
// -----------------------------
function excelDateToJSDate(serial) {
  if (!serial || serial === "") return "";
  if (isNaN(serial)) return serial; // already a string date

  const utc_days = serial - 25569;
  const utc_value = utc_days * 86400;
  const date_info = new Date(utc_value * 1000);

  const day = date_info.getDate().toString().padStart(2, "0");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = monthNames[date_info.getMonth()];
  const year = date_info.getFullYear();

  return `${day}-${month}-${year}`;
}

// -----------------------------
// 💠 3. Import Function
// -----------------------------
async function importExcel() {
  try {
    console.log("Connecting to MongoDB...");

    await mongoose.connect(
      // "mongodb+srv://riyazrahman_db_user:3qey9dM0Zui7GgVt@cluster0.wsbhkym.mongodb.net/AlgoMatrixCRM"
      "mongodb+srv://Zod:Zaaves7560@cluster1.feijb.mongodb.net/AlgoMatrixCRM"
    );

    console.log("Connected.");

    const workbook = xlsx.readFile("./Book1.xlsx");
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    // Remove header row
    const data = rows.slice(1);

    console.log("Total rows found:", data.length);

    for (const row of data) {
      const doc = {
        dateOfVisit: excelDateToJSDate(row[0]),
        month: row[1] || "",
        customerName: row[2] || "",
        state: row[3] || "",
        location: row[4] || "",
        callType: row[5] || "",
        deviceType: row[6] || "",
        deviceManufacturer: row[7] || "",
        deviceModel: row[8] || "",
        oldVehicleNo: row[9] || "",
        newVehicleNo: row[10] || "",
        oldImeiNo: row[11] || "",
        simProvider: row[12] || "",
        oldSimNo: row[13] || "",
        newImeiNo: row[14] || "",
        newSimNo: row[15] || "",
        payrollOutsource: row[16] || "",
        technicianName: row[17] || "",
        additionalTechnician: row[18] || "",
        cseName: row[19] || "",
        issueFound: row[20] || "",
        resolutionDone: row[21] || "",
        remarks: row[22] || "",
        completionStatus: row[23] || ""
      };

      await Customer.create(doc);
    }

    console.log("🎉 Import Completed Successfully!");
    process.exit();

  } catch (error) {
    console.error("ERROR IMPORTING:", error);
    process.exit();
  }
}

importExcel();
