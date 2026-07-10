// src/models/Doctor.js
const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    default: ''
  },
  specialty: {
    type: String,
    required: true
  },
  imageIcon: {
    type: String,
    default: '👨‍⚕️'
  },
  bio: {
    type: String,
    default: ''
  },
  qualifications: [String],
  languages: [String],
  experience: {
    type: String,
    default: ''
  },
  consultationFee: {
    type: Number,
    default: 0
  },
  rating: {
    type: Number,
    default: 0
  },
  reviewCount: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  workingHours: {
    monday: { enabled: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '17:00' } },
    tuesday: { enabled: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '17:00' } },
    wednesday: { enabled: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '17:00' } },
    thursday: { enabled: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '17:00' } },
    friday: { enabled: { type: Boolean, default: true }, start: { type: String, default: '09:00' }, end: { type: String, default: '13:00' } },
    saturday: { enabled: { type: Boolean, default: false }, start: { type: String, default: '10:00' }, end: { type: String, default: '14:00' } },
    sunday: { enabled: { type: Boolean, default: false }, start: { type: String, default: '09:00' }, end: { type: String, default: '17:00' } }
  },
  breakTime: {
    enabled: { type: Boolean, default: true },
    start: { type: String, default: '13:00' },
    end: { type: String, default: '14:00' }
  },
  slotDuration: {
    type: Number,
    default: 30
  },
  bufferBetweenSlots: {
    type: Number,
    default: 5
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

doctorSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Doctor', doctorSchema);