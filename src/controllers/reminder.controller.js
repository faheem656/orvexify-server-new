/**
 * DROP-IN: src/controllers/reminder.controller.js
 *
 * GET /reminder-settings
 * PUT /reminder-settings
 *
 * Source of truth for 24h / 2h patient email reminder toggles.
 * 30-minute reminder still goes out (not a switch on this model).
 * Email only. No SMS.
 */

const ReminderSettings = require('../models/ReminderSettings');

const DEFAULTS = {
  enable24hReminder: true,
  enable2hReminder: true,
  enableCancellationEmail: true,
  sendRemindersOnWeekends: true,
  defaultReminderHours: {
    firstReminder: 24,
    secondReminder: 2,
  },
};

function httpError(message, code, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('reminder-settings', err);
  return res.status(status).json({
    success: false,
    code: err.code || 'REMINDER_SETTINGS_ERROR',
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
  return {
    enable24hReminder:
      typeof row.enable24hReminder === 'boolean'
        ? row.enable24hReminder
        : DEFAULTS.enable24hReminder,
    enable2hReminder:
      typeof row.enable2hReminder === 'boolean'
        ? row.enable2hReminder
        : DEFAULTS.enable2hReminder,
    enableCancellationEmail:
      typeof row.enableCancellationEmail === 'boolean'
        ? row.enableCancellationEmail
        : DEFAULTS.enableCancellationEmail,
    sendRemindersOnWeekends:
      typeof row.sendRemindersOnWeekends === 'boolean'
        ? row.sendRemindersOnWeekends
        : DEFAULTS.sendRemindersOnWeekends,
    defaultReminderHours: {
      firstReminder:
        Number(
          (row.defaultReminderHours && row.defaultReminderHours.firstReminder) ||
            DEFAULTS.defaultReminderHours.firstReminder
        ),
      secondReminder:
        Number(
          (row.defaultReminderHours && row.defaultReminderHours.secondReminder) ||
            DEFAULTS.defaultReminderHours.secondReminder
        ),
    },
  };
}

async function ensureSettings(userId) {
  let settings = await ReminderSettings.findOne({ userId });
  if (settings) return settings;
  try {
    settings = await ReminderSettings.create({
      userId,
      ...DEFAULTS,
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return ReminderSettings.findOne({ userId });
    }
    throw err;
  }
  return settings;
}

async function getReminderSettings(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);
    const settings = await ensureSettings(userId);
    return res.json({
      success: true,
      settings: serialize(settings),
    });
  } catch (error) {
    console.error('Get reminder settings error:', error);
    return fail(res, error);
  }
}

async function updateReminderSettings(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);

    const {
      enable24hReminder,
      enable2hReminder,
      enableCancellationEmail,
      sendRemindersOnWeekends,
      defaultReminderHours,
    } = req.body || {};

    let settings = await ReminderSettings.findOne({ userId });
    if (!settings) {
      settings = await ensureSettings(userId);
    }

    if (typeof enable24hReminder === 'boolean') {
      settings.enable24hReminder = enable24hReminder;
    }
    if (typeof enable2hReminder === 'boolean') {
      settings.enable2hReminder = enable2hReminder;
    }
    if (typeof enableCancellationEmail === 'boolean') {
      settings.enableCancellationEmail = enableCancellationEmail;
    }
    if (typeof sendRemindersOnWeekends === 'boolean') {
      settings.sendRemindersOnWeekends = sendRemindersOnWeekends;
    }

    if (defaultReminderHours) {
      const first = Number(defaultReminderHours.firstReminder);
      const second = Number(defaultReminderHours.secondReminder);
      if (Number.isFinite(first) && first >= 1 && first <= 168) {
        settings.defaultReminderHours.firstReminder = first;
      }
      if (Number.isFinite(second) && second >= 1 && second <= 48) {
        settings.defaultReminderHours.secondReminder = second;
      }
    }

    await settings.save();

    return res.json({
      success: true,
      message: 'Reminder settings updated successfully',
      settings: serialize(settings),
    });
  } catch (error) {
    console.error('Update reminder settings error:', error);
    return fail(res, error);
  }
}

module.exports = {
  getReminderSettings,
  updateReminderSettings,
  serializeReminderSettings: serialize,
  ensureReminderSettings: ensureSettings,
};
