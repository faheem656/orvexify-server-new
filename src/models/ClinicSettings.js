// src/models/ClinicSettings.js
const mongoose = require('mongoose');

const clinicSettingsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  
  // Reminder Settings
  reminderSettings: {
    enable24hReminder: { type: Boolean, default: true },
    enable2hReminder: { type: Boolean, default: true },
    enableCancellationEmail: { type: Boolean, default: true },
    sendRemindersOnWeekends: { type: Boolean, default: true },
    defaultReminderHours: {
      firstReminder: { type: Number, default: 24 },
      secondReminder: { type: Number, default: 2 }
    }
  },
  
  // Notification Settings
  notificationSettings: {
    emailNotifications: { type: Boolean, default: true },
    appointmentConfirmedNotify: { type: Boolean, default: true },
    appointmentCancelledNotify: { type: Boolean, default: true },
    noShowNotify: { type: Boolean, default: true },
    dailyDigest: { type: Boolean, default: false },
    weeklyReport: { type: Boolean, default: true }
  },
  
  // Email Templates
  emailTemplates: {
    reminder: {
      subject: { type: String, default: "Appointment Reminder: {{clinic_name}} - {{appointment_date}}" },
      body: { type: String, default: "" }
    },
    confirmation: {
      subject: { type: String, default: "Appointment Confirmed - {{clinic_name}}" },
      body: { type: String, default: "" }
    },
    cancellation: {
      subject: { type: String, default: "Appointment Cancelled - {{clinic_name}}" },
      body: { type: String, default: "" }
    }
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

clinicSettingsSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('ClinicSettings', clinicSettingsSchema);