// src/models/Appointment.js — Complete with Queue Backup Fields

const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true
  },
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Doctor',
    required: true
  },
  appointmentDate: {
    type: String,
    required: true
  },
  appointmentTime: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['scheduled', 'confirmed', 'cancelled', 'completed', 'no_show'],
    default: 'scheduled'
  },
  confirmationStatus: {
    type: String,
    enum: ['pending', 'confirmed', 'cancelled', 'no_response'],
    default: 'pending'
  },
  confirmationToken: {
    type: String,
    default: null
  },
  cancellationToken: {
    type: String,
    default: null
  },
  notes: {
    type: String,
    default: ''
  },
  
  // ============ REMINDER TRACKING ============
  
  // ✅ 24h Reminder
  reminder24hSent: {
    type: Boolean,
    default: false
  },
  reminder24hLogId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ReminderLog',
    default: null
  },
  reminder24hSentAt: {
    type: Date,
    default: null
  },
  reminder24hCancelled: {
    type: Boolean,
    default: false
  },
  
  // ✅ 2h Reminder
  reminder2hSent: {
    type: Boolean,
    default: false
  },
  reminder2hLogId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ReminderLog',
    default: null
  },
  reminder2hSentAt: {
    type: Date,
    default: null
  },
  reminder2hCancelled: {
    type: Boolean,
    default: false
  },
  
  // ✅ 30min Reminder
  reminder30minSent: {
    type: Boolean,
    default: false
  },
  reminder30minLogId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ReminderLog',
    default: null
  },
  reminder30minSentAt: {
    type: Date,
    default: null
  },
  reminder30minCancelled: {
    type: Boolean,
    default: false
  },
  
  // ============ QUEUE BACKUP FIELDS (For Bull + DB Backup System) ============
  
  // ✅ 24h Queue Tracking
  reminder24hQueued: {
    type: Boolean,
    default: false
  },
  reminder24hQueuedAt: {
    type: Date,
    default: null
  },
  reminder24hProcessing: {
    type: Boolean,
    default: false
  },
  reminder24hFailed: {
    type: Boolean,
    default: false
  },
  reminder24hError: {
    type: String,
    default: null
  },
  reminder24hJobId: {
    type: String,
    default: null
  },
  
  // ✅ 2h Queue Tracking
  reminder2hQueued: {
    type: Boolean,
    default: false
  },
  reminder2hQueuedAt: {
    type: Date,
    default: null
  },
  reminder2hProcessing: {
    type: Boolean,
    default: false
  },
  reminder2hFailed: {
    type: Boolean,
    default: false
  },
  reminder2hError: {
    type: String,
    default: null
  },
  reminder2hJobId: {
    type: String,
    default: null
  },
  
  // ✅ 30min Queue Tracking
  reminder30minQueued: {
    type: Boolean,
    default: false
  },
  reminder30minQueuedAt: {
    type: Date,
    default: null
  },
  reminder30minProcessing: {
    type: Boolean,
    default: false
  },
  reminder30minFailed: {
    type: Boolean,
    default: false
  },
  reminder30minError: {
    type: String,
    default: null
  },
  reminder30minJobId: {
    type: String,
    default: null
  },
  
  // ============ GENERAL ============
  reminderScheduled: {
    type: Boolean,
    default: false
  },
  reminderRetryCount: {
    type: Number,
    default: 0
  },
  lastReminderAttempt: {
    type: Date,
    default: null
  },
  emailTrackingId: {
    type: String,
    default: null
  },
  
  // ============ TIMESTAMPS ============
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// ============ PRE-SAVE HOOK ============
appointmentSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// ============ INDEXES ============
appointmentSchema.index({ userId: 1, appointmentDate: 1 });
appointmentSchema.index({ doctorId: 1, appointmentDate: 1 });
appointmentSchema.index({ confirmationToken: 1 });
appointmentSchema.index({ cancellationToken: 1 });

// ✅ Queue indexes
appointmentSchema.index({ reminder24hQueued: 1, reminder24hSent: 1, appointmentDate: 1 });
appointmentSchema.index({ reminder2hQueued: 1, reminder2hSent: 1, appointmentDate: 1 });
appointmentSchema.index({ reminder30minQueued: 1, reminder30minSent: 1, appointmentDate: 1 });
appointmentSchema.index({ reminderScheduled: 1, confirmationStatus: 1 });

// ✅ Recovery indexes
appointmentSchema.index({ reminder24hProcessing: 1, reminder24hQueuedAt: 1 });
appointmentSchema.index({ reminder2hProcessing: 1, reminder2hQueuedAt: 1 });
appointmentSchema.index({ reminder30minProcessing: 1, reminder30minQueuedAt: 1 });

// ✅ Date indexes
appointmentSchema.index({ appointmentDate: 1, appointmentTime: 1 });

module.exports = mongoose.model('Appointment', appointmentSchema);