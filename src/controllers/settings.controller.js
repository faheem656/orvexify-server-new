/** DROP-IN: src/controllers/settings.controller.js
 *
 * Paths (router mounted at /api):
 *   GET    /settings
 *   PUT    /settings
 *   PUT    /settings/general
 *   PUT    /settings/booking-slug
 *   POST   /settings/logo
 *   DELETE /settings/logo
 */

const moment = require('moment-timezone');
const User = require('../models/User');
const ClinicSettings = require('../models/ClinicSettings');
const defaultTemplates = require('../utils/defaultTemplates');
const {
  clinicLogoPublicId,
  uploadImageBuffer,
  destroyImage,
} = require('../utils/cloudinary');

const DATE_FORMATS = ['YYYY-MM-DD', 'DD-MM-YYYY', 'MM-DD-YYYY'];
const TIME_FORMATS = ['12h', '24h'];
const TEMPLATE_TYPES = ['reminder', 'confirmation', 'cancellation'];
const ALLOWED_LOGO_TYPES = {
  'image/jpeg': true,
  'image/jpg': true,
  'image/png': true,
  'image/webp': true,
  'image/gif': true,
};
const RESERVED_SLUGS = [
  'book',
  'login',
  'register',
  'auth',
  'admin',
  'api',
  'dashboard',
  'settings',
  'billing',
  'pricing',
  'blog',
  'contact',
  'faq',
  'features',
  'about',
  'demo',
  'privacy',
  'terms',
  'mission',
  'orvexify',
  'www',
  'app',
  'support',
];

function httpError(message, code, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('settings', err);
  return res.status(status).json({
    success: false,
    code: err.code || 'SETTINGS_ERROR',
    message: err.message || 'Server error',
  });
}

function userIdOf(req) {
  return req.user && (req.user._id || req.user.id);
}

function trimStr(value, max) {
  const text = String(value == null ? '' : value).trim();
  if (max && text.length > max) return text.slice(0, max);
  return text;
}

function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  return Boolean(moment.tz.zone(tz));
}

function normalizeSlug(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function logoValue(raw) {
  if (raw == null) return undefined;
  if (raw === '' || raw === false) return '';
  const value = String(raw).trim();
  if (!value) return '';
  if (value.indexOf('data:image/') === 0) {
    throw httpError(
      'Upload the logo as a file. It is stored on Cloudinary.',
      'BAD_LOGO',
      400
    );
  }
  if (value.indexOf('https://') === 0 || value.indexOf('http://') === 0) {
    if (value.length > 2000) {
      throw httpError('Logo URL is too long', 'BAD_LOGO', 400);
    }
    return value;
  }
  throw httpError('Logo must be a Cloudinary image URL', 'BAD_LOGO', 400);
}

function withTemplateDefaults(templates) {
  const src = templates || {};
  const out = {};
  TEMPLATE_TYPES.forEach((type) => {
    const row = src[type] || {};
    out[type] = {
      subject: row.subject || defaultTemplates[type].subject,
      body: row.body || defaultTemplates[type].body,
    };
  });
  return out;
}

function serializeUser(user) {
  const row = typeof user.toObject === 'function' ? user.toObject() : user || {};
  return {
    clinicName: row.clinicName || '',
    clinicEmail: row.email || row.clinicEmail || '',
    clinicPhone: row.clinicPhone || '',
    clinicAddress: row.clinicAddress || '',
    timezone: row.timezone || 'Asia/Karachi',
    dateFormat: DATE_FORMATS.includes(row.dateFormat) ? row.dateFormat : 'YYYY-MM-DD',
    timeFormat: TIME_FORMATS.includes(row.timeFormat) ? row.timeFormat : '12h',
    bookingSlug: row.bookingSlug || '',
    clinicLogo: row.clinicLogo || '',
  };
}

async function ensureClinicSettings(userId) {
  let settings = await ClinicSettings.findOne({ userId });
  if (settings) {
    const templates = withTemplateDefaults(settings.emailTemplates);
    let dirty = false;
    TEMPLATE_TYPES.forEach((type) => {
      if (!settings.emailTemplates[type] || !settings.emailTemplates[type].body) {
        settings.emailTemplates[type] = templates[type];
        dirty = true;
      }
    });
    if (dirty) await settings.save();
    return settings;
  }

  settings = await ClinicSettings.create({
    userId,
    reminderSettings: {
      enable24hReminder: true,
      enable2hReminder: true,
      enableCancellationEmail: true,
      sendRemindersOnWeekends: true,
      defaultReminderHours: { firstReminder: 24, secondReminder: 2 },
    },
    notificationSettings: {
      emailNotifications: true,
      appointmentConfirmedNotify: true,
      appointmentCancelledNotify: true,
      noShowNotify: true,
      dailyDigest: false,
      weeklyReport: true,
    },
    emailTemplates: withTemplateDefaults(null),
  });
  return settings;
}

async function getSettings(req, res) {
  try {
    const userId = userIdOf(req);
    const user = await User.findById(userId).select(
      '-passwordHash -tokenVersion -__v -smtpHost -fromEmail -emailPassword -useTLS -useSSL'
    );
    if (!user) throw httpError('Account not found', 'NOT_FOUND', 404);

    const clinicSettings = await ensureClinicSettings(userId);
    const general = serializeUser(user);

    return res.json({
      success: true,
      data: {
        ...general,
        reminderSettings: clinicSettings.reminderSettings,
        notificationSettings: clinicSettings.notificationSettings,
        emailTemplates: withTemplateDefaults(clinicSettings.emailTemplates),
      },
    });
  } catch (error) {
    console.error('Get settings error:', error);
    return fail(res, error);
  }
}

async function updateGeneralSettings(req, res) {
  try {
    const userId = userIdOf(req);
    const body = req.body || {};
    const user = await User.findById(userId);
    if (!user) throw httpError('Account not found', 'NOT_FOUND', 404);

    const clinicName = trimStr(body.clinicName, 120);
    if (clinicName) user.clinicName = clinicName;
    if (!user.clinicName) throw httpError('Clinic name is required', 'BAD_INPUT', 400);

    if (body.clinicPhone !== undefined) user.clinicPhone = trimStr(body.clinicPhone, 40);
    if (body.clinicAddress !== undefined) {
      user.clinicAddress = trimStr(body.clinicAddress, 200);
    }
    if (body.timezone) {
      if (!isValidTimezone(body.timezone)) {
        throw httpError('Pick a valid timezone', 'BAD_TIMEZONE', 400);
      }
      user.timezone = body.timezone;
    }
    if (body.dateFormat) {
      if (!DATE_FORMATS.includes(body.dateFormat)) {
        throw httpError('Invalid date format', 'BAD_INPUT', 400);
      }
      user.dateFormat = body.dateFormat;
    }
    if (body.timeFormat) {
      if (!TIME_FORMATS.includes(body.timeFormat)) {
        throw httpError('Invalid time format', 'BAD_INPUT', 400);
      }
      user.timeFormat = body.timeFormat;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'clinicLogo')) {
      user.clinicLogo = logoValue(body.clinicLogo);
    }

    await user.save();

    return res.json({
      success: true,
      message: 'Clinic settings saved',
      data: serializeUser(user),
    });
  } catch (error) {
    console.error('Update general settings error:', error);
    return fail(res, error);
  }
}

async function updateBookingSlug(req, res) {
  try {
    const userId = userIdOf(req);
    const slug = normalizeSlug((req.body && req.body.slug) || '');

    if (!slug || slug.length < 3) {
      throw httpError('Slug must be at least 3 characters', 'BAD_SLUG', 400);
    }
    if (slug.length > 50) {
      throw httpError('Slug must be less than 50 characters', 'BAD_SLUG', 400);
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw httpError(
        'Use lowercase letters, numbers and hyphens only',
        'BAD_SLUG',
        400
      );
    }
    if (RESERVED_SLUGS.includes(slug)) {
      throw httpError('That booking URL is reserved. Pick another.', 'SLUG_RESERVED', 400);
    }

    const existingUser = await User.findOne({
      bookingSlug: slug,
      _id: { $ne: userId },
    }).select('_id');
    if (existingUser) {
      throw httpError(
        'This booking URL is already taken. Please choose another one.',
        'SLUG_TAKEN',
        400
      );
    }

    const user = await User.findById(userId);
    if (!user) throw httpError('Account not found', 'NOT_FOUND', 404);
    user.bookingSlug = slug;
    await user.save();

    return res.json({
      success: true,
      message: 'Booking URL updated',
      data: { bookingSlug: slug },
    });
  } catch (error) {
    console.error('Update booking slug error:', error);
    return fail(res, error);
  }
}

async function uploadClinicLogo(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);

    const file = req.file;
    if (!file || !file.buffer) {
      throw httpError('Choose a PNG, JPG, or WEBP file', 'BAD_LOGO', 400);
    }
    if (!ALLOWED_LOGO_TYPES[file.mimetype]) {
      throw httpError('Use a PNG, JPG, WEBP, or GIF', 'BAD_LOGO', 400);
    }

    const user = await User.findById(userId);
    if (!user) throw httpError('Account not found', 'NOT_FOUND', 404);

    const publicId = clinicLogoPublicId(userId);
    const result = await uploadImageBuffer(file.buffer, publicId);
    const url = result.secure_url || result.url;
    if (!url) throw httpError('Cloudinary did not return a URL', 'UPLOAD_FAILED', 500);

    user.clinicLogo = url;
    if (user.schema.path('clinicLogoPublicId')) {
      user.clinicLogoPublicId = result.public_id || publicId;
    }
    await user.save();

    return res.json({
      success: true,
      message: 'Clinic logo saved',
      data: {
        clinicLogo: url,
        publicId: result.public_id || publicId,
      },
    });
  } catch (error) {
    console.error('Upload clinic logo error:', error);
    return fail(res, error);
  }
}

async function removeClinicLogo(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);

    const user = await User.findById(userId);
    if (!user) throw httpError('Account not found', 'NOT_FOUND', 404);

    await destroyImage(clinicLogoPublicId(userId));
    user.clinicLogo = '';
    if (user.schema.path('clinicLogoPublicId')) {
      user.clinicLogoPublicId = '';
    }
    await user.save();

    return res.json({
      success: true,
      message: 'Clinic logo removed',
      data: { clinicLogo: '' },
    });
  } catch (error) {
    console.error('Remove clinic logo error:', error);
    return fail(res, error);
  }
}

async function updateReminderSettings(req, res) {
  try {
    const userId = userIdOf(req);
    const body = req.body || {};
    const settings = await ensureClinicSettings(userId);

    if (typeof body.enable24hReminder === 'boolean') {
      settings.reminderSettings.enable24hReminder = body.enable24hReminder;
    }
    if (typeof body.enable2hReminder === 'boolean') {
      settings.reminderSettings.enable2hReminder = body.enable2hReminder;
    }
    if (typeof body.enableCancellationEmail === 'boolean') {
      settings.reminderSettings.enableCancellationEmail = body.enableCancellationEmail;
    }
    if (typeof body.sendRemindersOnWeekends === 'boolean') {
      settings.reminderSettings.sendRemindersOnWeekends = body.sendRemindersOnWeekends;
    }
    if (body.defaultReminderHours) {
      const first = Number(body.defaultReminderHours.firstReminder);
      const second = Number(body.defaultReminderHours.secondReminder);
      if (Number.isFinite(first) && first >= 1 && first <= 168) {
        settings.reminderSettings.defaultReminderHours.firstReminder = first;
      }
      if (Number.isFinite(second) && second >= 1 && second <= 48) {
        settings.reminderSettings.defaultReminderHours.secondReminder = second;
      }
    }

    await settings.save();

    return res.json({
      success: true,
      message: 'Reminder settings saved',
      data: settings.reminderSettings,
    });
  } catch (error) {
    console.error('Update reminder settings error:', error);
    return fail(res, error);
  }
}

async function updateNotificationSettings(req, res) {
  try {
    const userId = userIdOf(req);
    const body = req.body || {};
    const settings = await ensureClinicSettings(userId);
    const keys = [
      'emailNotifications',
      'appointmentConfirmedNotify',
      'appointmentCancelledNotify',
      'noShowNotify',
      'dailyDigest',
      'weeklyReport',
    ];
    keys.forEach((key) => {
      if (typeof body[key] === 'boolean') {
        settings.notificationSettings[key] = body[key];
      }
    });
    await settings.save();

    return res.json({
      success: true,
      message: 'Notification settings saved',
      data: settings.notificationSettings,
    });
  } catch (error) {
    console.error('Update notification settings error:', error);
    return fail(res, error);
  }
}

async function updateEmailTemplate(req, res) {
  try {
    const { type } = req.params;
    if (!TEMPLATE_TYPES.includes(type)) {
      throw httpError('Invalid template type', 'BAD_TEMPLATE', 400);
    }
    const subject = trimStr(req.body && req.body.subject, 200);
    const body = String((req.body && req.body.body) || '');
    if (!subject) throw httpError('Subject is required', 'BAD_INPUT', 400);

    const settings = await ensureClinicSettings(userIdOf(req));
    settings.emailTemplates[type] = { subject, body };
    await settings.save();

    return res.json({
      success: true,
      message: `${type} template saved`,
      data: settings.emailTemplates[type],
    });
  } catch (error) {
    console.error('Update template error:', error);
    return fail(res, error);
  }
}

async function resetEmailTemplate(req, res) {
  try {
    const { type } = req.params;
    if (!TEMPLATE_TYPES.includes(type)) {
      throw httpError('Invalid template type', 'BAD_TEMPLATE', 400);
    }
    const settings = await ensureClinicSettings(userIdOf(req));
    settings.emailTemplates[type] = {
      subject: defaultTemplates[type].subject,
      body: defaultTemplates[type].body,
    };
    await settings.save();

    return res.json({
      success: true,
      message: `${type} template reset to default`,
      data: settings.emailTemplates[type],
    });
  } catch (error) {
    console.error('Reset template error:', error);
    return fail(res, error);
  }
}

module.exports = {
  getSettings,
  updateGeneralSettings,
  updateBookingSlug,
  uploadClinicLogo,
  removeClinicLogo,
  updateReminderSettings,
  updateNotificationSettings,
  updateEmailTemplate,
  resetEmailTemplate,
};
