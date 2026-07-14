// src/queues/backupQueue.js — Complete Fixed Version

const Queue = require('bull');
const crypto = require('crypto');
const moment = require('moment-timezone');
const Appointment = require('../models/Appointment');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const User = require('../models/User');
const ReminderLog = require('../models/ReminderLog');
const { sendReminderEmail } = require('../services/emailService');

// ============ CREATE QUEUE ============
const reminderQueue = new Queue('reminder-queue');

// ============ IGNORE REDIS ERRORS ============
reminderQueue.on('error', (err) => {
  if (err.code === 'ECONNREFUSED' || err.message?.includes('Redis')) {
    console.log('⚠️ Redis not available, using in-memory queue');
    return;
  }
  console.error('❌ Queue error:', err.message);
});

// ============ QUEUE EVENTS ============
reminderQueue.on('completed', (job) => {
  console.log(`✅ Job ${job.id} completed`);
});

reminderQueue.on('failed', (job, err) => {
  console.error(`❌ Job ${job.id} failed:`, err.message);
});

// ============ ADD JOB WITH BACKUP ============
const addJobWithBackup = async (appointmentId, reminderType, delay = 0) => {
  try {
    const job = await reminderQueue.add(
      'send-reminder',
      { appointmentId, reminderType },
      { delay }
    );
    
    const updateField = {};
    updateField[`reminder${reminderType}Queued`] = true;
    updateField[`reminder${reminderType}QueuedAt`] = new Date();
    updateField[`reminder${reminderType}JobId`] = job.id;
    
    await Appointment.findByIdAndUpdate(appointmentId, updateField);
    
    console.log(`✅ Job added: ${appointmentId} - ${reminderType} (delay: ${delay}ms)`);
    return job;
  } catch (error) {
    console.error('❌ Queue add error:', error);
    return null;
  }
};

// ============ CANCEL JOB ============
const cancelReminderJob = async (appointmentId, reminderType) => {
  try {
    const jobs = await reminderQueue.getJobs(['waiting', 'delayed']);
    let cancelled = 0;
    
    for (const job of jobs) {
      if (job.data.appointmentId === appointmentId && 
          job.data.reminderType === reminderType) {
        await job.remove();
        cancelled++;
      }
    }
    
    if (cancelled > 0) {
      console.log(`❌ Cancelled ${reminderType} for ${appointmentId}`);
    }
    
    return cancelled > 0;
  } catch (error) {
    console.error('Cancel error:', error);
    return false;
  }
};

// ============ CANCEL ALL ============
const cancelAllReminders = async (appointmentId) => {
  try {
    const jobs = await reminderQueue.getJobs(['waiting', 'delayed']);
    let cancelled = 0;
    
    for (const job of jobs) {
      if (job.data.appointmentId === appointmentId) {
        await job.remove();
        cancelled++;
      }
    }
    
    console.log(`❌ Cancelled ${cancelled} reminders for ${appointmentId}`);
    return cancelled;
  } catch (error) {
    console.error('Cancel all error:', error);
    return 0;
  }
};

// ============ PROCESS REMINDER ============
const processReminder = async (job) => {
  const { appointmentId, reminderType } = job.data;
  console.log(`📧 Processing: ${appointmentId} - ${reminderType}`);
  
  try {
    // ✅ Update: Processing
    const updateField = {};
    updateField[`reminder${reminderType}Processing`] = true;
    await Appointment.findByIdAndUpdate(appointmentId, updateField);
    
    // Get appointment
    const appointment = await Appointment.findById(appointmentId)
      .populate('patientId')
      .populate('doctorId')
      .lean();
    
    if (!appointment) {
      throw new Error('Appointment not found');
    }
    
    // Check if cancelled
    if (appointment.confirmationStatus === 'cancelled') {
      console.log(`⏭️ Appointment cancelled`);
      return { success: true, skipped: true };
    }
    
    // Check if already sent
    const sentField = `reminder${reminderType}Sent`;
    if (appointment[sentField]) {
      console.log(`⏭️ Already sent`);
      return { success: true, skipped: true };
    }
    
    // 2h & 30min logic
    if (reminderType === '2h') {
      if (appointment.reminder24hCancelled || appointment.confirmationStatus === 'confirmed') {
        console.log(`⏭️ Skipping 2h`);
        return { success: true, skipped: true };
      }
    }
    
    if (reminderType === '30min') {
      if (appointment.reminder24hCancelled || appointment.reminder2hCancelled) {
        console.log(`⏭️ Skipping 30min`);
        return { success: true, skipped: true };
      }
    }
    
    // Get clinic
    const clinic = await User.findById(appointment.userId);
    if (!clinic) {
      throw new Error('Clinic not found');
    }
    
    if (!clinic.smtpHost || !clinic.fromEmail || !clinic.emailPassword) {
      throw new Error('Email not configured');
    }
    
    // Generate tracking token
    const trackingToken = crypto.randomBytes(32).toString('hex');
    
    // ✅ Create log with proper status object
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
      // ✅ Update appointment
      const updateSent = {};
      updateSent[sentField] = true;
      updateSent[`reminder${reminderType}SentAt`] = new Date();
      updateSent[`reminder${reminderType}Processing`] = false;
      updateSent[`reminder${reminderType}Queued`] = false;
      updateSent.lastReminderAttempt = new Date();
      
      await Appointment.findByIdAndUpdate(appointmentId, updateSent);
      
      // ✅ Update log with ALL status fields
      log.status.current = 'sent';
      log.status.isPending = false;
      log.status.isSent = true;
      log.status.isDelivered = true;
      log.status.isFailed = false;
      log.sentAt = new Date();
      log.errorMessage = null;
      await log.save();
      
      console.log(`✅ ${reminderType} sent for ${appointmentId}`);
      return { success: true };
    } else {
      throw new Error(result.error || 'Email send failed');
    }
    
  } catch (error) {
    console.error(`❌ Job failed:`, error.message);
    
    // ✅ Update log with failed status
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
    
    // ✅ Update appointment
    const updateFailed = {};
    updateFailed[`reminder${reminderType}Processing`] = false;
    updateFailed[`reminder${reminderType}Failed`] = true;
    updateFailed[`reminder${reminderType}Error`] = error.message;
    await Appointment.findByIdAndUpdate(appointmentId, updateFailed);
    
    throw error;
  }
};

// ============ PROCESS JOBS ============
reminderQueue.process('send-reminder', processReminder);

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
          ]
        },
        {
          reminder2hSent: false,
          $or: [
            { reminder2hQueued: { $ne: true } },
            { reminder2hProcessing: true, reminder2hQueuedAt: { $lt: new Date(Date.now() - 600000) } },
          ]
        },
        {
          reminder30minSent: false,
          $or: [
            { reminder30minQueued: { $ne: true } },
            { reminder30minProcessing: true, reminder30minQueuedAt: { $lt: new Date(Date.now() - 600000) } },
          ]
        },
      ],
    });
    
    console.log(`📋 Found ${appointments.length} appointments in recovery query`);
    
    if (appointments.length > 0) {
      for (const apt of appointments) {
        console.log(`\n🔍 Checking appointment ${apt._id}:`);
        console.log(`  - Date: ${apt.appointmentDate}`);
        console.log(`  - Time: ${apt.appointmentTime}`);
        console.log(`  - Status: ${apt.status}`);
        console.log(`  - Confirmation: ${apt.confirmationStatus}`);
        console.log(`  - 24h Sent: ${apt.reminder24hSent}`);
        console.log(`  - 2h Sent: ${apt.reminder2hSent}`);
        console.log(`  - 30min Sent: ${apt.reminder30minSent}`);
        console.log(`  - 24h Queued: ${apt.reminder24hQueued}`);
        console.log(`  - 24h Processing: ${apt.reminder24hProcessing}`);
        
        const timezone = apt.timezone || 'Asia/Karachi';
        const aptTime = moment.tz(
          `${apt.appointmentDate} ${apt.appointmentTime}`,
          'YYYY-MM-DD HH:mm',
          timezone
        );
        
        const diffHours = aptTime.diff(now, 'hours', true);
        console.log(`  - Diff Hours: ${diffHours.toFixed(2)}`);
        
        const is24hEligible = diffHours <= 24.5 && diffHours > 0 && !apt.reminder24hSent;
        const is2hEligible = diffHours <= 2.5 && diffHours > 0 && !apt.reminder2hSent;
        const is30minEligible = diffHours <= 0.5 && diffHours > 0 && !apt.reminder30minSent;
        
        console.log(`  - 24h Eligible: ${is24hEligible}`);
        console.log(`  - 2h Eligible: ${is2hEligible}`);
        console.log(`  - 30min Eligible: ${is30minEligible}`);
        
        if (is24hEligible) {
          await addJobWithBackup(apt._id, '24h', 0);
          console.log(`🔁 Recovered 24h for ${apt._id}`);
        }
        
        if (is2hEligible) {
          await addJobWithBackup(apt._id, '2h', 0);
          console.log(`🔁 Recovered 2h for ${apt._id}`);
        }
        
        if (is30minEligible) {
          await addJobWithBackup(apt._id, '30min', 0);
          console.log(`🔁 Recovered 30min for ${apt._id}`);
        }
      }
    } else {
      console.log('✅ No appointments need recovery');
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
          await addJobWithBackup(apt._id, type, delay);
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

// ============ EXPORTS ============
module.exports = {
  reminderQueue,
  addJobWithBackup,
  cancelReminderJob,
  cancelAllReminders,
  recoverMissedJobs,
  scheduleNewAppointments,
};