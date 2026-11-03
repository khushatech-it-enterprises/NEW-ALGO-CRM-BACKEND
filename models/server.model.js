const mongoose = require('mongoose');

const serverSchema = new mongoose.Schema(
  {
    serverName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    referType: {
      type: String,
      enum: ['Yes', 'No'],
      default: 'No',
      required: true,
    },
    assetTypes: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Server', serverSchema);
