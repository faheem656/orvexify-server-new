/**
 * DROP-IN: src/controllers/notification.controller.js
 *
 * GET /notification-settings
 * PUT /notification-settings
 *
 * Clinic-facing email alerts (confirm / cancel / no-show / digest).
 * Email only. No SMS.
 */

const NotificationSettings = require('../models/NotificationSettings');

const DEFAULTS = {
  emailNotifications: true,
  appointmentConfirmedNotify: true,
  appointmentCancelledNotify: true,
  noShowNotify: true,
  dailyDigest: false,
  weeklyReport: true,
};

const BOOL_KEYS = [
  'emailNotifications',
  'appointmentConfirmedNotify',
  'appointmentCancelledNotify',
  'noShowNotify',
  'dailyDigest',
  'weeklyReport',
];

function httpError(message, code, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('notification-settings', err);
  return res.status(status).json({
    success: false,
    code: err.code || 'NOTIFICATION_SETTINGS_ERROR',
    message: err.message || 'Server error',
  });
}

function userIdOf(req) {
  return req.user && (req.user._id || req.user.id);
}

function serialize(settings) {
  const row =
    settings && typeof settings.toObject === 'function'
      ? settings.toObject()
      : settings || {};
  const out = {};
  BOOL_KEYS.forEach((key) => {
    out[key] = typeof row[key] === 'boolean' ? row[key] : DEFAULTS[key];
  });
  return out;
}

async function ensureSettings(userId) {
  let settings = await NotificationSettings.findOne({ userId });
  if (settings) return settings;
  try {
    settings = await NotificationSettings.create({
      userId,
      ...DEFAULTS,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return NotificationSettings.findOne({ userId });
    }
    throw err;
  }
  return settings;
}

async function getNotificationSettings(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);
    const settings = await ensureSettings(userId);
    return res.json({
      success: true,
      settings: serialize(settings),
    });
  } catch (error) {
    console.error('Get notification settings error:', error);
    return fail(res, error);
  }
}

async function updateNotificationSettings(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);

    const body = req.body || {};
    let settings = await NotificationSettings.findOne({ userId });
    if (!settings) settings = await ensureSettings(userId);

    BOOL_KEYS.forEach((key) => {
      if (typeof body[key] === 'boolean') settings[key] = body[key];
    });

    await settings.save();

    return res.json({
      success: true,
      message: 'Notification settings updated successfully',
      settings: serialize(settings),
    });
  } catch (error) {
    console.error('Update notification settings error:', error);
    return fail(res, error);
  }
}

module.exports = {
  getNotificationSettings,
  updateNotificationSettings,
};
