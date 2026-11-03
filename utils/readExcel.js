const XLSX = require("xlsx");
const path = require("path");

// Read OLD format
console.log("=== OLD FORMAT (algoCRM) ===");
const wb1 = XLSX.readFile(path.join(__dirname, "OpTransactionHistoryUX3_XLS08-10-2026 algoCRM.xls"));
const ws1 = wb1.Sheets[wb1.SheetNames[0]];
const rows1 = XLSX.utils.sheet_to_json(ws1, { header: 1, defval: "" });
for (let i = 0; i < Math.min(20, rows1.length); i++) {
  console.log("Row " + i + ":", JSON.stringify(rows1[i]));
}

console.log("\n=== NEW FORMAT (quikServ) ===");
const wb2 = XLSX.readFile(path.join(__dirname, "OpTransactionHistoryUX328-10-2026quikServ.xls"));
const ws2 = wb2.Sheets[wb2.SheetNames[0]];
const rows2 = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: "" });
for (let i = 0; i < Math.min(20, rows2.length); i++) {
  console.log("Row " + i + ":", JSON.stringify(rows2[i]));
}
