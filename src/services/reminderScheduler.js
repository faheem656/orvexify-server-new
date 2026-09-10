/** DROP-IN: src/services/reminderScheduler.js
 *
 * Booking / staff create isi se 3 Agenda jobs lagate hain.
 * Send logic agendaService mein hai — yahan sirf TIME set hota hai.
 *
 * 24h/2h hours Clinic ReminderSettings se (1–72 / 1–24). Fallback 24 + 2.
 * 30min hamesha schedule (Settings switch nahi). Send pe confirmed-only.
 */

const moment = require('moment-timezone');
const { agenda } = require('./agendaService');
const Appointment = require('../models/Appointment');
const User = require('../models/User');

let ReminderSettings;
try {
  ReminderSettings = require('../models/ReminderSettings');
} catch {
  ReminderSettings = null;
}

function aptId(appointmentId) {
  return String(appointmentId);
}

async function loadHours(userId) {
  const hours = { first: 24, second: 2, enable24h: true, enable2h: true };
  if (!ReminderSettings || !userId) return hours;
  try {
    const row = await ReminderSettings.findOne({ userId }).lean();
    if (!row) return hours;
    const first = Number(
      row.defaultReminderHours && row.defaultReminderHours.firstReminder
    );
    const second = Number(
      row.defaultReminderHours && row.defaultReminderHours.secondReminder
    );
    if (Number.isFinite(first) && first >= 1 && first <= 72) hours.first = first;
    if (Number.isFinite(second) && second >= 1 && second <= 24) {
      hours.second = second;
    }
    if (typeof row.enable24hReminder === 'boolean') {
      hours.enable24h = row.enable24hReminder;
    }
    if (typeof row.enable2hReminder === 'boolean') {
      hours.enable2h = row.enable2hReminder;
    }
  } catch (err) {
    console.error('reminderScheduler settings:', err.message);
  }
  return hours;
}

async function removeJobs(appointmentId, names) {
  const id = aptId(appointmentId);
  const query = { 'data.appointmentId': id };
  if (names && names.length) query.name = { $in: names };
  const jobs = await agenda.jobs(query);
  for (const job of jobs) {
    try {
      await job.remove();
    } catch (err) {
      console.error('remove job', job.attrs && job.attrs.name, err.message);
    }
  }
  return jobs.length;
}

async function scheduleOne(when, name, appointmentId) {
  await agenda.schedule(when.toDate(), name, {
    appointmentId: aptId(appointmentId),
  });
  console.log(`✅ ${name} scheduled for ${when.format()}`);
}

const scheduleAppointmentReminders = async (appointment) => {
  if (!appointment || !appointment._id) {
    return { success: false, error: 'No appointment', scheduled: 0 };
  }

  console.log(`📋 Scheduling reminders for appointment ${appointment._id}`);

  try {
    const clinic = await User.findById(appointment.userId);
    const timezone = (clinic && clinic.timezone) || 'Asia/Karachi';
    const hours = await loadHours(appointment.userId);

    console.log(`📍 Clinic timezone: ${timezone}`);

    const aptTime = moment.tz(
      `${appointment.appointmentDate} ${appointment.appointmentTime}`,
      'YYYY-MM-DD HH:mm',
      timezone
    );
    const now = moment().tz(timezone);

    if (!aptTime.isValid()) {
      console.error('❌ Invalid appointment date/time');
      return { success: false, error: 'Invalid appointment time', scheduled: 0 };
    }

    console.log(`📅 Appointment time: ${aptTime.format()}`);
    console.log(`🕐 Current time: ${now.format()}`);

    await removeJobs(appointment._id);

    let scheduled = 0;

    if (hours.enable24h) {
      const time24h = aptTime.clone().subtract(hours.first, 'hours');
      if (time24h.isAfter(now)) {
        await scheduleOne(time24h, 'send-24h-reminder', appointment._id);
        scheduled += 1;
      } else {
        console.log(`⏭️ 24h skipped (time passed, ${hours.first}h)`);
      }
    } else {
      console.log('⏭️ 24h disabled in settings');
    }

    if (hours.enable2h) {
      const time2h = aptTime.clone().subtract(hours.second, 'hours');
      if (time2h.isAfter(now)) {
        await scheduleOne(time2h, 'send-2h-reminder', appointment._id);
        scheduled += 1;
      } else {
        console.log(`⏭️ 2h skipped (time passed, ${hours.second}h)`);
      }
    } else {
      console.log('⏭️ 2h disabled in settings');
    }

    const time30min = aptTime.clone().subtract(30, 'minutes');
    if (time30min.isAfter(now)) {
      await scheduleOne(time30min, 'send-30min-reminder', appointment._id);
      scheduled += 1;
    } else {
      console.log('⏭️ 30min skipped (time passed)');
    }

    console.log(`✅ ${scheduled} reminders scheduled for ${appointment._id}`);
    return { success: true, scheduled };
  } catch (error) {
    console.error(`❌ Schedule error for ${appointment._id}:`, error);
    return { success: false, error: error.message, scheduled: 0 };
  }
};

/** Cancelled visit — 24h + 2h + 30min sab hatao */
const cancelReminders = async (appointmentId) => {
  try {
    console.log(`❌ Cancelling ALL reminders for ${appointmentId}`);
    const removed = await removeJobs(appointmentId);

    await Appointment.findByIdAndUpdate(appointmentId, {
      reminder24hCancelled: true,
      reminder2hCancelled: true,
      reminder30minCancelled: true,
    });

    console.log(`✅ Removed ${removed} jobs for ${appointmentId}`);
    return { success: true, removed };
  } catch (error) {
    console.error(`❌ Cancel error for ${appointmentId}:`, error);
    return { success: false, error: error.message };
  }
};

/** Patient confirmed — 24h/2h hatao, 30min coming-soon rehne do */
const cancelActionReminders = async (appointmentId) => {
  try {
    console.log(`❌ Cancelling 24h/2h (keep 30min) for ${appointmentId}`);
    const removed = await removeJobs(appointmentId, [
      'send-24h-reminder',
      'send-2h-reminder',
    ]);
    console.log(`✅ Removed ${removed} action jobs for ${appointmentId}`);
    return { success: true, removed };
  } catch (error) {
    console.error(`❌ cancelActionReminders ${appointmentId}:`, error);
    return { success: false, error: error.message };
  }
};

const checkAllJobs = async () => {
  try {
    const jobs = await agenda.jobs({
      nextRunAt: { $exists: true, $ne: null },
    });

    console.log(`📋 Total scheduled jobs: ${jobs.length}`);
    for (const job of jobs) {
      const data = (job.attrs && job.attrs.data) || {};
      console.log(
        `  - ${job.attrs.name} → ${data.appointmentId} at ${job.attrs.nextRunAt}`
      );
    }

    return { success: true, count: jobs.length };
  } catch (error) {
    console.error('❌ Error checking jobs:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  scheduleAppointmentReminders,
  cancelReminders,
  cancelActionReminders,
  checkAllJobs,
};
