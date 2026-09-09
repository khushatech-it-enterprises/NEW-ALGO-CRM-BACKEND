const mongoose = require('mongoose');
const XLSX = require('xlsx');
const ExistingCustomer = require('../models/existingCustomer')

// DB connection
mongoose.connect('mongodb+srv://riyazrahman_db_user:3qey9dM0Zui7GgVt@cluster0.wsbhkym.mongodb.net/AlgoMatrixCRM')
  // mongoose.connect('mongodb+srv://Zod:Zaaves7560@cluster1.feijb.mongodb.net/AlgoMatrixCRM')
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log(err));

(async () => {
  try {

    // Load excel
    const workbook = XLSX.readFile('./Book3.xlsx');
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Convert to JSON
    const records = XLSX.utils.sheet_to_json(sheet);

    // Prepare data in required format
    const formattedData = records.map(item => ({
      companyName: item.CompanyName || "",
      registrationNumber: item.RegistrationNo || "",
      deviceId: item.DeviceID || "",
      deviceManufacturer: item.DeviceManufacturer || "",
      deviceType: item.DeviceType || "",
      deviceModel: item.DeviceModel || "",
      referType: item.ReferType || "",
      assetType: item.AssetType || "",
      mobileNumber: item.MobileNo || "",
      simOnwer: item.SimOwner || "",
      simProvider: item.SimProvider || "",
      server: item.server || ""
    }));

    // Bulk Insert
    const result = await ExistingCustomer.insertMany(formattedData);
    console.log("Inserted Successfully", result.length);

    mongoose.connection.close();
  } catch (err) {
    console.log(err);
  }
})();
