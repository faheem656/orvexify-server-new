const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    planKey: {
      type: String,
      enum: ['free', 'starter', 'growth', 'pro'],
      default: 'free',
      required: true,
    },
    interval: {
      type: String,
      enum: ['monthly', 'yearly'],
    },
    status: {
      type: String,
      enum: ['unpaid', 'active', 'canceling', 'canceled', 'past_due'],
      default: 'unpaid',
      index: true,
    },
    currency: {
      type: String,
      default: 'USD',
    },
    currentPeriodStart: {
      type: Date,
      default: null,
    },
    currentPeriodEnd: {
      type: Date,
      default: null,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    canceledAt: {
      type: Date,
      default: null,
    },
    stripeCustomerId: {
      type: String,
      default: null,
      index: true,
    },
    stripeSubscriptionId: {
      type: String,
      default: null,
    },
    stripePriceId: {
      type: String,
      default: null,
    },
    grantedBy: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

subscriptionSchema.index({ planKey: 1, status: 1 });
subscriptionSchema.index(
  { stripeSubscriptionId: 1 },
  { unique: true, sparse: true }
);

module.exports =
  mongoose.models.Subscription ||
  mongoose.model('Subscription', subscriptionSchema);
