// src/models/Appointment.js — Complete Fixed Version (Node.js)

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
    // ✅ 30-minute reminder tracking
  reminder30minSent: {
    type: Boolean,
    default: false
  },
  reminder30minLogId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ReminderLog'
  },

  // ✅ Reminder tracking - single definition (no duplicates)
  reminder24hSent: {
    type: Boolean,
    default: false
  },
  reminder2hSent: {
    type: Boolean,
    default: false
  },
  reminder24hLogId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ReminderLog',
    default: null
  },
  reminder2hLogId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ReminderLog',
    default: null
  },
  // ✅ Email tracking
  emailTrackingId: {
    type: String,
    default: null
  },
  reminderRetryCount: {
    type: Number,
    default: 0
  },
  lastReminderAttempt: {
    type: Date,
    default: null
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

appointmentSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes
appointmentSchema.index({ userId: 1, appointmentDate: 1 });
appointmentSchema.index({ doctorId: 1, appointmentDate: 1 });
appointmentSchema.index({ confirmationToken: 1 });
appointmentSchema.index({ cancellationToken: 1 });
appointmentSchema.index({ reminder24hSent: 1, appointmentDate: 1 });
appointmentSchema.index({ reminder2hSent: 1, appointmentDate: 1, appointmentTime: 1 });

module.exports = mongoose.model('Appointment', appointmentSchema);