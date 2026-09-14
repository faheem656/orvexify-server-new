/** DROP-IN: src/controllers/tracking.controller.js
 *
 * Public (email links / pixel). Mounted at /api/tracking
 *
 * GET /pixel/:token
 * GET /click?tracking=&action=&redirect=
 * GET /test/:token
 * GET /test-open/:token
 *
 * Once a reminder is confirm or cancel, that log + the appointment
 * stay locked. Opens still count; status does not flip.
 */

const Appointment = require('../models/Appointment');
const ReminderLog = require('../models/ReminderLog');

const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function frontendBase() {
  return (
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    'https://orvexify.com'
  ).replace(/\/$/, '');
}

function sendPixel(res) {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Length', PIXEL.length);
  return res.send(PIXEL);
}

function safeRedirect(target, fallback) {
  const base = frontendBase();
  const fallbackUrl = fallback || `${base}/`;
  if (!target) return fallbackUrl;
  const url = String(target);
  if (url.startsWith(base + '/') || url === base) return url;
  return fallbackUrl;
}

function logAction(log) {
  const current = log.status && log.status.current;
  if (log.clickedAction === 'confirm' || current === 'confirmed') return 'confirm';
  if (log.clickedAction === 'cancel' || current === 'cancelled') return 'cancel';
  return null;
}

function isLogLocked(log) {
  return logAction(log) === 'confirm' || logAction(log) === 'cancel';
}

function aptStatus(appointment) {
  return String(
    (appointment && (appointment.confirmationStatus || appointment.status)) || ''
  ).toLowerCase();
}

function isAptLocked(appointment) {
  const status = aptStatus(appointment);
  return (
    status === 'confirmed' ||
    status === 'cancelled' ||
    status === 'canceled'
  );
}

function ensureStatus(log) {
  if (!log.status) log.status = {};
  return log.status;
}

function markOpened(log, { overwriteCurrent, bumpCount = true } = {}) {
  log.opened = true;
  log.openedAt = log.openedAt || new Date();
  if (bumpCount) log.openedCount = (log.openedCount || 0) + 1;
  const status = ensureStatus(log);
  status.isOpened = true;
  status.isPending = false;
  status.isSent = true;
  status.isDelivered = true;
  status.isFailed = false;
  if (overwriteCurrent && !isLogLocked(log)) {
    status.current = 'opened';
  }
}

function markClicked(log, action) {
  // Clicking Confirm/Cancel means they opened the mail — even if the
  // pixel never fired (Gmail image proxy / blocked). Do not flip
  // status.current away from confirm/cancel.
  markOpened(log, { overwriteCurrent: false, bumpCount: !log.opened });
  log.clicked = true;
  log.clickedAt = log.clickedAt || new Date();
  log.clickedCount = (log.clickedCount || 0) + 1;
  log.clickedAction = action;
  const status = ensureStatus(log);
  status.current = action === 'confirm' ? 'confirmed' : 'cancelled';
  status.isPending = false;
  status.isSent = true;
  status.isDelivered = true;
  status.isFailed = false;
  status.isOpened = true;
  status.isClicked = true;
  status.isNoResponse = false;
}

function redirectForAppointment(appointment, tracking, action) {
  const base = frontendBase();
  if (appointment && action === 'confirm' && appointment.confirmationToken) {
    return `${base}/confirm/${appointment.confirmationToken}?tracking=${encodeURIComponent(
      tracking || ''
    )}&action=confirm`;
  }
  if (appointment && action === 'cancel' && appointment.cancellationToken) {
    return `${base}/cancel/${appointment.cancellationToken}?tracking=${encodeURIComponent(
      tracking || ''
    )}&action=cancel`;
  }
  return `${base}/`;
}

async function trackPixel(req, res) {
  try {
    const token = String((req.params && req.params.token) || '').trim();
    if (!token) return sendPixel(res);

    console.log(`📊 Tracking pixel hit for token: ${token}`);

    const log = await ReminderLog.findOne({ trackingToken: token });
    if (!log) {
      console.log(`❌ No log found for token: ${token}`);
      return sendPixel(res);
    }

    const locked = isLogLocked(log);
    markOpened(log, { overwriteCurrent: !locked });
    await log.save();

    console.log(
      `✅ Pixel tracked${locked ? ' (status locked)' : ''}: ${token} count=${log.openedCount}`
    );
    return sendPixel(res);
  } catch (error) {
    console.error('❌ Tracking pixel error:', error.message);
    return sendPixel(res);
  }
}

async function trackClick(req, res) {
  const tracking = String((req.query && req.query.tracking) || '').trim();
  const action = String((req.query && req.query.action) || '').trim();
  const redirect = req.query && req.query.redirect;

  const go = (url) => res.redirect(safeRedirect(url, `${frontendBase()}/`));

  try {
    console.log(`📊 Tracking click: tracking=${tracking}, action=${action}`);

    if (!tracking) return go(`${frontendBase()}/`);

    const log = await ReminderLog.findOne({ trackingToken: tracking });
    if (!log) return go(redirect);

    const appointment = log.appointmentId
      ? await Appointment.findById(log.appointmentId)
      : null;

    const lockedLog = isLogLocked(log);
    const lockedApt = isAptLocked(appointment);
    const existing = logAction(log) || (lockedApt ? (aptStatus(appointment) === 'confirmed' ? 'confirm' : 'cancel') : null);

    if (lockedLog || lockedApt) {
      markOpened(log, { overwriteCurrent: false, bumpCount: !log.opened });
      log.clickedCount = (log.clickedCount || 0) + 1;
      log.clickedAt = log.clickedAt || new Date();
      await log.save();
      console.log(
        `⏭️ Click ignored (locked ${existing || aptStatus(appointment)}) token=${tracking}`
      );
      const dest =
        redirectForAppointment(appointment, tracking, existing || action) +
        '&already=true';
      return go(redirect || dest);
    }

    if (action !== 'confirm' && action !== 'cancel') {
      log.clicked = true;
      log.clickedAt = new Date();
      log.clickedCount = (log.clickedCount || 0) + 1;
      await log.save();
      return go(redirect);
    }

    if (appointment) {
      const status = aptStatus(appointment);
      const pending =
        status === 'pending' || status === 'no_response' || status === 'scheduled';

      if (pending) {
        if (action === 'confirm') {
          appointment.confirmationStatus = 'confirmed';
          appointment.status = 'confirmed';
          await appointment.save();
          try {
            const { cancelActionReminders } = require('../services/reminderScheduler');
            await cancelActionReminders(appointment._id);
          } catch (err) {
            console.error('tracking cancelActionReminders', err.message);
          }
          console.log(`✅ Appointment confirmed: ${appointment._id}`);
        } else if (action === 'cancel') {
          appointment.confirmationStatus = 'cancelled';
          appointment.status = 'cancelled';
          await appointment.save();
          try {
            const { cancelReminders } = require('../services/reminderScheduler');
            await cancelReminders(appointment._id);
          } catch (err) {
            console.error('tracking cancelReminders', err.message);
          }
          console.log(`✅ Appointment cancelled: ${appointment._id}`);
        }
      }
    }

    markClicked(log, action);
    await log.save();

    const dest =
      redirectForAppointment(appointment, tracking, action) + '&success=true';
    return go(redirect || dest);
  } catch (error) {
    console.error('❌ Tracking click error:', error.message);
    return go(`${frontendBase()}/`);
  }
}

async function testTracking(req, res) {
  try {
    const token = String((req.params && req.params.token) || '').trim();
    const log = await ReminderLog.findOne({ trackingToken: token }).lean();
    return res.json({
      success: true,
      log: log
        ? {
            id: log._id,
            trackingToken: log.trackingToken,
            opened: log.opened,
            openedAt: log.openedAt,
            openedCount: log.openedCount,
            clicked: log.clicked,
            clickedAt: log.clickedAt,
            clickedAction: log.clickedAction,
            status: log.status,
            locked: isLogLocked(log),
          }
        : null,
      message: log ? 'Log found' : 'No log found',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

async function testOpen(req, res) {
  try {
    const token = String((req.params && req.params.token) || '').trim();
    const log = await ReminderLog.findOne({ trackingToken: token });
    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'No log found for token: ' + token,
      });
    }

    const locked = isLogLocked(log);
    markOpened(log, { overwriteCurrent: !locked });
    await log.save();

    return res.json({
      success: true,
      message: locked
        ? 'Open counted; confirm/cancel status left unchanged'
        : 'Email marked as opened',
      log: {
        id: log._id,
        trackingToken: log.trackingToken,
        opened: log.opened,
        openedAt: log.openedAt,
        openedCount: log.openedCount,
        clickedAction: log.clickedAction,
        status: log.status,
        locked,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = {
  trackPixel,
  trackClick,
  testTracking,
  testOpen,
};
