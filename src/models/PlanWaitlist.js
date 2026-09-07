const mongoose = require('mongoose');

const planWaitlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    plan: {
      type: String,
      enum: ['growth', 'pro'],
      required: true,
    },
    email: {
      type: String,
      default: '',
      lowercase: true,
      trim: true,
    },
    clinicName: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: ['waiting', 'contacted', 'converted', 'removed'],
      default: 'waiting',
      index: true,
    },
    removedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

planWaitlistSchema.index({ user: 1, plan: 1 }, { unique: true });
planWaitlistSchema.index({ plan: 1, status: 1, createdAt: 1 });

module.exports =
  mongoose.models.PlanWaitlist ||
  mongoose.model('PlanWaitlist', planWaitlistSchema);
