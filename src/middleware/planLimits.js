/**
 * DROP-IN: middleware/planLimits.js
 *
 * Doctor create:
 *   const { assertCanAddDoctor } = require('../middleware/planLimits');
 *   router.post('/', protect, assertCanAddDoctor, createDoctor);
 *
 * Appointment create:
 *   const { assertCanAddAppointment } = require('../middleware/planLimits');
 *   router.post('/', protect, assertCanAddAppointment, createAppointment);
 */

const {
  assertDoctorLimit,
  assertAppointmentLimit,
} = require('../controllers/billing.controller');

function actorId(req) {
  const user = req.user || {};
  return user._id || user.id;
}

function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('planLimits', err);
  return res.status(status).json({
    success: false,
    code: err.code || 'PLAN_LIMIT',
    message: err.message || 'Plan limit',
    ...(err.meta ? { meta: err.meta } : {}),
  });
}

async function assertCanAddDoctor(req, res, next) {
  try {
    await assertDoctorLimit(actorId(req));
    return next();
  } catch (err) {
    return fail(res, err);
  }
}

async function assertCanAddAppointment(req, res, next) {
  try {
    await assertAppointmentLimit(actorId(req));
    return next();
  } catch (err) {
    return fail(res, err);
  }
}

module.exports = {
  assertCanAddDoctor,
  assertCanAddAppointment,
};
