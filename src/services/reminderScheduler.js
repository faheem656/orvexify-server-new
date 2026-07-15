// src/services/reminderScheduler.js — PRODUCTION READY

const moment = require('moment-timezone');
const { agenda } = require('./agendaService');
const Appointment = require('../models/Appointment');
const User = require('../models/User');

const scheduleAppointmentReminders = async (appointment) => {
  console.log(`📋 Scheduling reminders for appointment ${appointment._id}`);
  
  try {
    // ✅ Get clinic timezone
    const clinic = await User.findById(appointment.userId);
    const timezone = clinic?.timezone || 'Asia/Karachi';
    
    console.log(`📍 Clinic timezone: ${timezone}`);
    
    // ✅ Parse appointment time
    const aptTime = moment.tz(
      `${appointment.appointmentDate} ${appointment.appointmentTime}`,
      'YYYY-MM-DD HH:mm',
      timezone
    );
    
    const now = moment().tz(timezone);
    
    console.log(`📅 Appointment time: ${aptTime.format()}`);
    console.log(`🕐 Current time: ${now.format()}`);
    
    // ✅ Schedule 24h reminder
    const time24h = aptTime.clone().subtract(24, 'hours');
    if (time24h.isAfter(now)) {
      await agenda.schedule(time24h.toDate(), 'send-24h-reminder', {
        appointmentId: appointment._id.toString()
      });
      console.log(`✅ 24h scheduled for ${time24h.format()}`);
    } else {
      console.log(`⏭️ 24h skipped (time passed)`);
    }
    
    // ✅ Schedule 2h reminder
    const time2h = aptTime.clone().subtract(2, 'hours');
    if (time2h.isAfter(now)) {
      await agenda.schedule(time2h.toDate(), 'send-2h-reminder', {
        appointmentId: appointment._id.toString()
      });
      console.log(`✅ 2h scheduled for ${time2h.format()}`);
    } else {
      console.log(`⏭️ 2h skipped (time passed)`);
    }
    
    // ✅ Schedule 30min reminder
    const time30min = aptTime.clone().subtract(30, 'minutes');
    if (time30min.isAfter(now)) {
      await agenda.schedule(time30min.toDate(), 'send-30min-reminder', {
        appointmentId: appointment._id.toString()
      });
      console.log(`✅ 30min scheduled for ${time30min.format()}`);
    } else {
      console.log(`⏭️ 30min skipped (time passed)`);
    }
    
    console.log(`✅ All reminders scheduled for ${appointment._id}`);
    return { success: true };
    
  } catch (error) {
    console.error(`❌ Schedule error for ${appointment._id}:`, error);
    return { success: false, error: error.message };
  }
};

// ============ CANCEL REMINDERS ============
const cancelReminders = async (appointmentId) => {
  try {
    console.log(`❌ Cancelling reminders for ${appointmentId}`);
    
    const jobs = await agenda.jobs({
      'data.appointmentId': appointmentId,
      nextRunAt: { $exists: true }
    });
    
    for (const job of jobs) {
      await job.remove();
      console.log(`  ❌ Cancelled job: ${job.attrs.name}`);
    }
    
    // ✅ Update appointment
    await Appointment.findByIdAndUpdate(appointmentId, {
      reminder24hCancelled: true,
      reminder2hCancelled: true,
      reminder30minCancelled: true,
    });
    
    console.log(`✅ All reminders cancelled for ${appointmentId}`);
    return { success: true };
    
  } catch (error) {
    console.error(`❌ Cancel error for ${appointmentId}:`, error);
    return { success: false, error: error.message };
  }
};

// ============ CHECK ALL JOBS ============
const checkAllJobs = async () => {
  try {
    const jobs = await agenda.jobs({
      nextRunAt: { $exists: true }
    });
    
    console.log(`📋 Total scheduled jobs: ${jobs.length}`);
    
    if (jobs.length > 0) {
      for (const job of jobs) {
        console.log(`  - ${job.attrs.name} → ${job.attrs.data.appointmentId} at ${job.attrs.nextRunAt}`);
      }
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
  checkAllJobs,
};