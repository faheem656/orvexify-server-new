// src/models/ReminderSettings.js
const mongoose = require('mongoose');

const reminderSettingsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  enable24hReminder: {
    type: Boolean,
    default: true
  },
  enable2hReminder: {
    type: Boolean,
    default: true
  },
  enableCancellationEmail: {
    type: Boolean,
    default: true
  },
  sendRemindersOnWeekends: {
    type: Boolean,
    default: true
  },
  defaultReminderHours: {
    firstReminder: {
      type: Number,
      default: 24,
      min: 1,
      max: 72
    },
    secondReminder: {
      type: Number,
      default: 2,
      min: 1,
      max: 24
    }
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

reminderSettingsSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// ✅ FIX: Use mongoose.models check
module.exports = mongoose.models.ReminderSettings || mongoose.model('ReminderSettings', reminderSettingsSchema);