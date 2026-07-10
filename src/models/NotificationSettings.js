// src/models/NotificationSettings.js
const mongoose = require('mongoose');

const notificationSettingsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  emailNotifications: {
    type: Boolean,
    default: true
  },
  appointmentConfirmedNotify: {
    type: Boolean,
    default: true
  },
  appointmentCancelledNotify: {
    type: Boolean,
    default: true
  },
  noShowNotify: {
    type: Boolean,
    default: true
  },
  dailyDigest: {
    type: Boolean,
    default: false
  },
  weeklyReport: {
    type: Boolean,
    default: true
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

notificationSettingsSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('NotificationSettings', notificationSettingsSchema);