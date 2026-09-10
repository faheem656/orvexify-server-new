/** DROP-IN: src/controllers/reminderLog.controller.js
 *
 * GET  /reminder-logs
 * GET  /reminder-logs/export
 * GET  /reminder-logs/appointment/:appointmentId
 * GET  /reminder-logs/:id
 * PUT  /reminder-logs/:id/status
 * POST /reminder-logs/:id/opened
 * POST /reminder-logs/:id/clicked
 */

const mongoose = require('mongoose');
const ReminderLog = require('../models/ReminderLog');
const Patient = require('../models/Patient');
const Appointment = require('../models/Appointment');
const Doctor = require('../models/Doctor');

const VALID_STATUSES = [
  'pending',
  'sent',
  'delivered',
  'failed',
  'opened',
  'clicked',
  'no_response',
];

function httpError(message, code, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('reminder-logs', err);
  return res.status(status).json({
    success: false,
    code: err.code || 'REMINDER_LOG_ERROR',
    message: err.message || 'Server error',
  });
}

function userIdOf(req) {
  return req.user && (req.user._id || req.user.id);
}

function asObjectId(id) {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (!mongoose.isValidObjectId(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

function normalizeStatus(log) {
  const s = (log && log.status) || {};
  return {
    current: s.current || 'pending',
    isPending: !!s.isPending,
    isSent: !!s.isSent,
    isDelivered: !!s.isDelivered,
    isFailed: !!s.isFailed,
    isOpened: !!s.isOpened,
    isClicked: !!s.isClicked,
    isNoResponse: !!s.isNoResponse,
  };
}

function applyStatusFilter(query, status) {
  if (!status || status === 'all') return;
  switch (status) {
    case 'pending':
      query['status.isPending'] = true;
      break;
    case 'sent':
      query['status.isSent'] = true;
      break;
    case 'delivered':
      query['status.isDelivered'] = true;
      break;
    case 'failed':
      query['status.isFailed'] = true;
      break;
    case 'opened':
      query.$or = [{ 'status.isOpened': true }, { opened: true }];
      break;
    case 'clicked':
      query.$or = [{ 'status.isClicked': true }, { clicked: true }];
      break;
    case 'confirmed':
      query.clickedAction = 'confirm';
      break;
    case 'cancelled':
      query.clickedAction = 'cancel';
      break;
    case 'no_response':
      query['status.isNoResponse'] = true;
      break;
    default:
      break;
  }
}

function applyDateFilter(query, dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return;
  query.sentAt = query.sentAt || {};
  if (dateFrom) {
    const from = new Date(dateFrom);
    if (!Number.isNaN(from.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateFrom))) from.setHours(0, 0, 0, 0);
      query.sentAt.$gte = from;
    }
  }
  if (dateTo) {
    const to = new Date(dateTo);
    if (!Number.isNaN(to.getTime())) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateTo))) to.setHours(23, 59, 59, 999);
      query.sentAt.$lte = to;
    }
  }
}

function reminderTypeLabel(type) {
  if (type === '24h') return '24 Hour';
  if (type === '2h') return '2 Hour';
  if (type === '30min') return '30 Minute';
  return type || 'N/A';
}

async function patientMapFor(ids) {
  const unique = [...new Set((ids || []).map((id) => String(id || '')).filter(Boolean))];
  if (!unique.length) return {};
  const rows = await Patient.find({ _id: { $in: unique } }).lean();
  const map = {};
  rows.forEach((row) => {
    map[String(row._id)] = row;
  });
  return map;
}

async function appointmentMapFor(ids) {
  const unique = [...new Set((ids || []).map((id) => String(id || '')).filter(Boolean))];
  if (!unique.length) return {};
  const rows = await Appointment.find({ _id: { $in: unique } }).lean();
  const map = {};
  rows.forEach((row) => {
    map[String(row._id)] = row;
  });
  return map;
}

async function searchPatientIds(userId, search) {
  const q = String(search || '').trim();
  if (!q) return null;
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const patients = await Patient.find({
    userId,
    $or: [{ name: rx }, { email: rx }],
  })
    .select('_id')
    .lean();
  return patients.map((row) => row._id);
}

async function computeUserStats(userId) {
  const empty = {
    totalSent: 0,
    pending: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    opened: 0,
    clicked: 0,
    confirmed: 0,
    cancelled: 0,
    noResponse: 0,
  };

  const matchId = asObjectId(userId) || userId;
  const rows = await ReminderLog.aggregate([
    { $match: { userId: matchId } },
    {
      $group: {
        _id: null,
        totalSent: { $sum: 1 },
        pending: { $sum: { $cond: [{ $eq: ['$status.isPending', true] }, 1, 0] } },
        sent: { $sum: { $cond: [{ $eq: ['$status.isSent', true] }, 1, 0] } },
        delivered: {
          $sum: { $cond: [{ $eq: ['$status.isDelivered', true] }, 1, 0] },
        },
        failed: { $sum: { $cond: [{ $eq: ['$status.isFailed', true] }, 1, 0] } },
        opened: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ['$status.isOpened', true] },
                  { $eq: ['$opened', true] },
                ],
              },
              1,
              0,
            ],
          },
        },
        clicked: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ['$status.isClicked', true] },
                  { $eq: ['$clicked', true] },
                ],
              },
              1,
              0,
            ],
          },
        },
        confirmed: {
          $sum: { $cond: [{ $eq: ['$clickedAction', 'confirm'] }, 1, 0] },
        },
        cancelled: {
          $sum: { $cond: [{ $eq: ['$clickedAction', 'cancel'] }, 1, 0] },
        },
        noResponse: {
          $sum: { $cond: [{ $eq: ['$status.isNoResponse', true] }, 1, 0] },
        },
      },
    },
  ]);

  if (!rows[0]) return empty;
  const row = rows[0];
  delete row._id;
  return { ...empty, ...row };
}

function appointmentStats(logs) {
  return {
    totalReminders: logs.length,
    sent24h: logs.filter((l) => l.reminderType === '24h').length,
    sent2h: logs.filter((l) => l.reminderType === '2h').length,
    sent30min: logs.filter((l) => l.reminderType === '30min').length,
    pending: logs.filter(
      (l) => l.status?.current === 'pending' || l.status?.isPending === true
    ).length,
    sent: logs.filter(
      (l) => l.status?.current === 'sent' || l.status?.isSent === true
    ).length,
    delivered: logs.filter((l) => l.status?.isDelivered === true).length,
    opened: logs.filter(
      (l) =>
        l.opened === true ||
        l.status?.current === 'opened' ||
        l.status?.isOpened === true
    ).length,
    clicked: logs.filter(
      (l) =>
        l.clicked === true ||
        l.status?.current === 'clicked' ||
        l.status?.isClicked === true
    ).length,
    clickedAction: (logs.find((l) => l.clicked === true) || {}).clickedAction || null,
    failed: logs.filter(
      (l) => l.status?.current === 'failed' || l.status?.isFailed === true
    ).length,
    noResponse: logs.filter(
      (l) =>
        l.status?.current === 'no_response' || l.status?.isNoResponse === true
    ).length,
  };
}

async function getReminderLogs(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);

    const { search, type, status, dateFrom, dateTo } = req.query || {};
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const query = { userId };
    if (type && type !== 'all') query.reminderType = type;
    applyStatusFilter(query, status);
    applyDateFilter(query, dateFrom, dateTo);

    if (search) {
      const ids = await searchPatientIds(userId, search);
      query.patientId = { $in: ids && ids.length ? ids : [] };
    }

    const skip = (page - 1) * limit;
    const [logs, total, stats] = await Promise.all([
      ReminderLog.find(query).sort({ sentAt: -1 }).skip(skip).limit(limit).lean(),
      ReminderLog.countDocuments(query),
      computeUserStats(userId),
    ]);

    const [patients, appointments] = await Promise.all([
      patientMapFor(logs.map((l) => l.patientId)),
      appointmentMapFor(logs.map((l) => l.appointmentId)),
    ]);

    const enrichedLogs = logs.map((log) => ({
      ...log,
      status: normalizeStatus(log),
      patient: patients[String(log.patientId)] || null,
      appointment: appointments[String(log.appointmentId)] || null,
    }));

    return res.json({
      success: true,
      logs: enrichedLogs,
      stats,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit) || 0,
        totalItems: total,
        itemsPerPage: limit,
      },
    });
  } catch (error) {
    console.error('Get reminder logs error:', error);
    return fail(res, error);
  }
}

async function getLogsByAppointment(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);

    const appointmentId = req.params.appointmentId;
    if (!asObjectId(appointmentId)) {
      throw httpError('Appointment not found or unauthorized', 'NOT_FOUND', 404);
    }

    const appointment = await Appointment.findOne({
      _id: appointmentId,
      userId,
    });
    if (!appointment) {
      throw httpError('Appointment not found or unauthorized', 'NOT_FOUND', 404);
    }

    const logs = await ReminderLog.find({
      appointmentId,
      userId,
    })
      .sort({ sentAt: -1 })
      .lean();

    const [patient, doctor] = await Promise.all([
      appointment.patientId ? Patient.findById(appointment.patientId).lean() : null,
      appointment.doctorId ? Doctor.findById(appointment.doctorId).lean() : null,
    ]);

    const appointmentPayload = {
      id: appointment._id,
      date: appointment.appointmentDate,
      time: appointment.appointmentTime,
      status: appointment.status,
      confirmationStatus: appointment.confirmationStatus,
    };

    const enrichedLogs = logs.map((log) => ({
      ...log,
      status: normalizeStatus(log),
      patient: patient || null,
      doctor: doctor || null,
      appointment: appointmentPayload,
    }));

    return res.json({
      success: true,
      appointment: {
        ...appointmentPayload,
        patient: patient
          ? {
              id: patient._id,
              name: patient.name,
              email: patient.email,
              phone: patient.phone,
            }
          : null,
        doctor: doctor
          ? {
              id: doctor._id,
              name: doctor.name,
              specialty: doctor.specialty,
            }
          : null,
      },
      logs: enrichedLogs,
      stats: appointmentStats(logs),
      summary: {
        lastReminder: logs.length > 0 ? logs[0].sentAt : null,
        firstReminder: logs.length > 0 ? logs[logs.length - 1].sentAt : null,
        totalReminders: logs.length,
        hasInteraction: logs.some((l) => l.clicked === true || l.opened === true),
      },
    });
  } catch (error) {
    console.error('Get appointment logs error:', error);
    return fail(res, error);
  }
}

async function getReminderLogById(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);
    if (!asObjectId(req.params.id)) {
      throw httpError('Log not found', 'NOT_FOUND', 404);
    }

    const log = await ReminderLog.findOne({
      _id: req.params.id,
      userId,
    }).lean();
    if (!log) throw httpError('Log not found', 'NOT_FOUND', 404);

    const [patient, appointment, doctor] = await Promise.all([
      log.patientId ? Patient.findById(log.patientId).lean() : null,
      log.appointmentId ? Appointment.findById(log.appointmentId).lean() : null,
      log.doctorId ? Doctor.findById(log.doctorId).lean() : null,
    ]);

    return res.json({
      success: true,
      log: {
        ...log,
        status: normalizeStatus(log),
        patient,
        appointment,
        doctor,
      },
    });
  } catch (error) {
    console.error('Get reminder log error:', error);
    return fail(res, error);
  }
}

async function updateLogStatus(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);

    const status = req.body && req.body.status;
    if (!status || !VALID_STATUSES.includes(status)) {
      throw httpError(
        'Invalid status. Must be one of: ' + VALID_STATUSES.join(', '),
        'BAD_INPUT',
        400
      );
    }

    if (!asObjectId(req.params.id)) {
      throw httpError('Log not found', 'NOT_FOUND', 404);
    }

    const log = await ReminderLog.findOne({ _id: req.params.id, userId });
    if (!log) throw httpError('Log not found', 'NOT_FOUND', 404);

    log.status = log.status || {};
    log.status.current = status;
    log.status.isPending = status === 'pending';
    log.status.isSent =
      status === 'sent' ||
      status === 'delivered' ||
      status === 'opened' ||
      status === 'clicked';
    log.status.isDelivered =
      status === 'sent' ||
      status === 'delivered' ||
      status === 'opened' ||
      status === 'clicked';
    log.status.isFailed = status === 'failed';
    log.status.isOpened = status === 'opened';
    log.status.isClicked = status === 'clicked';
    log.status.isNoResponse = status === 'no_response';
    await log.save();

    return res.json({
      success: true,
      message: 'Status updated successfully',
      log,
    });
  } catch (error) {
    console.error('Update log status error:', error);
    return fail(res, error);
  }
}

async function markLogOpened(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);
    if (!asObjectId(req.params.id)) {
      throw httpError('Log not found', 'NOT_FOUND', 404);
    }

    const log = await ReminderLog.findOne({ _id: req.params.id, userId });
    if (!log) throw httpError('Log not found', 'NOT_FOUND', 404);

    log.opened = true;
    log.openedAt = new Date();
    log.openedCount = (log.openedCount || 0) + 1;
    log.status = log.status || {};
    log.status.current = 'opened';
    log.status.isPending = false;
    log.status.isSent = true;
    log.status.isDelivered = true;
    log.status.isFailed = false;
    log.status.isOpened = true;
    log.status.isClicked = false;
    log.status.isNoResponse = false;
    await log.save();

    return res.json({
      success: true,
      message: 'Marked as opened',
      log,
    });
  } catch (error) {
    console.error('Mark opened error:', error);
    return fail(res, error);
  }
}

async function markLogClicked(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);

    const action = req.body && req.body.action;
    if (!action || !['confirm', 'cancel'].includes(action)) {
      throw httpError('Action must be "confirm" or "cancel"', 'BAD_INPUT', 400);
    }

    if (!asObjectId(req.params.id)) {
      throw httpError('Log not found', 'NOT_FOUND', 404);
    }

    const log = await ReminderLog.findOne({ _id: req.params.id, userId });
    if (!log) throw httpError('Log not found', 'NOT_FOUND', 404);

    log.clicked = true;
    log.clickedAt = new Date();
    log.clickedCount = (log.clickedCount || 0) + 1;
    log.clickedAction = action;
    log.status = log.status || {};
    log.status.current = 'clicked';
    log.status.isPending = false;
    log.status.isSent = true;
    log.status.isDelivered = true;
    log.status.isFailed = false;
    log.status.isOpened = true;
    log.status.isClicked = true;
    log.status.isNoResponse = false;
    await log.save();

    return res.json({
      success: true,
      message: 'Marked as clicked',
      log,
    });
  } catch (error) {
    console.error('Mark clicked error:', error);
    return fail(res, error);
  }
}

async function exportReminderLogs(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);

    const { dateFrom, dateTo, type, status } = req.query || {};
    const query = { userId };
    if (type && type !== 'all') query.reminderType = type;
    applyDateFilter(query, dateFrom, dateTo);
    if (status && status !== 'all') query['status.current'] = status;

    const logs = await ReminderLog.find(query).sort({ sentAt: -1 }).lean();
    const patients = await patientMapFor(logs.map((l) => l.patientId));

    const exportData = logs.map((log) => {
      const patient = patients[String(log.patientId)] || {};
      return {
        'Patient Name': patient.name || 'N/A',
        'Patient Email': patient.email || 'N/A',
        'Reminder Type': reminderTypeLabel(log.reminderType),
        'Sent At': log.sentAt ? new Date(log.sentAt).toLocaleString() : '-',
        Status: (log.status && log.status.current) || 'pending',
        Pending: log.status && log.status.isPending ? 'Yes' : 'No',
        Sent: log.status && log.status.isSent ? 'Yes' : 'No',
        Delivered: log.status && log.status.isDelivered ? 'Yes' : 'No',
        Failed: log.status && log.status.isFailed ? 'Yes' : 'No',
        Opened: log.opened || (log.status && log.status.isOpened) ? 'Yes' : 'No',
        'Opened At': log.openedAt ? new Date(log.openedAt).toLocaleString() : '-',
        Action: log.clickedAction || 'None',
        'Action At': log.clickedAt ? new Date(log.clickedAt).toLocaleString() : '-',
        'Retry Count': log.retryCount || 0,
        Error: log.errorMessage || '-',
      };
    });

    return res.json({ success: true, exportData });
  } catch (error) {
    console.error('Export logs error:', error);
    return fail(res, error);
  }
}

module.exports = {
  getReminderLogs,
  getLogsByAppointment,
  getReminderLogById,
  updateLogStatus,
  markLogOpened,
  markLogClicked,
  exportReminderLogs,
};
