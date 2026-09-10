/** DROP-IN: src/scheduler/noResponseHandler.js
 *
 * Har hour: jo visit nikal chuki, confirm/cancel nahi hua → no_response + no_show.
 * Confirmed / cancelled ko nahi chheeta (30-min coming-soon unke liye alag hai).
 */

const cron = require('node-cron');
const moment = require('moment-timezone');
const Appointment = require('../models/Appointment');
const ReminderLog = require('../models/ReminderLog');

let cancelReminders = async () => ({ success: false });
try {
  ({ cancelReminders } = require('../services/reminderScheduler'));
} catch {
  console.warn('noResponseHandler: reminderScheduler.cancelReminders missing');
}

let running = false;

function clinicNow(timezone) {
  return moment.tz(timezone || 'Asia/Karachi');
}

function appointmentMoment(apt) {
  const timezone = apt.timezone || 'Asia/Karachi';
  return moment.tz(
    `${apt.appointmentDate} ${apt.appointmentTime}`,
    'YYYY-MM-DD HH:mm',
    timezone
  );
}

const markNoResponseAppointments = async () => {
  if (running) {
    console.log('⏭️ No-response handler already running, skip');
    return;
  }
  running = true;
  console.log('🔄 Checking for no-response appointments...');

  try {
    const from = moment().subtract(45, 'days').format('YYYY-MM-DD');
    const to = moment().add(2, 'days').format('YYYY-MM-DD');

    const appointments = await Appointment.find({
      confirmationStatus: 'pending',
      status: { $nin: ['cancelled', 'canceled', 'confirmed', 'completed', 'no_show'] },
      appointmentDate: { $gte: from, $lte: to },
    }).select(
      '_id appointmentDate appointmentTime timezone confirmationStatus status userId'
    );

    console.log(`📋 Found ${appointments.length} pending appointments to check`);

    let markedCount = 0;

    for (const apt of appointments) {
      const timezone = apt.timezone || 'Asia/Karachi';
      const aptTime = appointmentMoment(apt);
      if (!aptTime.isValid()) continue;

      const now = clinicNow(timezone);
      if (!now.isAfter(aptTime)) continue;

      const clicked = await ReminderLog.countDocuments({
        appointmentId: apt._id,
        $or: [{ clicked: true }, { clickedAction: { $in: ['confirm', 'cancel'] } }],
      });

      if (clicked > 0) {
        console.log(`⏭️ ${apt._id} has a click on a reminder log, skip auto no_response`);
        continue;
      }

      apt.confirmationStatus = 'no_response';
      apt.status = 'no_show';
      await apt.save();

      try {
        await ReminderLog.updateMany(
          {
            appointmentId: apt._id,
            clicked: { $ne: true },
          },
          {
            $set: {
              'status.current': 'no_response',
              'status.isPending': false,
              'status.isNoResponse': true,
            },
          }
        );
      } catch (err) {
        console.error('noResponse logs', apt._id, err.message);
      }

      try {
        await cancelReminders(apt._id);
      } catch (err) {
        console.error('noResponse cancel jobs', apt._id, err.message);
      }

      markedCount += 1;
      console.log(
        `⏰ Marked no_response: ${apt._id} (${apt.appointmentDate} ${apt.appointmentTime})`
      );
    }

    console.log(`✅ Marked ${markedCount} appointments as no_response`);
  } catch (error) {
    console.error('❌ No-response handler error:', error);
  } finally {
    running = false;
  }
};

cron.schedule('0 * * * *', markNoResponseAppointments);

setTimeout(markNoResponseAppointments, 10000);

console.log('✅ No-response handler started');
console.log('  - Runs: Every hour');
console.log('  - Checks: Past pending appointments with no confirm/cancel');

module.exports = {
  markNoResponseAppointments,
};
