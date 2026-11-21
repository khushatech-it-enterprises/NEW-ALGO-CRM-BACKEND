const mongoose = require('mongoose');
const accessoryTypeSchema = new mongoose.Schema(
  {
    accessoryTypeName: { type: String, required: true, unique: true, trim: true },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  },
  { timestamps: true }
);
module.exports = mongoose.model('AccessoryType', accessoryTypeSchema);
