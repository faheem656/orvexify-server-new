const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    subscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },
    number: {
      type: String,
      required: true,
      unique: true,
    },
    planKey: {
      type: String,
      enum: ['starter', 'growth', 'pro'],
      required: true,
    },
    interval: {
      type: String,
      enum: ['monthly', 'yearly'],
      required: true,
    },
    amountCents: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'USD',
    },
    status: {
      type: String,
      enum: ['draft', 'paid', 'void', 'refunded', 'failed'],
      default: 'draft',
      index: true,
    },
    periodStart: {
      type: Date,
      default: null,
    },
    periodEnd: {
      type: Date,
      default: null,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    stripeInvoiceId: {
      type: String,
      default: null,
    },
    stripeCheckoutSessionId: {
      type: String,
      default: null,
    },
    note: {
      type: String,
      default: '',
      maxlength: 500,
    },
  },
  { timestamps: true }
);

invoiceSchema.index({ user: 1, createdAt: -1 });
invoiceSchema.index({ stripeInvoiceId: 1 }, { unique: true, sparse: true });

invoiceSchema.virtual('amount').get(function amount() {
  return Math.round(this.amountCents) / 100;
});

invoiceSchema.set('toJSON', { virtuals: true });
invoiceSchema.set('toObject', { virtuals: true });

module.exports =
  mongoose.models.Invoice || mongoose.model('Invoice', invoiceSchema);
