/**
 * DROP-IN: src/controllers/doctor.controller.js
 * Owner field: userId. Starter 2, Growth 6, Pro unlimited.
 * Create counts Doctor docs itself — does not trust billing countDoctors.
 */

const Doctor = require('../models/Doctor');

const DOCTOR_CAPS = {
  starter: 2,
  growth: 6,
  pro: null,
};

function httpError(message, code, status, meta) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (meta) err.meta = meta;
  return err;
}

function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('doctor', err);
  return res.status(status).json({
    success: false,
    code: err.code || 'DOCTOR_ERROR',
    message: err.message || 'Server error',
    ...(err.meta ? { meta: err.meta } : {}),
  });
}

function userIdOf(req) {
  return req.user && (req.user._id || req.user.id);
}

function sanitizeBody(body) {
  const data = { ...(body || {}) };
  delete data._id;
  delete data.id;
  delete data.userId;
  delete data.user;
  delete data.createdAt;
  return data;
}

function planNameOf(planKey) {
  if (planKey === 'growth') return 'Growth';
  if (planKey === 'pro') return 'Pro';
  return 'Starter';
}

async function doctorPlanCap(userId) {
  let planKey = 'starter';
  try {
    const billing = require('./billing.controller');
    if (typeof billing.ensureSubscription === 'function') {
      const sub = await billing.ensureSubscription(userId);
      planKey = String((sub && sub.planKey) || 'starter').toLowerCase();
    }
  } catch (err) {
    console.warn('doctorPlanCap', err.message);
    planKey = 'starter';
  }
  if (!Object.prototype.hasOwnProperty.call(DOCTOR_CAPS, planKey)) {
    planKey = 'starter';
  }
  return {
    planKey,
    planName: planNameOf(planKey),
    limit: DOCTOR_CAPS[planKey],
  };
}

async function countOwnedDoctors(userId) {
  return Doctor.countDocuments({
    $or: [{ userId }, { user: userId }],
  });
}

async function enforceDoctorCap(userId) {
  const used = await countOwnedDoctors(userId);
  const { limit, planName, planKey } = await doctorPlanCap(userId);
  if (limit != null && used >= limit) {
    throw httpError(
      `${planName} includes up to ${limit} doctors. Growth is 6, Pro is unlimited — upgrade on Billing.`,
      'PLAN_LIMIT_DOCTORS',
      403,
      { used, limit, planKey }
    );
  }
  return { used, limit, planKey };
}

async function getDoctors(req, res) {
  try {
    const doctors = await Doctor.find({ userId: userIdOf(req) }).sort({
      createdAt: -1,
    });
    return res.json({ success: true, doctors });
  } catch (err) {
    return fail(res, err);
  }
}

async function getDoctorById(req, res) {
  try {
    const doctor = await Doctor.findOne({
      _id: req.params.id,
      userId: userIdOf(req),
    });
    if (!doctor) throw httpError('Doctor not found', 'NOT_FOUND', 404);
    return res.json({ success: true, doctor });
  } catch (err) {
    return fail(res, err);
  }
}

async function createDoctor(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);

    await enforceDoctorCap(userId);

    const body = sanitizeBody(req.body);
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const specialty = String(body.specialty || '').trim();

    if (!name) throw httpError('Name is required', 'BAD_INPUT', 400);
    if (!email) throw httpError('Email is required', 'BAD_INPUT', 400);
    if (!specialty) throw httpError('Specialty is required', 'BAD_INPUT', 400);

    const doctor = await Doctor.create({
      ...body,
      name,
      email,
      specialty,
      userId,
    });

    return res.status(201).json({ success: true, doctor });
  } catch (err) {
    if (err.code === 11000) {
      return fail(
        res,
        httpError('A doctor with this email already exists', 'DUPLICATE', 400)
      );
    }
    return fail(res, err);
  }
}

async function updateDoctor(req, res) {
  try {
    const body = sanitizeBody(req.body);
    if (body.name) body.name = String(body.name).trim();
    if (body.email) body.email = String(body.email).trim().toLowerCase();
    if (body.specialty) body.specialty = String(body.specialty).trim();
    body.updatedAt = Date.now();

    const doctor = await Doctor.findOneAndUpdate(
      { _id: req.params.id, userId: userIdOf(req) },
      body,
      { new: true, runValidators: true }
    );
    if (!doctor) throw httpError('Doctor not found', 'NOT_FOUND', 404);
    return res.json({ success: true, doctor });
  } catch (err) {
    return fail(res, err);
  }
}

async function deleteDoctor(req, res) {
  try {
    const doctor = await Doctor.findOneAndDelete({
      _id: req.params.id,
      userId: userIdOf(req),
    });
    if (!doctor) throw httpError('Doctor not found', 'NOT_FOUND', 404);
    return res.json({ success: true, message: 'Doctor deleted successfully' });
  } catch (err) {
    return fail(res, err);
  }
}

module.exports = {
  getDoctors,
  getDoctorById,
  createDoctor,
  updateDoctor,
  deleteDoctor,
};
