const mongoose = require("mongoose");

const SalesRegisterSampleSchema = new mongoose.Schema(
  {
    invoiceDate:
    {
      type: Date,
      required: true
    },
    companyName:
    {
      type: String
    },
    voucherType: {
      type: String
    },
    invoiceNo: {
      type: String,
      required: true
    },
    gstinUin: {
      type: String
    },
    grossTotal: {
      type: Number
    },
    installationAndServiceCharges: {
      type: Number
    },
    outputIGST18: {
      type: Number
    },
    courierServices: {
      type: Number
    },
    outputCGST9: {
      type: Number
    },
    outputSGST9: {
      type: Number
    },
    dedicatedTelecallerMonth1: {
      type: String
    },
    dedicatedTelecallerMonth2: {
      type: String
    },
    discount: {
      type: Number
    },
    accommodationAndFoodServices: {
      type: Number
    },
    serviceDoneOn1stAnd2nd: {
      type: Number
    },
    campaignRetrofitTransportCharges: {
      type: Number
    },
    totalRevenue: {
      type: Number
    },

    // metadata
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    sourceFileName: { type: String },
  },
  { timestamps: true }
);

// Create a compound unique index to avoid duplicate inserts.
SalesRegisterSampleSchema.index(
  { invoiceNo: 1, invoiceDate: 1, gstinUin: 1 },
  { unique: true, name: "unique_invoice_voucher_gstin" }
);

module.exports = mongoose.model("SalesRegisterSample", SalesRegisterSampleSchema);