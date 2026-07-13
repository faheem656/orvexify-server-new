// src/models/ReminderLog.js — Enhanced with Status Object

const mongoose = require("mongoose");

const reminderLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Appointment",
    required: true,
  },
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Patient",
    required: true,
  },
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Doctor",
    required: true,
  },
  reminderType: {
    type: String,
    enum: ["24h", "2h", "30min"],
    required: true,
  },
  sentAt: {
    type: Date,
    default: Date.now,
  },
  
  // ✅ NEW: Status Object (instead of single string)
  status: {
    // Current status of the email
    current: {
      type: String,
      enum: ["pending", "sent", "delivered", "failed", "opened", "clicked", "no_response"],
      default: "pending",
    },
    // ✅ All statuses as separate boolean fields
    isPending: { type: Boolean, default: true },
    isSent: { type: Boolean, default: false },
    isDelivered: { type: Boolean, default: false },
    isFailed: { type: Boolean, default: false },
    isOpened: { type: Boolean, default: false },
    isClicked: { type: Boolean, default: false },
    isNoResponse: { type: Boolean, default: false },
  },
  
  // ✅ Tracking fields
  opened: {
    type: Boolean,
    default: false,
  },
  openedAt: {
    type: Date,
    default: null,
  },
  openedCount: {
    type: Number,
    default: 0,
  },
  clicked: {
    type: Boolean,
    default: false,
  },
  clickedAction: {
    type: String,
    enum: ["confirm", "cancel", "no_response", null],
    default: null,
  },
  clickedAt: {
    type: Date,
    default: null,
  },
  clickedCount: {
    type: Number,
    default: 0,
  },
  
  // ✅ Error tracking
  errorMessage: {
    type: String,
    default: null,
  },
  retryCount: {
    type: Number,
    default: 0,
  },
  lastRetryAt: {
    type: Date,
    default: null,
  },
  trackingToken: {
    type: String,
    default: null,
  },
  trackingPixel: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// ✅ Pre-save hook: Auto-update status booleans based on current status
reminderLogSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // ✅ Reset all status booleans
  this.status.isPending = false;
  this.status.isSent = false;
  this.status.isDelivered = false;
  this.status.isFailed = false;
  this.status.isOpened = false;
  this.status.isClicked = false;
  this.status.isNoResponse = false;
  
  // ✅ Set the correct one based on current status
  switch (this.status.current) {
    case 'pending':
      this.status.isPending = true;
      break;
    case 'sent':
      this.status.isSent = true;
      break;
    case 'delivered':
      this.status.isDelivered = true;
      break;
    case 'failed':
      this.status.isFailed = true;
      break;
    case 'opened':
      this.status.isOpened = true;
      break;
    case 'clicked':
      this.status.isClicked = true;
      break;
    case 'no_response':
      this.status.isNoResponse = true;
      break;
    default:
      this.status.isPending = true;
  }
  
  next();
});

// ✅ Helper method to update status
reminderLogSchema.methods.updateStatus = function(newStatus) {
  this.status.current = newStatus;
  // Pre-save hook will handle the boolean updates
  return this.save();
};

// ✅ Helper method to mark as opened
reminderLogSchema.methods.markOpened = function() {
  this.opened = true;
  this.openedAt = new Date();
  this.openedCount = (this.openedCount || 0) + 1;
  this.status.current = 'opened';
  return this.save();
};

// ✅ Helper method to mark as clicked
reminderLogSchema.methods.markClicked = function(action) {
  this.clicked = true;
  this.clickedAt = new Date();
  this.clickedCount = (this.clickedCount || 0) + 1;
  this.clickedAction = action;
  this.status.current = 'clicked';
  return this.save();
};

// ✅ Helper method to mark as delivered
reminderLogSchema.methods.markDelivered = function() {
  this.status.current = 'delivered';
  return this.save();
};

// ✅ Helper method to mark as failed
reminderLogSchema.methods.markFailed = function(error) {
  this.status.current = 'failed';
  this.errorMessage = error;
  return this.save();
};

// ✅ Helper method to mark as no_response
reminderLogSchema.methods.markNoResponse = function() {
  this.status.current = 'no_response';
  return this.save();
};

// ✅ Indexes
reminderLogSchema.index({ userId: 1, sentAt: -1 });
reminderLogSchema.index({ appointmentId: 1 });
reminderLogSchema.index({ trackingToken: 1 });
reminderLogSchema.index({ 'status.current': 1 });
reminderLogSchema.index({ opened: 1, clicked: 1 });

module.exports = mongoose.model("ReminderLog", reminderLogSchema);