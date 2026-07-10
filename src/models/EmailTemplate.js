// src/models/EmailTemplate.js
const mongoose = require('mongoose');

const emailTemplateSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['reminder', 'confirmation', 'cancellation'],
    required: true
  },
  subject: {
    type: String,
    required: true,
    default: ''
  },
  body: {
    type: String,
    required: true,
    default: ''
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update updatedAt on save
emailTemplateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Compound index for unique user+type
emailTemplateSchema.index({ userId: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);