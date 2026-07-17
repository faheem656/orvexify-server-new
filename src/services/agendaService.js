// src/services/agendaService.js — Complete Production Ready

const Agenda = require('agenda');
const Appointment = require('../models/Appointment');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const ReminderLog = require('../models/ReminderLog');
const { sendReminderEmail } = require('./emailService');
const crypto = require('crypto');

// ✅ Check MONGODB_URI
if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined!');
  process.exit(1);
}

console.log('📋 Agenda initializing...');

// ✅ Agenda instance
const agenda = new Agenda({
  db: {
    address: process.env.MONGODB_URI,
    collection: 'agendaJobs'
  },
  processEvery: '5 seconds',
  defaultConcurrency: 5,
  maxConcurrency: 10,
  defaultLockLimit: 1,
  defaultLockLifetime: 10000,
});

// ============ AGENDA EVENTS ============

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

// ============ FORCE WORKER TO STAY ACTIVE ============

// ✅ Force process jobs every 5 seconds
setInterval(async () => {
  try {
    await agenda._processJobs();
  } catch (error) {
    // Silent fail
  }
}, 5000);


// ✅ Startup Recovery — Force process pending jobs on startup
setTimeout(async () => {
  console.log('🔄 [STARTUP] Running startup recovery...');
  try {
    // ✅ Find all pending jobs
    const jobs = await agenda.jobs({
      nextRunAt: { $lte: new Date() }
    });
    
    if (jobs.length > 0) {
      console.log(`📋 [STARTUP] Found ${jobs.length} missed jobs, processing...`);
      await agenda._processJobs();
      console.log('✅ [STARTUP] Startup recovery completed');
    } else {
      console.log('✅ [STARTUP] No missed jobs found');
    }
  } catch (error) {
    console.error('❌ [STARTUP] Startup recovery failed:', error.message);
  }
}, 5000); // 5 seconds after server starts


// ============ GENERATE TRACKING TOKEN ============
const generateTrackingToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// ============ SEND REMINDER ============
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
    
    // ✅ Check if already sent
    const sentField = `reminder${reminderType}Sent`;
    if (appointment[sentField]) {
      console.log(`⏭️ ${reminderType} already sent for ${appointmentId}`);
      return { success: false, skipped: true };
    }
    
    // ✅ Check status
    if (appointment.confirmationStatus === 'cancelled') {
      console.log(`⏭️ Appointment cancelled, skipping`);
      return { success: false, skipped: true };
    }
    
    // ✅ Check if confirmed and reminder is 2h/30min
    if (appointment.confirmationStatus === 'confirmed') {
      if (reminderType === '24h' || reminderType === '2h') {
        console.log(`⏭️ Already confirmed, skipping ${reminderType}`);
        return { success: false, skipped: true };
      }
    }
    
    // ✅ Get clinic
    const clinic = await User.findById(appointment.userId);
    if (!clinic) {
      console.log(`❌ Clinic not found for ${appointment.userId}`);
      return { success: false, error: 'Clinic not found' };
    }
    
    // ✅ Check email config
    if (!clinic.smtpHost || !clinic.fromEmail || !clinic.emailPassword) {
      console.log(`❌ Email not configured for clinic ${clinic._id}`);
      return { success: false, error: 'Email not configured' };
    }
    
    // ✅ Generate tracking token
    const trackingToken = generateTrackingToken();
    
    // ✅ Create log
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
    
    // ✅ Send email
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
      const updateField = {};
      updateField[sentField] = true;
      updateField[`reminder${reminderType}SentAt`] = new Date();
      updateField[`reminder${reminderType}LogId`] = log._id;
      updateField.lastReminderAttempt = new Date();
      await Appointment.findByIdAndUpdate(appointmentId, updateField);
      
      // ✅ Update log
      log.status.current = 'sent';
      log.status.isSent = true;
      log.status.isDelivered = true;
      log.status.isPending = false;
      log.sentAt = new Date();
      await log.save();
      
      console.log(`✅ ${reminderType} reminder sent for ${appointmentId}`);
      return { success: true };
    } else {
      // ✅ Update log: Failed
      log.status.current = 'failed';
      log.status.isFailed = true;
      log.status.isPending = false;
      log.errorMessage = result.error || 'Email send failed';
      await log.save();
      
      throw new Error(result.error || 'Email send failed');
    }
    
  } catch (error) {
    console.error(`❌ ${reminderType} reminder failed:`, error.message);
    return { success: false, error: error.message };
  }
};

// ============ AGENDA JOBS ============

agenda.define('send-24h-reminder', async (job) => {
  const { appointmentId } = job.attrs.data;
  await sendReminder(appointmentId, '24h');
});

agenda.define('send-2h-reminder', async (job) => {
  const { appointmentId } = job.attrs.data;
  await sendReminder(appointmentId, '2h');
});

agenda.define('send-30min-reminder', async (job) => {
  const { appointmentId } = job.attrs.data;
  await sendReminder(appointmentId, '30min');
});

// ============ START AGENDA ============

agenda.start()
  .then(() => {
    console.log('✅ Agenda started successfully');
  })
  .catch((error) => {
    console.error('❌ Agenda start failed:', error);
  });

// ============ EXPORTS ============
module.exports = {
  agenda,
  sendReminder,
};