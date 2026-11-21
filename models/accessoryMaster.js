const mongoose = require("mongoose");

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: [
        "stock",
        "sold to customer",
        "customer demo",
        "testing",
        "with technician",
        "with cse",
        "foc",
        "defective",
        "assign to vendor",
      ],
    },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: String },
  },
  { _id: false },
);

const accessoryMasterSchema = new mongoose.Schema(
  {
    accessoryManufacturer: String,

    accessoryType: {
      type: String,
    },

    accessoryModel: String,
    accessoryId: String,

    invoiceDate: { type: Date },
    invoiceNumber: String,

    Age: Number,

    warrantyPeriod: Number, // months

    warnatyStatus: {
      type: String,
      enum: ["active", "out of warranty"],
    },

    status: {
      type: String,
      enum: [
        "stock",
        "sold to customer",
        "customer demo",
        "testing",
        "with technician",
        "with cse",
        "foc",
        "defective",
        "assign to vendor",
      ],
      default: "stock",
    },

    // ✅ assignment (polymorphic reference)
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "assignedToModel",
      default: null,
    },
    assignedToModel: {
      type: String,
      enum: ["Employee", "Technician", "QstClient", "r&d", "store", "cse"],
      default: null,
    },

    customerName: String,

    demoFromDate: Date,
    demoToDate: Date,

    accessoryPerRate: String,

    stockEnteredAt: { type: Date },
    statusHistory: [statusHistorySchema],

    // Defect tracking fields
    isDefective: {
      type: Boolean,
      default: false
    },
    isRepairable: {
      type: Boolean,
      default: false
    },
    defectMarkedDate: Date,
    defectReason: String,
    defectImages: [{ type: String }],

    // R&D Testing fields
    testingStatus: {
      type: String,
      enum: ["pending", "tested ok", "tested not ok", null],
      default: null,
    },
    remark: { type: String, default: "" },
    remarks: [
      {
        status: { type: String, enum: ["tested ok", "tested not ok"] },
        text:   { type: String },
        images: [{ type: String }],
        addedAt: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    images: [{ type: String }],
  },
  { timestamps: true },
);

const AccessoryMaster = mongoose.model(
  "AccessoryMaster",
  accessoryMasterSchema,
);
module.exports = AccessoryMaster;
