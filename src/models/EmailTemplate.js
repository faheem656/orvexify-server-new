// src/models/EmailTemplate.js
const mongoose = require('mongoose');

const emailTemplateSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['reminder', 'confirmation', 'cancellation'],
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
    },
    isDefault: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

emailTemplateSchema.index({ userId: 1, type: 1 }, { unique: true });

module.exports =
  mongoose.models.EmailTemplate ||
  mongoose.model('EmailTemplate', emailTemplateSchema);
