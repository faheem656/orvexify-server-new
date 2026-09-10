/** DROP-IN: src/services/agendaService.js — Agenda 5.x
 *
 * 24h  → pending: Confirm + Cancel (same as before)
 * 2h   → cancelled: skip | confirmed: skip | pending: Confirm + Cancel
 * 30min → cancelled: skip | pending: skip | confirmed: date/time only, once
 *
 * 30 min (not 20): email delay + travel. Not a Settings switch.
 */

const Agenda = require('agenda');
const crypto = require('crypto');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const ReminderLog = require('../models/ReminderLog');
const { sendReminderEmail } = require('./emailService');

let ReminderSettings;
try {
  ReminderSettings = require('../models/ReminderSettings');
} catch {
  ReminderSettings = null;
}

if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined!');
  process.exit(1);
}

console.log('📋 Agenda initializing...');

const agenda = new Agenda({
  db: {
    address: process.env.MONGODB_URI,
    collection: 'agendaJobs',
  },
  processEvery: '5 seconds',
  defaultConcurrency: 5,
  maxConcurrency: 10,
  defaultLockLimit: 1,
  defaultLockLifetime: 30000,
});

agenda.on('ready', () => {
  console.log('✅ Agenda ready! Worker started');
});

agenda.on('error', (error) => {
  console.error('❌ Agenda error:', error);
});

agenda.on('start', (job) => {
  console.log(`🔄 [Job] ${job.attrs.name} started`);
});

agenda.on('success', (job) => {
  console.log(`✅ [Job] ${job.attrs.name} completed`);
});

agenda.on('fail', (error, job) => {
  console.error(`❌ [Job] ${job.attrs.name} failed:`, error.message);
});

setTimeout(async () => {
  console.log('🔄 [STARTUP] Running startup recovery...');
  try {
    const jobs = await agenda.jobs({
      nextRunAt: { $lte: new Date() },
    });

    if (jobs.length > 0) {
      console.log(`📋 [STARTUP] Found ${jobs.length} missed jobs`);
      for (const job of jobs) {
        try {
          console.log(`🔄 [STARTUP] Processing ${job.attrs.name}...`);
          await job.run();
          console.log(`✅ [STARTUP] ${job.attrs.name} completed`);
        } catch (err) {
          console.error(`❌ [STARTUP] ${job.attrs.name} failed:`, err.message);
        }
      }
      console.log('✅ [STARTUP] Startup recovery completed');
    } else {
      console.log('✅ [STARTUP] No missed jobs found');
    }
  } catch (error) {
    console.error('❌ [STARTUP] Startup recovery failed:', error.message);
  }
}, 5000);

const generateTrackingToken = () => crypto.randomBytes(32).toString('hex');

function statusOf(appointment) {
  return String(
    (appointment && (appointment.confirmationStatus || appointment.status)) || ''
  ).toLowerCase();
}

function isCancelledStatus(status) {
  return status === 'cancelled' || status === 'canceled';
}

function isConfirmedStatus(status) {
  return status === 'confirmed';
}

function isWeekendNow() {
  const day = new Date().getDay();
  return day === 0 || day === 6;
}

async function loadReminderSettings(userId) {
  const defaults = {
    enable24hReminder: true,
    enable2hReminder: true,
    sendRemindersOnWeekends: true,
  };
  if (!ReminderSettings || !userId) return defaults;
  try {
    const row = await ReminderSettings.findOne({ userId }).lean();
    if (!row) return defaults;
    return {
      enable24hReminder:
        typeof row.enable24hReminder === 'boolean'
          ? row.enable24hReminder
          : defaults.enable24hReminder,
      enable2hReminder:
        typeof row.enable2hReminder === 'boolean'
          ? row.enable2hReminder
          : defaults.enable2hReminder,
      sendRemindersOnWeekends:
        typeof row.sendRemindersOnWeekends === 'boolean'
          ? row.sendRemindersOnWeekends
          : defaults.sendRemindersOnWeekends,
    };
  } catch (err) {
    console.error('loadReminderSettings:', err.message);
    return defaults;
  }
}

function personName(doc, fallback) {
  if (!doc) return fallback;
  if (typeof doc === 'string') return fallback;
  return doc.name || fallback;
}

function personEmail(doc) {
  if (!doc || typeof doc === 'string') return '';
  return String(doc.email || '').trim();
}

const sendReminder = async (appointmentId, reminderType) => {
  console.log(`📧 Sending ${reminderType} reminder for ${appointmentId}`);

  try {
    const appointment = await Appointment.findById(appointmentId)
      .populate('patientId')
      .populate('doctorId');

    if (!appointment) {
      console.log(`❌ Appointment ${appointmentId} not found`);
      return { success: false, error: 'Appointment not found' };
    }

    const status = statusOf(appointment);
    const cancelled = isCancelledStatus(status);
    const confirmed = isConfirmedStatus(status);

    if (cancelled) {
      console.log(`⏭️ Appointment cancelled, skipping ${reminderType}`);
      return { success: false, skipped: true, reason: 'cancelled' };
    }

    const sentField = `reminder${reminderType}Sent`;
    if (appointment[sentField]) {
      console.log(`⏭️ ${reminderType} already sent for ${appointmentId}`);
      return { success: false, skipped: true, reason: 'already_sent' };
    }

    const settings = await loadReminderSettings(appointment.userId);

    if (reminderType === '24h' || reminderType === '2h') {
      if (!settings.sendRemindersOnWeekends && isWeekendNow()) {
        console.log(`⏭️ Weekend send disabled, skipping ${reminderType}`);
        return { success: false, skipped: true, reason: 'weekend' };
      }
    }

    if (reminderType === '24h') {
      if (settings.enable24hReminder === false) {
        console.log('⏭️ 24h reminder disabled in settings');
        return { success: false, skipped: true, reason: 'disabled' };
      }
      if (confirmed) {
        console.log('⏭️ Already confirmed, skipping 24h');
        return { success: false, skipped: true, reason: 'confirmed' };
      }
    }

    if (reminderType === '2h') {
      if (settings.enable2hReminder === false) {
        console.log('⏭️ 2h reminder disabled in settings');
        return { success: false, skipped: true, reason: 'disabled' };
      }
      if (confirmed) {
        console.log('⏭️ Already confirmed, skipping 2h (30min coming-soon will send)');
        return { success: false, skipped: true, reason: 'confirmed' };
      }
    }

    if (reminderType === '30min') {
      if (!confirmed) {
        console.log('⏭️ 30min is for confirmed visits only, skipping');
        return { success: false, skipped: true, reason: 'not_confirmed' };
      }
    }

    const clinic = await User.findById(appointment.userId);
    if (!clinic) {
      console.log(`❌ Clinic not found for ${appointment.userId}`);
      return { success: false, error: 'Clinic not found' };
    }

    const patient = appointment.patientId;
    const doctor = appointment.doctorId;
    const to = personEmail(patient);
    if (!to) {
      console.log(`❌ Patient email missing for ${appointmentId}`);
      return { success: false, error: 'Patient email missing' };
    }

    const trackingToken = generateTrackingToken();
    const showActions = reminderType !== '30min';

    const log = await ReminderLog.create({
      userId: appointment.userId,
      appointmentId: appointment._id,
      patientId: (patient && patient._id) || appointment.patientId,
      doctorId: (doctor && doctor._id) || appointment.doctorId,
      reminderType,
      status: {
        current: 'pending',
        isPending: true,
        isSent: false,
        isDelivered: false,
        isFailed: false,
        isOpened: false,
        isClicked: false,
        isNoResponse: false,
      },
      trackingToken,
      sentAt: new Date(),
      retryCount: 0,
    });

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';

    let reminderLabel = 'Appointment Reminder';
    let urgency = 'low';
    if (reminderType === '24h') {
      reminderLabel = '24-Hour Reminder';
      urgency = 'low';
    } else if (reminderType === '2h') {
      reminderLabel = '2-Hour Reminder';
      urgency = 'medium';
    } else if (reminderType === '30min') {
      reminderLabel = 'See you in 30 minutes';
      urgency = 'coming';
    }

    const confirmToken = appointment.confirmationToken || '';
    const cancelToken = appointment.cancellationToken || '';

    const result = await sendReminderEmail(
      appointment.userId,
      to,
      personName(patient, 'Patient'),
      clinic.clinicName || 'Clinic',
      appointment.appointmentDate,
      appointment.appointmentTime,
      personName(doctor, 'Doctor'),
      `${baseUrl}/confirm/${confirmToken}?tracking=${trackingToken}`,
      `${baseUrl}/cancel/${cancelToken}?tracking=${trackingToken}`,
      log._id,
      `${backendUrl}/api/tracking/pixel/${trackingToken}`,
      reminderLabel,
      urgency,
      { showActions }
    );

    if (result.success) {
      const updateField = {};
      updateField[sentField] = true;
      updateField[`reminder${reminderType}SentAt`] = new Date();
      updateField[`reminder${reminderType}LogId`] = log._id;
      updateField.lastReminderAttempt = new Date();
      await Appointment.findByIdAndUpdate(appointmentId, { $set: updateField });

      log.status.current = 'sent';
      log.status.isSent = true;
      log.status.isDelivered = true;
      log.status.isPending = false;
      log.sentAt = new Date();
      await log.save();

      console.log(`✅ ${reminderType} reminder sent for ${appointmentId}`);
      return { success: true };
    }

    log.status.current = 'failed';
    log.status.isFailed = true;
    log.status.isPending = false;
    log.errorMessage = result.error || 'Email send failed';
    await log.save();

    throw new Error(result.error || 'Email send failed');
  } catch (error) {
    console.error(`❌ ${reminderType} reminder failed:`, error.message);
    return { success: false, error: error.message };
  }
};

agenda.define('send-24h-reminder', async (job) => {
  const { appointmentId } = job.attrs.data || {};
  await sendReminder(appointmentId, '24h');
});

agenda.define('send-2h-reminder', async (job) => {
  const { appointmentId } = job.attrs.data || {};
  await sendReminder(appointmentId, '2h');
});

agenda.define('send-30min-reminder', async (job) => {
  const { appointmentId } = job.attrs.data || {};
  await sendReminder(appointmentId, '30min');
});

agenda
  .start()
  .then(() => {
    console.log('✅ Agenda started successfully');
  })
  .catch((error) => {
    console.error('❌ Agenda start failed:', error);
  });

module.exports = {
  agenda,
  sendReminder,
};
