const mongoose = require("mongoose");

const BankStatementSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      default: "",
    },
    transactionDate: {
      type: Date,
    },
    transId: {
      type: String,
      trim: true,
      index: true,
    },
    remarks: {
      type: String,
      trim: true,
      default: "",
    },
    utrNo: {
      type: String,
      trim: true,
      default: "",
    },
    deposits: {
      type: Number,
      default: null,
    },
    rawDeposits: {
      type: String,
      default: "",
    },
    sourceFileName: {
      type: String,
      default: "",
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

// Compound index to help avoid duplicate imports while allowing quick lookups
BankStatementSchema.index({ transId: 1, date: 1, remarks: 1 }, { unique: true, sparse: true });
BankStatementSchema.index({ remarks: "text", transId: "text", utrNo: "text" });

module.exports = mongoose.model("BankStatement", BankStatementSchema);
