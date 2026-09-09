/**
 * Billing controller — Starter, Growth and Pro via Stripe Checkout.
 * WhatsApp reminders: coming soon on Growth + Pro (not live yet).
 * No SMS. No unused-period refund. No 3 months free.
 */

const Subscription = require('../models/Subscription');
const Invoice = require('../models/Invoice');
const PlanWaitlist = require('../models/PlanWaitlist');

const PLANS = {
  free: {
    key: 'free',
    name: 'Free',
    tagline: '1 doctor, 15 appointments / month',
    availability: 'in_stock',
    purchasable: false,
    waitlist: false,
    prices: { monthly: 0, yearly: 0 },
    limits: { clinics: 1, doctors: 1, appointmentsPerMonth: 15 },
    features: {
      emailReminders: true,
      reminderHours: [24, 2, 0.5],
      whatsapp: 'off',
      googleCalendar: 'off',
    },
  },
  starter: {
    key: 'starter',
    name: 'Starter',
    tagline: 'Solo doctors and small clinics',
    availability: 'in_stock',
    purchasable: true,
    waitlist: false,
    prices: { monthly: 14.99, yearly: 149.9 },
    limits: { clinics: 1, doctors: 2, appointmentsPerMonth: 300 },
    features: {
      emailReminders: true,
      reminderHours: [24, 2, 0.5],
      whatsapp: 'off',
      googleCalendar: 'coming_soon',
    },
  },
  growth: {
    key: 'growth',
    name: 'Growth',
    tagline: 'Growing clinics',
    availability: 'in_stock',
    purchasable: true,
    waitlist: false,
    prices: { monthly: 29.99, yearly: 299.9 },
    limits: { clinics: 1, doctors: 6, appointmentsPerMonth: 1500 },
    features: {
      emailReminders: true,
      reminderHours: [24, 2, 0.5],
      whatsapp: 'coming_soon',
      googleCalendar: 'coming_soon',
    },
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    tagline: 'Large clinics',
    availability: 'in_stock',
    purchasable: true,
    waitlist: false,
    prices: { monthly: 69, yearly: 690 },
    limits: { clinics: 1, doctors: null, appointmentsPerMonth: null },
    features: {
      emailReminders: true,
      reminderHours: [24, 2, 0.5],
      whatsapp: 'coming_soon',
      googleCalendar: 'coming_soon',
    },
  },
};

const PLAN_KEYS = ['starter', 'growth', 'pro'];
const INTERVALS = ['monthly', 'yearly'];

const PRICE_ENV = {
  starter: {
    monthly: 'STRIPE_PRICE_STARTER_MONTHLY',
    yearly: 'STRIPE_PRICE_STARTER_YEARLY',
  },
  growth: {
    monthly: 'STRIPE_PRICE_GROWTH_MONTHLY',
    yearly: 'STRIPE_PRICE_GROWTH_YEARLY',
  },
  pro: {
    monthly: 'STRIPE_PRICE_PRO_MONTHLY',
    yearly: 'STRIPE_PRICE_PRO_YEARLY',
  },
};

function getPlan(key) {
  return PLANS[key] || null;
}

function isPaidStatus(status) {
  return status === 'active' || status === 'canceling' || status === 'past_due';
}

function planForSub(sub) {
  if (!sub || !isPaidStatus(sub.status)) return PLANS.free;
  return getPlan(sub.planKey) || PLANS.free;
}

function priceIdFor(planKey, interval) {
  const row = PRICE_ENV[planKey];
  if (!row || !INTERVALS.includes(interval)) return null;
  return process.env[row[interval]] || null;
}

function planFromPriceId(priceId) {
  if (!priceId) return null;
  for (let i = 0; i < PLAN_KEYS.length; i += 1) {
    const key = PLAN_KEYS[i];
    for (let j = 0; j < INTERVALS.length; j += 1) {
      const interval = INTERVALS[j];
      if (process.env[PRICE_ENV[key][interval]] === priceId) {
        return { planKey: key, interval };
      }
    }
  }
  return null;
}

function isPlanCheckoutLive(planKey) {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
      priceIdFor(planKey, 'monthly') &&
      priceIdFor(planKey, 'yearly')
  );
}

function isCheckoutLive() {
  return PLAN_KEYS.some(isPlanCheckoutLive);
}

function clientUrl() {
  return (
    process.env.CLIENT_URL ||
    process.env.FRONTEND_URL ||
    'https://orvexify.com'
  );
}

function amountCents(key, interval) {
  const plan = getPlan(key);
  if (!plan || !INTERVALS.includes(interval)) return null;
  return Math.round(plan.prices[interval] * 100);
}

function publicPlan(key, extras) {
  const plan = getPlan(key);
  if (!plan) return null;
  return {
    key: plan.key,
    name: plan.name,
    tagline: plan.tagline,
    availability: plan.availability,
    purchasable: plan.purchasable,
    checkoutLive: plan.purchasable ? isPlanCheckoutLive(plan.key) : false,
    waitlist: plan.waitlist,
    prices: plan.prices,
    limits: plan.limits,
    features: plan.features,
    ...(extras || {}),
  };
}

function catalog(extrasByKey) {
  return PLAN_KEYS.map((key) =>
    publicPlan(key, extrasByKey && extrasByKey[key])
  );
}

let stripeClient = null;
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (stripeClient) return stripeClient;
  let Stripe;
  try {
    Stripe = require('stripe');
  } catch {
    const err = new Error('Run npm install stripe in the API folder');
    err.code = 'STRIPE_NOT_INSTALLED';
    err.status = 500;
    throw err;
  }
  stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripeClient;
}

function loadUserModel() {
  try {
    return require('../models/User');
  } catch {
    return require('../models/User');
  }
}

function loadDoctorModel() {
  try {
    return require('../models/Doctor');
  } catch {
    return require('../models/Doctor');
  }
}

function loadAppointmentModel() {
  try {
    return require('../models/Appointment');
  } catch {
    return require('../models/Appointment');
  }
}

function userIdOf(userOrId) {
  if (!userOrId) return null;
  if (typeof userOrId === 'string') return userOrId;
  return userOrId._id || userOrId.id || null;
}

function ownerQuery(userId) {
  const field = process.env.BILLING_OWNER_FIELD;
  if (field) return { [field]: userId };
  return { $or: [{ user: userId }, { userId }] };
}

function utcMonthRange(now) {
  const d = now ? new Date(now) : new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { start, end };
}

function unixToDate(unix) {
  if (!unix) return null;
  return new Date(unix * 1000);
}

function idOf(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.id || null;
}

function sessionSubscriptionId(session) {
  return (
    idOf(session && session.subscription) ||
    idOf(
      session &&
        session.subscription_details &&
        session.subscription_details.subscription
    )
  );
}

function invoiceSubscriptionId(inv) {
  return (
    idOf(inv && inv.subscription) ||
    idOf(
      inv &&
        inv.parent &&
        inv.parent.subscription_details &&
        inv.parent.subscription_details.subscription
    ) ||
    idOf(
      inv &&
        inv.lines &&
        inv.lines.data &&
        inv.lines.data[0] &&
        inv.lines.data[0].subscription
    )
  );
}

function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('billing', err);
  return res.status(status).json({
    success: false,
    code: err.code || 'BILLING_ERROR',
    message: err.message || 'Billing error',
    ...(err.meta ? { meta: err.meta } : {}),
  });
}

function actor(req) {
  const user = req.user || {};
  return {
    _id: user._id || user.id,
    id: user.id || user._id,
    email: user.email,
    clinicName: user.clinicName,
    fullName: user.fullName,
  };
}

function httpError(message, code, status, meta) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (meta) err.meta = meta;
  return err;
}

async function syncUser(userId, sub) {
  let User;
  try {
    User = loadUserModel();
  } catch {
    return;
  }
  const plan = planForSub(sub);
  await User.updateOne(
    { _id: userId },
    { $set: { planKey: plan.key, plan: plan.key, billingStatus: sub.status } }
  );
}

async function ensureSubscription(userOrId) {
  const userId = userIdOf(userOrId);
  if (!userId) throw new Error('ensureSubscription: missing user id');

  let sub = await Subscription.findOne({ user: userId });
  if (sub) return sub;

  try {
    sub = await Subscription.create({
      user: userId,
      planKey: 'free',
      status: 'unpaid',
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return Subscription.findOne({ user: userId });
    }
    throw err;
  }

  await syncUser(userId, sub);
  return sub;
}

async function countDoctors(userId) {
  const Doctor = loadDoctorModel();
  return Doctor.countDocuments({
    $or: [{ userId }, { user: userId }],
    isDeleted: { $ne: true },
  });
}

async function countAppointmentsThisMonth(userId, now) {
  const Appointment = loadAppointmentModel();
  const { start, end } = utcMonthRange(now);
  const dateField = process.env.BILLING_APPOINTMENT_DATE_FIELD || 'appointmentDate';
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);
  const base = {
    ...ownerQuery(userId),
    isDeleted: { $ne: true },
    status: { $nin: ['cancelled', 'canceled'] },
  };

  const asString = await Appointment.countDocuments({
    ...base,
    [dateField]: { $gte: startStr, $lt: endStr },
  });
  if (asString > 0) return asString;

  return Appointment.countDocuments({
    ...base,
    [dateField]: { $gte: start, $lt: end },
  });
}

async function getUsage(userId, planKey) {
  const plan = getPlan(planKey) || PLANS.free;
  let doctors = 0;
  let appointments = 0;

  try {
    doctors = await countDoctors(userId);
  } catch (err) {
    console.error('billing.getUsage doctors', err.message);
  }

  try {
    appointments = await countAppointmentsThisMonth(userId);
  } catch (err) {
    console.error('billing.getUsage appointments', err.message);
  }

  const { start, end } = utcMonthRange();
  return {
    doctors: { used: doctors, limit: plan.limits.doctors },
    appointments: {
      used: appointments,
      limit: plan.limits.appointmentsPerMonth,
      periodStart: start,
      periodEnd: end,
    },
  };
}

async function waitlistMap(userId) {
  const rows = await PlanWaitlist.find({
    user: userId,
    status: { $in: ['waiting', 'contacted'] },
  }).lean();

  const map = { growth: false, pro: false };
  rows.forEach((row) => {
    if (row.plan === 'growth' || row.plan === 'pro') map[row.plan] = true;
  });
  return map;
}

function serializeSubscription(sub) {
  const plan = planForSub(sub);
  return {
    planKey: plan.key,
    planName: plan.name,
    interval: sub.interval || null,
    status: sub.status,
    currency: sub.currency || 'USD',
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: Boolean(sub.cancelAtPeriodEnd),
    canceledAt: sub.canceledAt,
    purchasable: plan.purchasable,
    checkoutLive: plan.purchasable ? isPlanCheckoutLive(sub.planKey) : false,
    availability: plan.availability,
    hasStripeCustomer: Boolean(sub.stripeCustomerId),
  };
}

function serializeInvoice(doc) {
  const row = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const cents = row.amountCents || 0;
  return {
    id: String(row._id),
    number: row.number,
    planKey: row.planKey,
    interval: row.interval,
    amount: Math.round(cents) / 100,
    amountCents: cents,
    currency: row.currency || 'USD',
    status: row.status,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    paidAt: row.paidAt,
    note: row.note || '',
    createdAt: row.createdAt,
  };
}

async function getOverview(user) {
  const userId = userIdOf(user);
  const sub = await ensureSubscription(userId);

  if (
    sub.stripeCustomerId &&
    process.env.STRIPE_SECRET_KEY &&
    (sub.status === 'unpaid' || !sub.stripeSubscriptionId)
  ) {
    try {
      await syncCustomerFromStripe(sub);
    } catch (err) {
      console.error('billing.syncCustomerFromStripe', err.message);
    }
  }

  let [usage, waitlist, invoices] = await Promise.all([
    getUsage(userId, planForSub(sub).key),
    waitlistMap(userId),
    Invoice.find({ user: userId }).sort({ createdAt: -1 }).limit(12).lean(),
  ]);

  if (sub.stripeCustomerId && invoices.length === 0 && process.env.STRIPE_SECRET_KEY) {
    try {
      await pullStripeInvoices(sub);
      invoices = await Invoice.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(12)
        .lean();
    } catch (err) {
      console.error('billing.pullStripeInvoices', err.message);
    }
  }

  const extras = {
    starter: {
      onWaitlist: false,
      isCurrent: isPaidStatus(sub.status) && sub.planKey === 'starter',
    },
    growth: {
      onWaitlist: Boolean(waitlist.growth),
      isCurrent: isPaidStatus(sub.status) && sub.planKey === 'growth',
    },
    pro: {
      onWaitlist: Boolean(waitlist.pro),
      isCurrent: isPaidStatus(sub.status) && sub.planKey === 'pro',
    },
  };

  let paymentMethods = [];
  try {
    paymentMethods = await listCustomerCards(sub);
  } catch (err) {
    console.error('billing.listCustomerCards', err.message);
  }
  const paymentMethod = paymentMethods[0] || null;

  return {
    subscription: serializeSubscription(sub),
    plans: catalog(extras),
    usage,
    waitlist,
    invoices: invoices.map(serializeInvoice),
    paymentMethod,
    paymentMethods,
    features: {
      emailReminders: true,
      reminderHours: [24, 2, 0.5],
      whatsapp: planForSub(sub).features.whatsapp,
    },
    checkoutLive: isCheckoutLive(),
    publishableKey:
      process.env.STRIPE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
      '',
  };
}

async function joinWaitlist(user, planKey) {
  throw httpError(
    'Growth and Pro are live. Use POST /billing/subscribe. WhatsApp reminders on those plans go live in a few days.',
    'PLAN_LIVE',
    400
  );
}

async function leaveWaitlist(user, planKey) {
  if (planKey !== 'growth' && planKey !== 'pro') {
    throw httpError('Unknown plan', 'PLAN_NOT_WAITLIST', 400);
  }

  await PlanWaitlist.findOneAndUpdate(
    { user: userIdOf(user), plan: planKey },
    { $set: { status: 'removed', removedAt: new Date() } }
  );

  return { plan: planKey, onWaitlist: false };
}

async function applyStripeSubscription(sub, stripeSub, intervalHint, planHint) {
  const userId = sub.user;
  const item =
    stripeSub.items && stripeSub.items.data && stripeSub.items.data[0];
  const priceObj = item && item.price;
  const priceId = typeof priceObj === 'string' ? priceObj : priceObj && priceObj.id;
  const matched = planFromPriceId(priceId);
  const metaPlan = stripeSub.metadata && stripeSub.metadata.planKey;
  const metaInterval = stripeSub.metadata && stripeSub.metadata.interval;

  const stripeStatus = stripeSub.status;
  if (stripeStatus === 'canceled') {
    sub.status = 'canceled';
  } else if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') {
    sub.status = 'past_due';
  } else if (stripeSub.cancel_at_period_end) {
    sub.status = 'canceling';
  } else if (stripeStatus === 'active' || stripeStatus === 'trialing') {
    sub.status = 'active';
  }

  sub.planKey =
    (matched && matched.planKey) ||
    planHint ||
    metaPlan ||
    sub.planKey ||
    'free';
  if (!isPaidStatus(sub.status)) {
    sub.planKey = 'free';
  }
  sub.interval =
    (matched && matched.interval) ||
    intervalHint ||
    metaInterval ||
    sub.interval ||
    'monthly';
  sub.stripeSubscriptionId = stripeSub.id;
  sub.stripePriceId = priceId || sub.stripePriceId;
  if (stripeSub.customer) {
    sub.stripeCustomerId =
      typeof stripeSub.customer === 'string'
        ? stripeSub.customer
        : stripeSub.customer.id;
  }
  sub.currentPeriodStart = unixToDate(
    stripeSub.current_period_start || (item && item.current_period_start)
  );
  sub.currentPeriodEnd = unixToDate(
    stripeSub.current_period_end || (item && item.current_period_end)
  );
  sub.cancelAtPeriodEnd = Boolean(stripeSub.cancel_at_period_end);
  if (sub.status === 'canceled' && !sub.canceledAt) sub.canceledAt = new Date();
  if (sub.status === 'active') {
    sub.canceledAt = sub.cancelAtPeriodEnd ? sub.canceledAt : null;
  }

  await sub.save();
  await syncUser(userId, sub);
  return sub;
}

async function nextInvoiceNumber() {
  const year = new Date().getUTCFullYear();
  const prefix = `INV-${year}-`;
  const last = await Invoice.findOne({ number: new RegExp(`^${prefix}`) })
    .sort({ number: -1 })
    .select('number')
    .lean();

  let seq = 1;
  if (last && last.number) {
    const n = parseInt(String(last.number).slice(prefix.length), 10);
    if (Number.isFinite(n)) seq = n + 1;
  }

  for (let i = 0; i < 8; i += 1) {
    const number = `${prefix}${String(seq + i).padStart(5, '0')}`;
    const exists = await Invoice.exists({ number });
    if (!exists) return number;
  }
  return `${prefix}${Date.now()}`;
}

async function recordStripeInvoice(sub, stripeInvoice) {
  if (!stripeInvoice || !stripeInvoice.id) return null;
  const existing = await Invoice.findOne({ stripeInvoiceId: stripeInvoice.id });
  if (existing) return existing;

  const paid =
    stripeInvoice.status === 'paid' || stripeInvoice.paid === true;
  const cents =
    typeof stripeInvoice.amount_paid === 'number'
      ? stripeInvoice.amount_paid
      : amountCents(sub.planKey || 'starter', sub.interval || 'monthly');

  try {
    return await Invoice.create({
      user: sub.user,
      subscription: sub._id,
      number: stripeInvoice.number || (await nextInvoiceNumber()),
      planKey: sub.planKey || 'starter',
      interval: sub.interval || 'monthly',
      amountCents: cents || 0,
      currency: (stripeInvoice.currency || 'usd').toUpperCase(),
      status: paid ? 'paid' : stripeInvoice.status === 'open' ? 'draft' : 'failed',
      periodStart: unixToDate(
        stripeInvoice.period_start ||
          (stripeInvoice.lines &&
            stripeInvoice.lines.data &&
            stripeInvoice.lines.data[0] &&
            stripeInvoice.lines.data[0].period &&
            stripeInvoice.lines.data[0].period.start)
      ),
      periodEnd: unixToDate(
        stripeInvoice.period_end ||
          (stripeInvoice.lines &&
            stripeInvoice.lines.data &&
            stripeInvoice.lines.data[0] &&
            stripeInvoice.lines.data[0].period &&
            stripeInvoice.lines.data[0].period.end)
      ),
      paidAt: paid ? unixToDate(stripeInvoice.status_transitions && stripeInvoice.status_transitions.paid_at) || new Date() : null,
      stripeInvoiceId: stripeInvoice.id,
      note: 'Stripe',
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return Invoice.findOne({ stripeInvoiceId: stripeInvoice.id });
    }
    throw err;
  }
}

async function findSubByStripe(stripeSubId, customerId, userId) {
  if (stripeSubId) {
    const bySub = await Subscription.findOne({ stripeSubscriptionId: stripeSubId });
    if (bySub) return bySub;
  }
  if (customerId) {
    const byCust = await Subscription.findOne({ stripeCustomerId: customerId });
    if (byCust) return byCust;
  }
  if (userId) {
    return ensureSubscription(userId);
  }
  return null;
}

async function pullStripeInvoices(sub) {
  if (!sub || !sub.stripeCustomerId || !getStripe()) return;
  const stripe = getStripe();
  const list = await stripe.invoices.list({
    customer: sub.stripeCustomerId,
    limit: 12,
  });
  const rows = list.data || [];
  for (let i = 0; i < rows.length; i += 1) {
    await recordStripeInvoice(sub, rows[i]);
  }
}

async function syncCustomerFromStripe(sub) {
  if (!sub || !sub.stripeCustomerId || !getStripe()) return sub;
  const stripe = getStripe();
  const list = await stripe.subscriptions.list({
    customer: sub.stripeCustomerId,
    status: 'all',
    limit: 10,
  });
  const rows = list.data || [];
  const live =
    rows.find(
      (row) =>
        row.status === 'active' ||
        row.status === 'trialing' ||
        row.status === 'past_due'
    ) || rows[0];
  if (!live) return sub;

  const intervalHint =
    (live.metadata && live.metadata.interval) || sub.interval || 'monthly';
  const planHint =
    (live.metadata && live.metadata.planKey) || sub.planKey || 'starter';
  await applyStripeSubscription(sub, live, intervalHint, planHint);
  await pullStripeInvoices(sub);
  return sub;
}

async function applyCompletedCheckoutSession(session, subHint) {
  const stripe = getStripe();
  const full = await stripe.checkout.sessions.retrieve(session.id || session, {
    expand: ['subscription', 'invoice', 'setup_intent'],
  });

  if (full.mode === 'setup') {
    const userId =
      (full.metadata && full.metadata.userId) || full.client_reference_id;
    const sub =
      subHint || (await findSubByStripe(null, full.customer, userId));
    if (sub) await applySetupSessionToSub(sub, full);
    return { kind: 'setup', subscription: sub || null };
  }

  if (full.mode !== 'subscription') {
    return { kind: 'other', subscription: subHint || null };
  }

  const subId = sessionSubscriptionId(full);
  if (!subId) {
    console.error('billing: checkout complete without subscription', full.id);
    return { kind: 'missing', subscription: subHint || null };
  }

  const stripeSub =
    full.subscription &&
    typeof full.subscription === 'object' &&
    full.subscription.items
      ? full.subscription
      : await stripe.subscriptions.retrieve(subId);

  const userId =
    (full.metadata && full.metadata.userId) || full.client_reference_id;
  const interval =
    (full.metadata && full.metadata.interval) ||
    (stripeSub.metadata && stripeSub.metadata.interval) ||
    'monthly';
  const planKey =
    (full.metadata && full.metadata.planKey) ||
    (stripeSub.metadata && stripeSub.metadata.planKey) ||
    'starter';

  const sub =
    subHint ||
    (await findSubByStripe(stripeSub.id, full.customer, userId));
  if (!sub) {
    console.error('billing: no mongo sub for checkout', full.id);
    return { kind: 'missing', subscription: null };
  }

  const previousId =
    (full.metadata && full.metadata.previousSubscriptionId) ||
    (sub.stripeSubscriptionId && sub.stripeSubscriptionId !== stripeSub.id
      ? sub.stripeSubscriptionId
      : null);

  await applyStripeSubscription(sub, stripeSub, interval, planKey);
  await cancelPreviousSubscription(previousId, stripeSub.id);

  let invoice = full.invoice;
  if (typeof invoice === 'string') {
    invoice = await stripe.invoices.retrieve(invoice);
  }
  if (!invoice && stripeSub.latest_invoice) {
    invoice =
      typeof stripeSub.latest_invoice === 'string'
        ? await stripe.invoices.retrieve(stripeSub.latest_invoice)
        : stripeSub.latest_invoice;
  }
  if (invoice) await recordStripeInvoice(sub, invoice);

  return { kind: 'subscription', subscription: sub };
}

async function cancelPreviousSubscription(previousId, keepId) {
  if (!previousId || previousId === keepId || !getStripe()) return;
  const stripe = getStripe();
  try {
    await stripe.subscriptions.cancel(previousId, { prorate: false });
  } catch (err) {
    try {
      await stripe.subscriptions.cancel(previousId);
    } catch (err2) {
      console.error('billing.cancelPrevious', err2.message);
    }
  }
}

async function ensureStripeCustomer(user, sub) {
  const stripe = getStripe();
  if (sub.stripeCustomerId) return sub.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: user.email || undefined,
    name: user.clinicName || user.fullName || undefined,
    metadata: { userId: String(userIdOf(user)) },
  });
  sub.stripeCustomerId = customer.id;
  await sub.save();
  return customer.id;
}

async function clientSecretFromSubscription(stripe, stripeSub) {
  let invoice = stripeSub && stripeSub.latest_invoice;
  if (!invoice) {
    throw httpError('Could not start card form', 'NO_INVOICE', 500);
  }
  if (typeof invoice === 'string') {
    try {
      invoice = await stripe.invoices.retrieve(invoice, {
        expand: ['payment_intent'],
      });
    } catch {
      invoice = await stripe.invoices.retrieve(invoice);
    }
  }
  const pi = invoice.payment_intent;
  if (pi && typeof pi === 'object' && pi.client_secret) return pi.client_secret;
  if (typeof pi === 'string') {
    const full = await stripe.paymentIntents.retrieve(pi);
    if (full && full.client_secret) return full.client_secret;
  }
  const nested =
    invoice.confirmation_secret &&
    (invoice.confirmation_secret.client_secret || invoice.confirmation_secret);
  if (typeof nested === 'string' && nested) return nested;
  throw httpError('Could not start card form', 'NO_CLIENT_SECRET', 500);
}

async function createCheckoutSession(user, interval, planKey) {
  if (!getPlan(planKey) || !getPlan(planKey).purchasable) {
    throw httpError('Unknown plan', 'PLAN_NOT_PURCHASABLE', 400);
  }
  if (!INTERVALS.includes(interval)) {
    throw httpError('interval must be monthly or yearly', 'BAD_INTERVAL', 400);
  }
  if (!isPlanCheckoutLive(planKey)) {
    throw httpError(
      `Set Stripe price IDs for ${planKey} (monthly and yearly). Email support@orvexify.com.`,
      'CHECKOUT_NOT_LIVE',
      400
    );
  }

  const userId = userIdOf(user);
  const sub = await ensureSubscription(userId);
  const stripe = getStripe();

  if (
    sub.stripeSubscriptionId &&
    (sub.status === 'active' || sub.status === 'canceling' || sub.status === 'past_due')
  ) {
    if (sub.planKey === planKey && sub.interval === interval && sub.status === 'active') {
      throw httpError(
        'This plan is already active. Update the card from Manage card on this page.',
        'ALREADY_SUBSCRIBED',
        400
      );
    }
  }

  const customerId = await ensureStripeCustomer(user, sub);
  const previousSubscriptionId = sub.stripeSubscriptionId || '';
  const switching = Boolean(
    previousSubscriptionId &&
      (sub.status === 'active' ||
        sub.status === 'canceling' ||
        sub.status === 'past_due') &&
      (sub.planKey !== planKey || sub.interval !== interval)
  );

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ['card'],
    usage: 'off_session',
    metadata: {
      userId: String(userId),
      planKey,
      interval,
      previousSubscriptionId,
      previousPlanKey: sub.planKey || '',
      purpose: 'subscribe',
    },
  });

  return {
    paymentElement: true,
    clientSecret: setupIntent.client_secret,
    sessionId: setupIntent.id,
    setupIntentId: setupIntent.id,
    changed: false,
    switching,
    fromPlan: switching ? sub.planKey : null,
    toPlan: planKey,
  };
}

function serializeCard(pm) {
  if (!pm) return null;
  if (pm.card) {
    return {
      id: pm.id || null,
      brand: pm.card.brand || 'card',
      last4: pm.card.last4 || '',
      expMonth: pm.card.exp_month || null,
      expYear: pm.card.exp_year || null,
    };
  }
  return null;
}

async function listCustomerCards(sub) {
  if (!sub || !sub.stripeCustomerId || !getStripe()) return [];
  const stripe = getStripe();
  const byId = {};

  const add = (pm) => {
    const row = serializeCard(pm);
    if (!row || !row.last4) return;
    const key = row.id || `${row.brand}-${row.last4}`;
    if (!byId[key]) byId[key] = row;
  };

  try {
    if (stripe.customers && typeof stripe.customers.listPaymentMethods === 'function') {
      const listed = await stripe.customers.listPaymentMethods(sub.stripeCustomerId, {
        limit: 10,
      });
      (listed.data || []).forEach(add);
    }
  } catch (err) {
    console.error('billing.customers.listPaymentMethods', err.message);
  }

  try {
    const listed = await stripe.paymentMethods.list({
      customer: sub.stripeCustomerId,
      type: 'card',
      limit: 10,
    });
    (listed.data || []).forEach(add);
  } catch (err) {
    console.error('billing.paymentMethods.list', err.message);
  }

  try {
    const customer = await stripe.customers.retrieve(sub.stripeCustomerId, {
      expand: ['invoice_settings.default_payment_method'],
    });
    add(customer.invoice_settings && customer.invoice_settings.default_payment_method);
  } catch (err) {
    console.error('billing.customerDefaultPm', err.message);
  }

  if (sub.stripeSubscriptionId) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId, {
        expand: ['default_payment_method'],
      });
      add(stripeSub.default_payment_method);
      const pmId = idOf(stripeSub.default_payment_method);
      if (pmId) {
        try {
          await applyPaymentMethod(sub, pmId);
        } catch (err) {
          console.error('billing.applyDefaultPm', err.message);
        }
      }
    } catch (err) {
      console.error('billing.subDefaultPm', err.message);
    }
  }

  return Object.keys(byId).map((key) => byId[key]);
}

async function getDefaultCard(sub) {
  const cards = await listCustomerCards(sub);
  return cards[0] || null;
}

async function applyPaymentMethod(sub, paymentMethodId) {
  if (!sub || !paymentMethodId) return;
  const stripe = getStripe();
  if (sub.stripeCustomerId) {
    await stripe.customers.update(sub.stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  }
  if (sub.stripeSubscriptionId) {
    try {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        default_payment_method: paymentMethodId,
      });
    } catch (err) {
      console.error('billing.applyPaymentMethod subscription', err.message);
    }
  }
}

async function applySetupSessionToSub(sub, session) {
  const stripe = getStripe();
  let setupIntent = session && session.setup_intent;
  if (typeof setupIntent === 'string') {
    setupIntent = await stripe.setupIntents.retrieve(setupIntent);
  }
  const pmId =
    setupIntent &&
    (typeof setupIntent.payment_method === 'string'
      ? setupIntent.payment_method
      : setupIntent.payment_method && setupIntent.payment_method.id);
  if (!pmId) return;
  await applyPaymentMethod(sub, pmId);
}

async function createPortalSession(user) {
  if (!isCheckoutLive()) {
    throw httpError(
      'Card checkout is not live.',
      'CHECKOUT_NOT_LIVE',
      400
    );
  }

  const userId = userIdOf(user);
  const sub = await ensureSubscription(userId);
  const customerId = await ensureStripeCustomer(user, sub);
  const stripe = getStripe();

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ['card'],
    usage: 'off_session',
    metadata: {
      userId: String(userId),
      purpose: 'update_card',
    },
  });

  return {
    paymentElement: true,
    clientSecret: setupIntent.client_secret,
    sessionId: setupIntent.id,
    setupIntentId: setupIntent.id,
  };
}

async function listCardPaymentMethodIds(customerId) {
  const stripe = getStripe();
  const ids = {};
  const add = (pm) => {
    const id = idOf(pm);
    if (id && String(id).indexOf('pm_') === 0) ids[id] = true;
  };

  try {
    const listed = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
      limit: 20,
    });
    (listed.data || []).forEach(add);
  } catch (err) {
    console.error('billing.listCardPms', err.message);
  }

  try {
    if (
      stripe.customers &&
      typeof stripe.customers.listPaymentMethods === 'function'
    ) {
      const listed = await stripe.customers.listPaymentMethods(customerId, {
        type: 'card',
        limit: 20,
      });
      (listed.data || []).forEach(add);
    }
  } catch (err) {
    console.error('billing.listCustomerCardPms', err.message);
  }

  return Object.keys(ids);
}

async function clearDefaultPaymentMethod(sub) {
  const stripe = getStripe();

  if (sub.stripeSubscriptionId) {
    try {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        default_payment_method: '',
      });
    } catch (err) {
      console.error('billing.clearSubPm', err.message);
    }
  }

  try {
    await stripe.customers.update(sub.stripeCustomerId, {
      invoice_settings: { default_payment_method: '' },
    });
  } catch (err) {
    console.error('billing.clearDefaultPm', err.message);
  }
}

async function removeSavedCards(user) {
  const sub = await ensureSubscription(userIdOf(user));
  if (!sub.stripeCustomerId || !getStripe()) {
    throw httpError('No card on file', 'NO_PAYMENT_METHOD', 400);
  }

  const stripe = getStripe();
  await clearDefaultPaymentMethod(sub);

  const pmIds = await listCardPaymentMethodIds(sub.stripeCustomerId);
  if (!pmIds.length) {
    throw httpError('No card on file', 'NO_PAYMENT_METHOD', 400);
  }

  let detached = 0;
  for (let i = 0; i < pmIds.length; i += 1) {
    try {
      await stripe.paymentMethods.detach(pmIds[i]);
      detached += 1;
    } catch (err) {
      console.error('billing.detach', err.message);
    }
  }

  if (!detached) {
    throw httpError('Could not remove this card', 'CARD_REMOVE_FAILED', 400);
  }

  return {
    paymentMethod: null,
    paymentMethods: [],
    message:
      'Card removed. Add a card before the next invoice or the charge can fail.',
  };
}

async function confirmCardUpdate(user, sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    throw httpError('Missing checkout session', 'BAD_SESSION', 400);
  }

  const sub = await ensureSubscription(userIdOf(user));
  const stripe = getStripe();

  if (sessionId.indexOf('seti_') === 0) {
    const setupIntent = await stripe.setupIntents.retrieve(sessionId);
    if (setupIntent.status !== 'succeeded') {
      throw httpError('Finish the card form first', 'SESSION_OPEN', 400);
    }
    const customerId = idOf(setupIntent.customer);
    if (
      customerId &&
      sub.stripeCustomerId &&
      customerId !== sub.stripeCustomerId
    ) {
      throw httpError(
        'This card session is not for this account',
        'SESSION_MISMATCH',
        403
      );
    }
    const pmId = idOf(setupIntent.payment_method);
    if (pmId) await applyPaymentMethod(sub, pmId);
    const paymentMethod = await getDefaultCard(sub);
    return {
      paymentMethod,
      message: 'Card updated. Future invoices use this card.',
    };
  }

  if (sessionId.indexOf('cs_') !== 0) {
    throw httpError('Missing checkout session', 'BAD_SESSION', 400);
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['setup_intent'],
  });

  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer && session.customer.id;
  if (
    customerId &&
    sub.stripeCustomerId &&
    customerId !== sub.stripeCustomerId
  ) {
    throw httpError(
      'This card session is not for this account',
      'SESSION_MISMATCH',
      403
    );
  }

  if (session.status !== 'complete') {
    throw httpError('Finish the card form first', 'SESSION_OPEN', 400);
  }

  await applySetupSessionToSub(sub, session);
  const paymentMethod = await getDefaultCard(sub);
  return {
    paymentMethod,
    message: 'Card updated. Future invoices use this card.',
  };
}

async function confirmSubscribeFromSetup(user, setupIntentId, planHint, intervalHint) {
  const stripe = getStripe();
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  if (setupIntent.status !== 'succeeded') {
    throw httpError('Finish the card form first', 'SESSION_OPEN', 400);
  }

  const meta = setupIntent.metadata || {};
  const planKey = String(planHint || meta.planKey || 'starter').toLowerCase();
  const interval = String(intervalHint || meta.interval || 'monthly').toLowerCase();
  if (!getPlan(planKey) || !getPlan(planKey).purchasable) {
    throw httpError('Unknown plan', 'PLAN_NOT_PURCHASABLE', 400);
  }
  if (!INTERVALS.includes(interval)) {
    throw httpError('interval must be monthly or yearly', 'BAD_INTERVAL', 400);
  }
  const priceId = priceIdFor(planKey, interval);
  if (!priceId) {
    throw httpError(
      `Set Stripe price IDs for ${planKey} (monthly and yearly).`,
      'CHECKOUT_NOT_LIVE',
      400
    );
  }

  const sub = await ensureSubscription(userIdOf(user));
  const customerId =
    idOf(setupIntent.customer) || (await ensureStripeCustomer(user, sub));
  if (
    customerId &&
    sub.stripeCustomerId &&
    customerId !== sub.stripeCustomerId
  ) {
    throw httpError(
      'This session is not for this account',
      'SESSION_MISMATCH',
      403
    );
  }

  const pmId = idOf(setupIntent.payment_method);
  if (!pmId) {
    throw httpError('No card on this payment', 'NO_PAYMENT_METHOD', 400);
  }

  try {
    await stripe.paymentMethods.attach(pmId, { customer: customerId });
  } catch (err) {
    const msg = (err && err.message) || '';
    if (err.code !== 'resource_already_exists' && msg.indexOf('already') === -1) {
      console.error('billing.attachPaymentMethod', msg);
    }
  }
  await applyPaymentMethod(sub, pmId);

  const listed = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 20,
  });
  const already = (listed.data || []).find(
    (row) =>
      row.metadata &&
      row.metadata.setupIntentId === setupIntentId &&
      (row.status === 'active' || row.status === 'trialing')
  );

  let stripeSub = already || null;
  if (!stripeSub) {
    const previousId =
      (meta.previousSubscriptionId && String(meta.previousSubscriptionId)) ||
      sub.stripeSubscriptionId ||
      '';
    const subParams = {
      customer: customerId,
      items: [{ price: priceId }],
      default_payment_method: pmId,
      metadata: {
        userId: String(userIdOf(user)),
        planKey,
        interval,
        previousSubscriptionId: previousId,
        setupIntentId,
      },
    };
    try {
      stripeSub = await stripe.subscriptions.create({
        ...subParams,
        payment_behavior: 'error_if_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
          payment_method_types: ['card'],
        },
      });
    } catch (err) {
      try {
        stripeSub = await stripe.subscriptions.create(subParams);
      } catch (err2) {
        throw httpError(
          err2.message || err.message || 'Card was declined',
          'PAYMENT_FAILED',
          400
        );
      }
    }
  }

  if (stripeSub.status !== 'active' && stripeSub.status !== 'trialing') {
    const invoiceId = idOf(stripeSub.latest_invoice);
    if (invoiceId) {
      try {
        await stripe.invoices.pay(invoiceId, { payment_method: pmId });
        stripeSub = await stripe.subscriptions.retrieve(stripeSub.id);
      } catch (err) {
        console.error('billing.invoices.pay', err.message);
      }
    }
  }

  if (stripeSub.status !== 'active' && stripeSub.status !== 'trialing') {
    try {
      await stripe.subscriptions.cancel(stripeSub.id);
    } catch (err) {
      console.error('billing.cancelIncomplete', err.message);
    }
    throw httpError('Payment is not complete yet', 'SESSION_OPEN', 400);
  }

  const previousId =
    (stripeSub.metadata && stripeSub.metadata.previousSubscriptionId) ||
    (meta.previousSubscriptionId && String(meta.previousSubscriptionId)) ||
    sub.stripeSubscriptionId ||
    '';

  await applyStripeSubscription(sub, stripeSub, interval, planKey);
  await cancelPreviousSubscription(previousId, stripeSub.id);

  let invoice = stripeSub.latest_invoice;
  if (typeof invoice === 'string') {
    try {
      invoice = await stripe.invoices.retrieve(invoice);
    } catch {
      invoice = null;
    }
  }
  if (invoice) await recordStripeInvoice(sub, invoice);

  const invoices = await Invoice.find({ user: sub.user })
    .sort({ createdAt: -1 })
    .limit(12)
    .lean();
  let paymentMethod = null;
  try {
    paymentMethod = await getDefaultCard(sub);
  } catch (err) {
    console.error('billing.getDefaultCard', err.message);
  }

  return {
    subscription: serializeSubscription(sub),
    invoices: invoices.map(serializeInvoice),
    paymentMethod,
    message: 'Payment confirmed. Your plan is active.',
  };
}

async function confirmCheckoutSession(user, sessionId, extras) {
  extras = extras || {};
  if (!sessionId || typeof sessionId !== 'string') {
    throw httpError('Missing checkout session', 'BAD_SESSION', 400);
  }

  if (sessionId.indexOf('seti_') === 0) {
    return confirmSubscribeFromSetup(
      user,
      sessionId,
      extras.plan,
      extras.interval
    );
  }

  const sub = await ensureSubscription(userIdOf(user));
  const stripe = getStripe();

  if (sessionId.indexOf('sub_') === 0) {
    const stripeSub = await stripe.subscriptions.retrieve(sessionId);
    const customerId = idOf(stripeSub.customer);
    if (
      customerId &&
      sub.stripeCustomerId &&
      customerId !== sub.stripeCustomerId
    ) {
      throw httpError(
        'This session is not for this account',
        'SESSION_MISMATCH',
        403
      );
    }
    if (stripeSub.status !== 'active' && stripeSub.status !== 'trialing') {
      throw httpError('Payment is not complete yet', 'SESSION_OPEN', 400);
    }
    const previousId =
      (stripeSub.metadata && stripeSub.metadata.previousSubscriptionId) ||
      (sub.stripeSubscriptionId && sub.stripeSubscriptionId !== stripeSub.id
        ? sub.stripeSubscriptionId
        : null);
    const interval =
      (stripeSub.metadata && stripeSub.metadata.interval) || 'monthly';
    const planKey =
      (stripeSub.metadata && stripeSub.metadata.planKey) || 'starter';
    await applyStripeSubscription(sub, stripeSub, interval, planKey);
    await cancelPreviousSubscription(previousId, stripeSub.id);
    const invoices = await Invoice.find({ user: sub.user })
      .sort({ createdAt: -1 })
      .limit(12)
      .lean();
    return {
      subscription: serializeSubscription(sub),
      invoices: invoices.map(serializeInvoice),
      message: 'Payment confirmed. Your plan is active.',
    };
  }

  if (sessionId.indexOf('cs_') !== 0) {
    throw httpError('Missing checkout session', 'BAD_SESSION', 400);
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);

  const customerId = idOf(session.customer);
  if (
    customerId &&
    sub.stripeCustomerId &&
    customerId !== sub.stripeCustomerId
  ) {
    throw httpError(
      'This session is not for this account',
      'SESSION_MISMATCH',
      403
    );
  }

  if (session.mode === 'setup') {
    return confirmCardUpdate(user, sessionId);
  }

  if (session.status !== 'complete' && session.payment_status !== 'paid') {
    throw httpError('Payment is not complete yet', 'SESSION_OPEN', 400);
  }

  await applyCompletedCheckoutSession(session, sub);
  const invoices = await Invoice.find({ user: sub.user })
    .sort({ createdAt: -1 })
    .limit(12)
    .lean();

  return {
    subscription: serializeSubscription(sub),
    invoices: invoices.map(serializeInvoice),
    message: 'Payment confirmed. Your plan is active.',
  };
}

async function cancelSubscription(userOrId) {
  const userId = userIdOf(userOrId);
  const sub = await ensureSubscription(userId);

  if (sub.status === 'unpaid' || sub.status === 'canceled') {
    throw httpError(
      'Nothing to cancel. This account is not on a paid period.',
      'NOTHING_TO_CANCEL',
      400
    );
  }

  if (sub.stripeSubscriptionId && isCheckoutLive()) {
    const stripe = getStripe();
    const stripeSub = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    await applyStripeSubscription(sub, stripeSub, sub.interval);
  } else {
    sub.cancelAtPeriodEnd = true;
    sub.status = 'canceling';
    sub.canceledAt = new Date();
    await sub.save();
    await syncUser(userId, sub);
  }

  return {
    subscription: serializeSubscription(sub),
    message:
      'This plan will not renew. You keep access until the end of the month or year already paid. We do not refund unused days.',
  };
}

async function handleStripeEvent(event) {
  const stripe = getStripe();
  const type = event.type;
  const obj = event.data && event.data.object;

  if (type === 'checkout.session.completed') {
    await applyCompletedCheckoutSession(obj, null);
    return;
  }

  if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
    const sub = await findSubByStripe(
      obj.id,
      obj.customer,
      obj.metadata && obj.metadata.userId
    );
    if (!sub) return;
    await applyStripeSubscription(sub, obj, sub.interval);
    if (
      type === 'customer.subscription.updated' &&
      (obj.status === 'active' || obj.status === 'trialing')
    ) {
      const previousId = obj.metadata && obj.metadata.previousSubscriptionId;
      await cancelPreviousSubscription(previousId, obj.id);
    }
    return;
  }

  if (type === 'invoice.paid' || type === 'invoice.payment_failed') {
    const stripeSubId = invoiceSubscriptionId(obj);
    const customerId = idOf(obj.customer);
    const userId = obj.metadata && obj.metadata.userId;
    const sub = await findSubByStripe(stripeSubId, customerId, userId);
    if (!sub) return;

    if (type === 'invoice.payment_failed') {
      sub.status = 'past_due';
      await sub.save();
      await syncUser(sub.user, sub);
    }

    await recordStripeInvoice(sub, obj);
  }
}

async function listInvoices(userOrId, query) {
  const userId = userIdOf(userOrId);
  const page = Math.max(parseInt(query && query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query && query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    Invoice.find({ user: userId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Invoice.countDocuments({ user: userId }),
  ]);

  return { invoices: rows.map(serializeInvoice), page, limit, total };
}

async function getInvoiceByUser(userOrId, id) {
  const row = await Invoice.findOne({ _id: id, user: userIdOf(userOrId) });
  if (!row) throw httpError('Invoice not found', 'INVOICE_NOT_FOUND', 404);
  return serializeInvoice(row);
}

async function assertDoctorLimit(userOrId) {
  const userId = userIdOf(userOrId);
  const sub = await ensureSubscription(userId);
  const plan = planForSub(sub);
  const limit = plan.limits.doctors;
  if (limit == null) return { ok: true, used: null, limit: null, planKey: plan.key };

  const used = await countDoctors(userId);
  if (used >= limit) {
    throw httpError(
      `${plan.name} includes ${limit} doctor${limit === 1 ? '' : 's'}. Starter is 2, Growth is 6, Pro is unlimited — upgrade on Billing.`,
      'PLAN_LIMIT_DOCTORS',
      403,
      { used, limit, planKey: plan.key }
    );
  }
  return { ok: true, used, limit, planKey: plan.key };
}

async function assertAppointmentLimit(userOrId) {
  const userId = userIdOf(userOrId);
  const sub = await ensureSubscription(userId);
  const plan = planForSub(sub);
  const limit = plan.limits.appointmentsPerMonth;
  if (limit == null) return { ok: true, used: null, limit: null, planKey: plan.key };

  const used = await countAppointmentsThisMonth(userId);
  if (used >= limit) {
    throw httpError(
      `${plan.name} includes ${limit} appointments this month. Starter is 300, Growth is 1,500, Pro is unlimited — upgrade on Billing.`,
      'PLAN_LIMIT_APPOINTMENTS',
      403,
      { used, limit, planKey: plan.key }
    );
  }
  return { ok: true, used, limit, planKey: plan.key };
}

async function getBilling(req, res) {
  try {
    const data = await getOverview(actor(req));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return fail(res, err);
  }
}

function getPlans(req, res) {
  return res.status(200).json({
    success: true,
    data: {
      plans: catalog(),
      checkoutLive: isCheckoutLive(),
      note: 'Starter, Growth and Pro are paid on Stripe. WhatsApp reminders on Growth and Pro go live in a few days.',
    },
  });
}

async function postWaitlist(req, res) {
  try {
    const plan = String((req.body && req.body.plan) || '').toLowerCase();
    const data = await joinWaitlist(actor(req), plan);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return fail(res, err);
  }
}

async function deleteWaitlist(req, res) {
  try {
    const plan = String(
      (req.body && req.body.plan) || (req.query && req.query.plan) || ''
    ).toLowerCase();
    const data = await leaveWaitlist(actor(req), plan);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return fail(res, err);
  }
}

async function postCancel(req, res) {
  try {
    const data = await cancelSubscription(actor(req));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return fail(res, err);
  }
}

async function postSubscribe(req, res) {
  try {
    const plan = String((req.body && req.body.plan) || 'starter').toLowerCase();
    if (!getPlan(plan) || !getPlan(plan).purchasable) {
      throw httpError('Unknown plan', 'PLAN_NOT_PURCHASABLE', 400);
    }
    const interval = String((req.body && req.body.interval) || 'monthly').toLowerCase();
    const data = await createCheckoutSession(actor(req), interval, plan);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return fail(res, err);
  }
}

async function postPortal(req, res) {
  try {
    const data = await createPortalSession(actor(req));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return fail(res, err);
  }
}

async function postCard(req, res) {
  try {
    const sessionId = String(
      (req.body && (req.body.setupIntentId || req.body.sessionId)) || ''
    );
    const data = await confirmCardUpdate(actor(req), sessionId);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return fail(res, err);
  }
}

async function deleteCard(req, res) {
  try {
    const data = await removeSavedCards(actor(req));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return fail(res, err);
  }
}

const postCardRemove = deleteCard;

async function postConfirm(req, res) {
  try {
    const body = req.body || {};
    const sessionId = String(
      body.setupIntentId || body.subscriptionId || body.sessionId || ''
    );
    const data = await confirmCheckoutSession(actor(req), sessionId, {
      plan: body.plan,
      interval: body.interval,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return fail(res, err);
  }
}

async function getInvoices(req, res) {
  try {
    const data = await listInvoices(actor(req), req.query);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return fail(res, err);
  }
}

async function getInvoiceById(req, res) {
  try {
    const data = await getInvoiceByUser(actor(req), req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return fail(res, err);
  }
}

async function stripeWebhook(req, res) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({
      success: false,
      code: 'WEBHOOK_SECRET_MISSING',
      message: 'STRIPE_WEBHOOK_SECRET is not set',
    });
  }

  let event;
  try {
    const stripe = getStripe();
    const signature = req.headers['stripe-signature'];
    const raw = req.body;
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    console.error('billing webhook signature', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await handleStripeEvent(event);
  } catch (err) {
    console.error('billing webhook handler', err);
    return res.status(500).json({ success: false, message: 'Webhook handler failed' });
  }

  return res.status(200).json({ received: true });
}

module.exports = {
  getBilling,
  getPlans,
  postWaitlist,
  deleteWaitlist,
  postCancel,
  postSubscribe,
  postPortal,
  postCard,
  deleteCard,
  postCardRemove,
  postConfirm,
  getInvoices,
  getInvoiceById,
  stripeWebhook,
  ensureSubscription,
  assertDoctorLimit,
  assertAppointmentLimit,
};
