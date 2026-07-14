// src/queues/backupQueue.js — Complete with duplicate prevention

const crypto = require('crypto');
const moment = require('moment-timezone');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const ReminderLog = require('../models/ReminderLog');
const { sendReminderEmail } = require('../services/emailService');

// ============ PROCESS REMINDER ============
const processReminder = async (job) => {
  const { appointmentId, reminderType } = job.data;
  console.log(`📧 [WORKER] Processing: ${appointmentId} - ${reminderType}`);
  
  try {
    // ✅ CRITICAL: Check if already sent BEFORE processing
    const existing = await Appointment.findById(appointmentId);
    const sentField = `reminder${reminderType}Sent`;
    
    if (!existing) {
      throw new Error('Appointment not found');
    }
    
    // ✅ Skip if already sent
    if (existing[sentField]) {
      console.log(`⏭️ ${reminderType} already sent, skipping duplicate`);
      return { success: true, skipped: true };
    }
    
    // ✅ Check if currently processing (prevent concurrent)
    const processingField = `reminder${reminderType}Processing`;
    if (existing[processingField]) {
      console.log(`⏭️ ${reminderType} already processing, skipping duplicate`);
      return { success: true, skipped: true };
    }
    
    // ✅ Update: Processing
    await Appointment.findByIdAndUpdate(appointmentId, {
      [processingField]: true,
    });
    
    // Get appointment with populated fields
    const appointment = await Appointment.findById(appointmentId)
      .populate('patientId')
      .populate('doctorId')
      .lean();
    
    if (!appointment) {
      throw new Error('Appointment not found');
    }
    
    console.log(`📋 Appointment: ${appointment._id}`);
    console.log(`  - Patient: ${appointment.patientId?.email}`);
    console.log(`  - Doctor: ${appointment.doctorId?.name}`);
    console.log(`  - Date: ${appointment.appointmentDate}`);
    console.log(`  - Time: ${appointment.appointmentTime}`);
    
    // Check if cancelled
    if (appointment.confirmationStatus === 'cancelled') {
      console.log(`⏭️ Appointment cancelled, skipping`);
      await Appointment.findByIdAndUpdate(appointmentId, {
        [processingField]: false,
        [`reminder${reminderType}Cancelled`]: true,
      });
      return { success: true, skipped: true };
    }
    
    // ✅ Double-check: Already sent (race condition)
    if (appointment[sentField]) {
      console.log(`⏭️ Already sent (double-check), skipping`);
      await Appointment.findByIdAndUpdate(appointmentId, {
        [processingField]: false,
      });
      return { success: true, skipped: true };
    }
    
    // 2h logic
    if (reminderType === '2h') {
      if (appointment.reminder24hCancelled || appointment.confirmationStatus === 'confirmed') {
        console.log(`⏭️ Skipping 2h (cancelled or confirmed)`);
        await Appointment.findByIdAndUpdate(appointmentId, {
          [processingField]: false,
          [`reminder${reminderType}Cancelled`]: true,
        });
        return { success: true, skipped: true };
      }
    }
    
    // 30min logic
    if (reminderType === '30min') {
      if (appointment.reminder24hCancelled || appointment.reminder2hCancelled) {
        console.log(`⏭️ Skipping 30min (cancelled)`);
        await Appointment.findByIdAndUpdate(appointmentId, {
          [processingField]: false,
          [`reminder${reminderType}Cancelled`]: true,
        });
        return { success: true, skipped: true };
      }
    }
    
    // Get clinic
    const clinic = await User.findById(appointment.userId);
    if (!clinic) {
      throw new Error('Clinic not found');
    }
    
    if (!clinic.smtpHost || !clinic.fromEmail || !clinic.emailPassword) {
      throw new Error('Email not configured for this clinic');
    }
    
    // Generate tracking token
    const trackingToken = crypto.randomBytes(32).toString('hex');
    
    // Create log
    const log = await ReminderLog.create({
      userId: appointment.userId,
      appointmentId: appointment._id,
      patientId: appointment.patientId._id,
      doctorId: appointment.doctorId._id,
      reminderType: reminderType,
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
    
    // Prepare email
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
    
    let reminderLabel = '';
    let urgency = '';
    
    if (reminderType === '24h') {
      reminderLabel = '24-Hour Reminder';
      urgency = 'low';
    } else if (reminderType === '2h') {
      reminderLabel = '2-Hour Reminder';
      urgency = 'medium';
    } else if (reminderType === '30min') {
      reminderLabel = '⚠️ Urgent: 30-Minute Reminder';
      urgency = 'high';
    }
    
    console.log(`📧 Sending ${reminderLabel} to ${appointment.patientId.email}`);
    
    const result = await sendReminderEmail(
      appointment.userId,
      appointment.patientId.email,
      appointment.patientId.name,
      clinic.clinicName || 'Clinic',
      appointment.appointmentDate,
      appointment.appointmentTime,
      appointment.doctorId.name,
      `${baseUrl}/confirm/${appointment.confirmationToken}?tracking=${trackingToken}`,
      `${baseUrl}/cancel/${appointment.cancellationToken}?tracking=${trackingToken}`,
      log._id,
      `${backendUrl}/api/tracking/pixel/${trackingToken}`,
      reminderLabel,
      urgency,
    );
    
    if (result.success) {
      // ✅ Update appointment: Sent
      await Appointment.findByIdAndUpdate(appointmentId, {
        [sentField]: true,
        [`reminder${reminderType}SentAt`]: new Date(),
        [processingField]: false,
        [`reminder${reminderType}Queued`]: false,
        [`reminder${reminderType}LogId`]: log._id,
        lastReminderAttempt: new Date(),
      });
      
      // ✅ Update log
      log.status.current = 'sent';
      log.status.isPending = false;
      log.status.isSent = true;
      log.status.isDelivered = true;
      log.status.isFailed = false;
      log.sentAt = new Date();
      log.errorMessage = null;
      await log.save();
      
      console.log(`✅ ${reminderType} sent successfully for ${appointmentId}`);
      return { success: true };
    } else {
      throw new Error(result.error || 'Email send failed');
    }
    
  } catch (error) {
    console.error(`❌ Job failed:`, error.message);
    
    // Update appointment: Failed
    await Appointment.findByIdAndUpdate(appointmentId, {
      [`reminder${reminderType}Processing`]: false,
      [`reminder${reminderType}Failed`]: true,
      [`reminder${reminderType}Error`]: error.message,
    });
    
    // Update log: Failed
    try {
      const log = await ReminderLog.findOne({
        appointmentId: appointmentId,
        reminderType: reminderType,
      });
      
      if (log) {
        log.status.current = 'failed';
        log.status.isPending = false;
        log.status.isSent = false;
        log.status.isDelivered = false;
        log.status.isFailed = true;
        log.errorMessage = error.message;
        await log.save();
      }
    } catch (err) {
      console.error('❌ Failed to update log:', err.message);
    }
    
    throw error;
  }
};

// ============ RECOVERY ============
const recoverMissedJobs = async () => {
  console.log('🔄 Recovery check...');
  
  try {
    const now = moment();
    const today = now.format('YYYY-MM-DD');
    const tomorrow = now.clone().add(1, 'day').format('YYYY-MM-DD');
    
    console.log(`📅 Today: ${today}, Tomorrow: ${tomorrow}`);
    console.log(`🕐 Current Time: ${now.format('HH:mm:ss')}`);
    
    const appointments = await Appointment.find({
      status: { $in: ['scheduled', 'confirmed'] },
      confirmationStatus: { $in: ['pending', 'no_response'] },
      appointmentDate: { $in: [today, tomorrow] },
      $or: [
        {
          reminder24hSent: false,
          $or: [
            { reminder24hQueued: { $ne: true } },
            { reminder24hProcessing: true, reminder24hQueuedAt: { $lt: new Date(Date.now() - 600000) } },
            { reminder24hFailed: true },
          ]
        },
        {
          reminder2hSent: false,
          $or: [
            { reminder2hQueued: { $ne: true } },
            { reminder2hProcessing: true, reminder2hQueuedAt: { $lt: new Date(Date.now() - 600000) } },
            { reminder2hFailed: true },
          ]
        },
        {
          reminder30minSent: false,
          $or: [
            { reminder30minQueued: { $ne: true } },
            { reminder30minProcessing: true, reminder30minQueuedAt: { $lt: new Date(Date.now() - 600000) } },
            { reminder30minFailed: true },
          ]
        },
      ],
    });
    
    console.log(`📋 Found ${appointments.length} appointments needing recovery`);
    
    for (const apt of appointments) {
      console.log(`\n🔍 Checking appointment ${apt._id}:`);
      console.log(`  - Date: ${apt.appointmentDate}`);
      console.log(`  - Time: ${apt.appointmentTime}`);
      
      const timezone = apt.timezone || 'Asia/Karachi';
      const aptTime = moment.tz(
        `${apt.appointmentDate} ${apt.appointmentTime}`,
        'YYYY-MM-DD HH:mm',
        timezone
      );
      
      const diffHours = aptTime.diff(now, 'hours', true);
      console.log(`  - Diff Hours: ${diffHours.toFixed(2)}`);
      console.log(`  - 24h Sent: ${apt.reminder24hSent}`);
      console.log(`  - 2h Sent: ${apt.reminder2hSent}`);
      console.log(`  - 30min Sent: ${apt.reminder30minSent}`);
      
      // ✅ Skip if all sent
      if (apt.reminder24hSent && apt.reminder2hSent && apt.reminder30minSent) {
        console.log(`⏭️ All reminders sent, skipping`);
        continue;
      }
      
      // ✅ Check if already sent before processing
      const fakeJob = (type) => ({
        id: `recovery-${Date.now()}-${Math.random()}`,
        data: { appointmentId: apt._id, reminderType: type }
      });
      
      if (diffHours <= 24.5 && diffHours > 0 && !apt.reminder24hSent) {
        console.log(`🔁 Processing 24h for ${apt._id}`);
        try {
          await processReminder(fakeJob('24h'));
          console.log(`✅ 24h processed`);
        } catch (err) {
          console.error(`❌ 24h failed:`, err.message);
        }
      }
      
      if (diffHours <= 2.5 && diffHours > 0 && !apt.reminder2hSent) {
        console.log(`🔁 Processing 2h for ${apt._id}`);
        try {
          await processReminder(fakeJob('2h'));
          console.log(`✅ 2h processed`);
        } catch (err) {
          console.error(`❌ 2h failed:`, err.message);
        }
      }
      
      if (diffHours <= 0.5 && diffHours > 0 && !apt.reminder30minSent) {
        console.log(`🔁 Processing 30min for ${apt._id}`);
        try {
          await processReminder(fakeJob('30min'));
          console.log(`✅ 30min processed`);
        } catch (err) {
          console.error(`❌ 30min failed:`, err.message);
        }
      }
    }
    
    console.log('✅ Recovery check completed');
  } catch (error) {
    console.error('❌ Recovery error:', error);
  }
};

// ============ SCHEDULE NEW APPOINTMENTS ============
const scheduleNewAppointments = async () => {
  console.log('🔄 Scheduling new appointments...');
  
  try {
    const appointments = await Appointment.find({
      status: 'scheduled',
      confirmationStatus: 'pending',
      reminderScheduled: { $ne: true },
    }).limit(50);
    
    if (appointments.length === 0) {
      console.log('✅ No new appointments to schedule');
      return;
    }
    
    console.log(`📋 Found ${appointments.length} new appointments`);
    
    for (const apt of appointments) {
      const timezone = apt.timezone || 'Asia/Karachi';
      const aptTime = moment.tz(
        `${apt.appointmentDate} ${apt.appointmentTime}`,
        'YYYY-MM-DD HH:mm',
        timezone
      );
      
      const now = moment().tz(timezone);
      
      const delays = {
        '24h': aptTime.clone().subtract(24, 'hours').diff(now),
        '2h': aptTime.clone().subtract(2, 'hours').diff(now),
        '30min': aptTime.clone().subtract(30, 'minutes').diff(now),
      };
      
      for (const [type, delay] of Object.entries(delays)) {
        if (delay > 0) {
          const minutes = Math.round(delay / 60000);
          console.log(`⏰ Scheduling ${type} for ${apt._id} in ${minutes} minutes`);
          
          // ✅ Schedule with setTimeout
          setTimeout(async () => {
            // ✅ Check if already sent before sending
            const checkApt = await Appointment.findById(apt._id);
            if (checkApt && checkApt[`reminder${type}Sent`]) {
              console.log(`⏭️ ${type} already sent, skipping scheduled job`);
              return;
            }
            
            console.log(`📧 Sending ${type} for ${apt._id}`);
            const fakeJob = {
              id: `scheduled-${Date.now()}-${Math.random()}`,
              data: { appointmentId: apt._id, reminderType: type }
            };
            try {
              await processReminder(fakeJob);
              console.log(`✅ ${type} sent`);
            } catch (err) {
              console.error(`❌ ${type} failed:`, err.message);
            }
          }, delay);
        }
      }
      
      await Appointment.findByIdAndUpdate(apt._id, {
        reminderScheduled: true,
      });
    }
  } catch (error) {
    console.error('❌ Schedule error:', error);
  }
};

// ============ STARTUP: Run Recovery Once ============
// ✅ Only ONE startup recovery
setTimeout(() => {
  console.log('🚀 Running startup recovery...');
  recoverMissedJobs();
}, 3000);

// ============ CRON JOBS ============
const cron = require('node-cron');
cron.schedule('*/2 * * * *', scheduleNewAppointments);
cron.schedule('*/5 * * * *', recoverMissedJobs);

console.log('✅ Cron jobs scheduled:');
console.log('  - Schedule: Every 2 minutes');
console.log('  - Recovery: Every 5 minutes');

// ============ EXPORTS ============
module.exports = {
  recoverMissedJobs,
  scheduleNewAppointments,
  processReminder,
};

console.log('✅ backupQueue.js loaded (No duplicates)');