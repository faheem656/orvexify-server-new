/** DROP-IN: src/models/ReminderLog.js
 * status.current includes confirmed / cancelled so a locked
 * confirm or cancel is not overwritten by later opens/clicks.
 */

const mongoose = require('mongoose');

const reminderLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment',
    required: true,
  },
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Patient',
    required: true,
  },
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Doctor',
    required: true,
  },
  reminderType: {
    type: String,
    enum: ['24h', '2h', '30min'],
    required: true,
  },
  sentAt: {
    type: Date,
    default: Date.now,
  },
  status: {
    current: {
      type: String,
      enum: [
        'pending',
        'sent',
        'delivered',
        'failed',
        'opened',
        'clicked',
        'confirmed',
        'cancelled',
        'no_response',
      ],
      default: 'pending',
    },
    isPending: { type: Boolean, default: true },
    isSent: { type: Boolean, default: false },
    isDelivered: { type: Boolean, default: false },
    isFailed: { type: Boolean, default: false },
    isOpened: { type: Boolean, default: false },
    isClicked: { type: Boolean, default: false },
    isNoResponse: { type: Boolean, default: false },
  },
  opened: { type: Boolean, default: false },
  openedAt: { type: Date, default: null },
  openedCount: { type: Number, default: 0 },
  clicked: { type: Boolean, default: false },
  clickedAction: {
    type: String,
    enum: ['confirm', 'cancel', 'no_response', null],
    default: null,
  },
  clickedAt: { type: Date, default: null },
  clickedCount: { type: Number, default: 0 },
  errorMessage: { type: String, default: null },
  retryCount: { type: Number, default: 0 },
  lastRetryAt: { type: Date, default: null },
  trackingToken: { type: String, default: null },
  trackingPixel: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

reminderLogSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

reminderLogSchema.index({ userId: 1, sentAt: -1 });
reminderLogSchema.index({ appointmentId: 1 });
reminderLogSchema.index({ trackingToken: 1 });
reminderLogSchema.index({ 'status.current': 1 });
reminderLogSchema.index({ opened: 1, clicked: 1 });

module.exports =
  mongoose.models.ReminderLog || mongoose.model('ReminderLog', reminderLogSchema);
