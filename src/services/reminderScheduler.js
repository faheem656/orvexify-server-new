// src/services/reminderScheduler.js

const agenda = require('./agendaService');
const moment = require('moment-timezone');

const scheduleAppointmentReminders = async (appointment) => {
  const timezone = appointment.timezone || 'Asia/Karachi';
  const aptTime = moment.tz(
    `${appointment.appointmentDate} ${appointment.appointmentTime}`,
    'YYYY-MM-DD HH:mm',
    timezone
  );
  
  const now = moment().tz(timezone);
  
  // ✅ 24h reminder — Exact time
  const time24h = aptTime.clone().subtract(24, 'hours');
  if (time24h.isAfter(now)) {
    await agenda.schedule(time24h.toDate(), 'send-24h-reminder', {
      appointmentId: appointment._id
    });
    console.log(`✅ Scheduled 24h for ${appointment._id} at ${time24h.format()}`);
  }
  
  // ✅ 2h reminder — Exact time
  const time2h = aptTime.clone().subtract(2, 'hours');
  if (time2h.isAfter(now)) {
    await agenda.schedule(time2h.toDate(), 'send-2h-reminder', {
      appointmentId: appointment._id
    });
    console.log(`✅ Scheduled 2h for ${appointment._id} at ${time2h.format()}`);
  }
  
  // ✅ 30min reminder — Exact time
  const time30min = aptTime.clone().subtract(30, 'minutes');
  if (time30min.isAfter(now)) {
    await agenda.schedule(time30min.toDate(), 'send-30min-reminder', {
      appointmentId: appointment._id
    });
    console.log(`✅ Scheduled 30min for ${appointment._id} at ${time30min.format()}`);
  }
};

module.exports = { scheduleAppointmentReminders };