// src/scheduler/reminderScheduler.js — COMPLETE FIXED VERSION

const cron = require("node-cron");
const moment = require("moment-timezone");
const Appointment = require("../models/Appointment");
const Patient = require("../models/Patient");
const Doctor = require("../models/Doctor");
const User = require("../models/User");
const ReminderLog = require("../models/ReminderLog");
const { sendReminderEmail } = require("../services/emailService");

// ============ GENERATE TRACKING TOKEN ============
const generateTrackingToken = () => {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
};

// ============ CONVERT 12-HOUR TIME TO 24-HOUR ============
const convertTo24Hour = (timeStr) => {
  if (!timeStr) return "00:00";

  if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(timeStr)) {
    return timeStr;
  }

  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return timeStr;

  let [_, hours, minutes, modifier] = match;
  hours = parseInt(hours);
  minutes = parseInt(minutes);

  if (modifier.toUpperCase() === "PM" && hours !== 12) {
    hours += 12;
  } else if (modifier.toUpperCase() === "AM" && hours === 12) {
    hours = 0;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

// ============ CHECK IF REMINDER SHOULD BE SENT ============
const shouldSendReminder = (
  appointmentDate,
  appointmentTime,
  reminderType,
  timezone,
) => {
  try {
    const now = moment().tz(timezone);
    const time24 = convertTo24Hour(appointmentTime);

    const appointmentMoment = moment.tz(
      `${appointmentDate} ${time24}`,
      "YYYY-MM-DD HH:mm",
      timezone,
    );

    const diffMinutes = appointmentMoment.diff(now, "minutes", true);
    const diffHours = diffMinutes / 60;

    if (reminderType === "24h") {
      return diffHours <= 24.5 && diffHours > 0;
    } else if (reminderType === "2h") {
      return diffHours <= 2.5 && diffHours > 0;
    } else if (reminderType === "30min") {
      return diffMinutes <= 30 && diffMinutes > 0;
    }

    return false;
  } catch (error) {
    console.error(`❌ Error checking reminder timing:`, error);
    return false;
  }
};

// ============ CHECK IF APPOINTMENT IS ELIGIBLE FOR REMINDER ============
const isAppointmentEligible = (appointment, reminderType) => {
  // ❌ If cancelled, never send any reminder
  if (appointment.confirmationStatus === "cancelled") {
    console.log(`  ❌ Appointment is cancelled, not eligible for any reminder`);
    return false;
  }

  // ✅ If confirmed, only send 30-minute reminder
  if (appointment.confirmationStatus === "confirmed") {
    console.log(`  ✅ Appointment is confirmed, only 30min reminder allowed`);
    return reminderType === "30min";
  }

  // ✅ For pending and no_response, allow based on previous cancellations
  const eligibleStatuses = ["pending", "no_response"];
  if (!eligibleStatuses.includes(appointment.confirmationStatus)) {
    console.log(`  ❌ Not eligible: status is ${appointment.confirmationStatus}`);
    return false;
  }

  // ✅ Check if previous reminders were cancelled
  if (reminderType === "2h") {
    if (appointment.reminder24hCancelled === true) {
      console.log(`  ❌ 24h reminder was cancelled, skipping 2h reminder`);
      return false;
    }
    console.log(`  ✅ 2h reminder: 24h was not cancelled, eligible`);
    return true;
  }

  if (reminderType === "30min") {
    if (appointment.reminder24hCancelled === true || appointment.reminder2hCancelled === true) {
      console.log(`  ❌ 24h or 2h reminder was cancelled, skipping 30min reminder`);
      return false;
    }
    console.log(`  ✅ 30min reminder: 24h and 2h not cancelled, eligible`);
    return true;
  }

  console.log(`  ✅ 24h reminder: Eligible`);
  return true;
};

// ============ PROCESS PENDING REMINDERS ============
const processPendingReminders = async () => {
  console.log("🔄 Processing pending reminders...");

  try {
    // ✅ FIXED: Using new status object
    const pendingLogs = await ReminderLog.find({
      $or: [
        { 'status.current': 'pending' },
        { 'status.current': 'failed' }
      ],
      retryCount: { $lt: 3 },
      sentAt: { $exists: true },
    }).sort({ sentAt: 1 });

    console.log(`📋 Found ${pendingLogs.length} pending reminders to process`);

    for (const log of pendingLogs) {
      try {
        const appointment = await Appointment.findById(log.appointmentId);
        if (!appointment) {
          console.log(`❌ Appointment not found for log ${log._id}, marking as failed`);
          log.status.current = 'failed';
          log.errorMessage = "Appointment not found";
          await log.save();
          continue;
        }

        if (appointment.confirmationStatus === "confirmed" || 
            appointment.confirmationStatus === "cancelled") {
          console.log(`⏭️ Appointment ${appointment._id} already ${appointment.confirmationStatus}, skipping`);
          log.status.current = 'skipped';
          log.errorMessage = `Appointment already ${appointment.confirmationStatus}`;
          await log.save();
          continue;
        }

        const [patient, doctor, clinic] = await Promise.all([
          Patient.findById(appointment.patientId),
          Doctor.findById(appointment.doctorId),
          User.findById(appointment.userId),
        ]);

        if (!patient || !doctor || !clinic) {
          console.log(`❌ Missing data for log ${log._id}`);
          log.status.current = 'failed';
          log.errorMessage = "Missing patient, doctor, or clinic";
          log.retryCount = (log.retryCount || 0) + 1;
          log.lastRetryAt = new Date();
          await log.save();
          continue;
        }

        if (!clinic.smtpHost || !clinic.fromEmail || !clinic.emailPassword) {
          console.log(`❌ Clinic ${clinic._id} has no email configured`);
          log.status.current = 'failed';
          log.errorMessage = "Email not configured";
          log.retryCount = (log.retryCount || 0) + 1;
          log.lastRetryAt = new Date();
          await log.save();
          continue;
        }

        if (!log.trackingToken) {
          log.trackingToken = generateTrackingToken();
        }

        const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
        const trackingToken = log.trackingToken;
        const confirmLink = `${baseUrl}/confirm/${appointment.confirmationToken}?tracking=${trackingToken}&action=confirm`;
        const cancelLink = `${baseUrl}/cancel/${appointment.cancellationToken}?tracking=${trackingToken}&action=cancel`;
        const trackingPixel = `${process.env.BACKEND_URL || "http://localhost:5000"}/api/tracking/pixel/${trackingToken}`;

        let reminderLabelText = "";
        let urgencyLevel = "";

        if (log.reminderType === "24h") {
          reminderLabelText = "24-Hour Reminder";
          urgencyLevel = "low";
        } else if (log.reminderType === "2h") {
          reminderLabelText = "2-Hour Reminder";
          urgencyLevel = "medium";
        } else if (log.reminderType === "30min") {
          reminderLabelText = "⚠️ Urgent: 30-Minute Reminder";
          urgencyLevel = "high";
        }

        const result = await sendReminderEmail(
          clinic._id,
          patient.email,
          patient.name,
          clinic.clinicName || "Clinic",
          appointment.appointmentDate,
          appointment.appointmentTime,
          doctor.name,
          confirmLink,
          cancelLink,
          log._id,
          trackingPixel,
          reminderLabelText,
          urgencyLevel,
        );

        if (result.success) {
          log.status.current = 'delivered';
          log.sentAt = new Date();
          log.retryCount = 0;
          log.errorMessage = null;
          await log.save();
          console.log(`✅ Pending reminder sent successfully for log ${log._id}`);

          if (log.reminderType === "24h" && !appointment.reminder24hSent) {
            appointment.reminder24hSent = true;
            appointment.reminder24hLogId = log._id;
          } else if (log.reminderType === "2h" && !appointment.reminder2hSent) {
            appointment.reminder2hSent = true;
            appointment.reminder2hLogId = log._id;
          } else if (log.reminderType === "30min" && !appointment.reminder30minSent) {
            appointment.reminder30minSent = true;
            appointment.reminder30minLogId = log._id;
          }
          appointment.lastReminderAttempt = new Date();
          await appointment.save();
        } else {
          log.retryCount = (log.retryCount || 0) + 1;
          log.lastRetryAt = new Date();
          log.errorMessage = result.error || "Unknown error";

          if (log.retryCount >= 3) {
            log.status.current = 'failed';
            console.log(`❌ Pending reminder failed after 3 retries for log ${log._id}`);
          } else {
            console.log(`🔄 Pending reminder retry ${log.retryCount}/3 for log ${log._id}`);
          }
          await log.save();
        }
      } catch (error) {
        console.error(`❌ Error processing pending log ${log._id}:`, error);
        log.retryCount = (log.retryCount || 0) + 1;
        log.lastRetryAt = new Date();
        log.errorMessage = error.message || "Unknown error";
        if (log.retryCount >= 3) {
          log.status.current = 'failed';
        }
        await log.save();
      }
    }

    console.log(`✅ Pending reminders processing completed`);
  } catch (error) {
    console.error("❌ Error in processPendingReminders:", error);
  }
};

// ============ PROCESS REMINDER ============
const processReminder = async (apt, reminderType) => {
  try {
    const reminderLabel = reminderType === "30min" ? "30-minute" : reminderType;
    console.log(`\n📧 Processing ${reminderLabel} reminder for appointment ${apt._id}`);

    if (!isAppointmentEligible(apt, reminderType)) {
      console.log(`⏭️ Skipping ${reminderLabel} reminder: Not eligible`);
      return { success: false, error: `Not eligible`, skipped: true };
    }

    if (apt.reminderRetryCount >= 3) {
      console.log(`⏭️ Skipping ${reminderLabel} reminder: Max retries reached`);
      return { success: false, error: "Max retries reached", skipped: true };
    }

    const [patient, doctor, clinic] = await Promise.all([
      Patient.findById(apt.patientId),
      Doctor.findById(apt.doctorId),
      User.findById(apt.userId),
    ]);

    if (!patient || !doctor || !clinic) {
      console.log(`❌ Skipping appointment ${apt._id}: Missing data`);
      return { success: false, error: "Missing patient, doctor, or clinic" };
    }

    if (!clinic.smtpHost || !clinic.fromEmail || !clinic.emailPassword) {
      console.log(`❌ Clinic ${clinic._id} has no email configured`);
      return { success: false, error: "Email not configured" };
    }

    if (reminderType === "24h" && apt.reminder24hSent) {
      console.log(`⏭️ 24h reminder already sent for ${apt._id}`);
      return { success: false, error: "Already sent", skipped: true };
    }
    if (reminderType === "2h" && apt.reminder2hSent) {
      console.log(`⏭️ 2h reminder already sent for ${apt._id}`);
      return { success: false, error: "Already sent", skipped: true };
    }
    if (reminderType === "30min" && apt.reminder30minSent) {
      console.log(`⏭️ 30-minute reminder already sent for ${apt._id}`);
      return { success: false, error: "Already sent", skipped: true };
    }

    const timezone = clinic.timezone || "Asia/Karachi";
    const shouldSend = shouldSendReminder(
      apt.appointmentDate,
      apt.appointmentTime,
      reminderType,
      timezone,
    );

    if (!shouldSend) {
      console.log(`⏭️ Skipping ${reminderLabel} reminder: Not in correct time window`);
      return { success: false, error: "Not in time window", skipped: true };
    }

    const trackingToken = generateTrackingToken();
    
    // ✅ FIXED: Using new status object
    const log = await ReminderLog.create({
      userId: apt.userId,
      appointmentId: apt._id,
      patientId: apt.patientId,
      doctorId: apt.doctorId,
      reminderType: reminderType,
      status: {
        current: 'pending',
        isPending: true,
        isSent: false,
        isDelivered: false,
        isFailed: false,
        isOpened: false,
        isClicked: false,
        isNoResponse: false
      },
      trackingToken: trackingToken,
      sentAt: new Date(),
      retryCount: apt.reminderRetryCount || 0,
    });

    const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const confirmLink = `${baseUrl}/confirm/${apt.confirmationToken}?tracking=${trackingToken}&action=confirm`;
    const cancelLink = `${baseUrl}/cancel/${apt.cancellationToken}?tracking=${trackingToken}&action=cancel`;
    const trackingPixel = `${process.env.BACKEND_URL || "http://localhost:5000"}/api/tracking/pixel/${trackingToken}`;

    let reminderLabelText = "";
    let urgencyLevel = "";

    if (reminderType === "24h") {
      reminderLabelText = "24-Hour Reminder";
      urgencyLevel = "low";
    } else if (reminderType === "2h") {
      reminderLabelText = "2-Hour Reminder";
      urgencyLevel = "medium";
    } else if (reminderType === "30min") {
      reminderLabelText = "⚠️ Urgent: 30-Minute Reminder";
      urgencyLevel = "high";
    }

    const result = await sendReminderEmail(
      apt.userId,
      patient.email,
      patient.name,
      clinic.clinicName || "Clinic",
      apt.appointmentDate,
      apt.appointmentTime,
      doctor.name,
      confirmLink,
      cancelLink,
      log._id,
      trackingPixel,
      reminderLabelText,
      urgencyLevel,
    );

    if (result.success) {
      if (reminderType === "24h") {
        apt.reminder24hSent = true;
        apt.reminder24hLogId = log._id;
      } else if (reminderType === "2h") {
        apt.reminder2hSent = true;
        apt.reminder2hLogId = log._id;
      } else if (reminderType === "30min") {
        apt.reminder30minSent = true;
        apt.reminder30minLogId = log._id;
      }
      apt.reminderRetryCount = 0;
      apt.lastReminderAttempt = new Date();
      await apt.save();

      log.status.current = 'delivered';
      log.sentAt = new Date();
      await log.save();

      console.log(`✅ ${reminderLabel} reminder sent to ${patient.email}`);
      return { success: true, log };
    } else {
      apt.reminderRetryCount = (apt.reminderRetryCount || 0) + 1;
      apt.lastReminderAttempt = new Date();
      await apt.save();

      log.status.current = 'failed';
      log.errorMessage = result.error || "Unknown error";
      log.retryCount = apt.reminderRetryCount;
      log.lastRetryAt = new Date();
      await log.save();

      console.log(`❌ Failed to send ${reminderLabel} reminder to ${patient.email}: ${result.error}`);
      return { success: false, error: result.error, retryCount: apt.reminderRetryCount };
    }
  } catch (error) {
    console.error(`❌ Error processing reminder:`, error);
    return { success: false, error: error.message };
  }
};

// ============ PROCESS 24H REMINDERS ============
const process24hReminders = async () => {
  console.log("\n🔄 Processing 24h reminders...");

  try {
    const clinics = await User.find({
      bookingSlug: { $exists: true, $ne: null },
    });

    for (const clinic of clinics) {
      const timezone = clinic.timezone || "Asia/Karachi";
      const now = moment().tz(timezone);
      const todayDate = now.format("YYYY-MM-DD");
      const tomorrowDate = now.clone().add(1, "day").format("YYYY-MM-DD");

      console.log(`📍 Clinic: ${clinic.clinicName} (${timezone})`);
      console.log(`📅 Today: ${todayDate}, Tomorrow: ${tomorrowDate}`);

      const appointments = await Appointment.find({
        userId: clinic._id,
        status: { $in: ["scheduled", "confirmed"] },
        confirmationStatus: { $in: ["pending", "no_response"] },
        reminder24hSent: false,
        appointmentDate: { $in: [todayDate, tomorrowDate] },
        reminderRetryCount: { $lt: 3 },
      });

      console.log(`📋 Total appointments found: ${appointments.length}`);

      const eligibleAppointments = appointments.filter((apt) => {
        return shouldSendReminder(
          apt.appointmentDate,
          apt.appointmentTime,
          "24h",
          timezone,
        );
      });

      console.log(`📋 Found ${eligibleAppointments.length} appointments for 24h reminders`);

      for (const apt of eligibleAppointments) {
        await processReminder(apt, "24h");
      }
    }
  } catch (error) {
    console.error("❌ Error in process24hReminders:", error);
  }
};

// ============ PROCESS 2H REMINDERS ============
const process2hReminders = async () => {
  console.log("\n🔄 Processing 2h reminders...");

  try {
    const clinics = await User.find({
      bookingSlug: { $exists: true, $ne: null },
    });

    for (const clinic of clinics) {
      const timezone = clinic.timezone || "Asia/Karachi";
      const now = moment().tz(timezone);
      const todayDate = now.format("YYYY-MM-DD");

      console.log(`📍 Clinic: ${clinic.clinicName} (${timezone})`);
      console.log(`📅 Today: ${todayDate}`);
      console.log(`🕐 Current Time: ${now.format("HH:mm")}`);

      const appointments = await Appointment.find({
        userId: clinic._id,
        status: { $in: ["scheduled", "confirmed"] },
        confirmationStatus: { $in: ["pending", "no_response"] },
        reminder2hSent: false,
        appointmentDate: todayDate,
        reminderRetryCount: { $lt: 3 },
        reminder24hCancelled: { $ne: true },
      });

      console.log(`📋 Total appointments found: ${appointments.length}`);

      const eligibleAppointments = appointments.filter((apt) => {
        return shouldSendReminder(
          apt.appointmentDate,
          apt.appointmentTime,
          "2h",
          timezone,
        );
      });

      console.log(`📋 Found ${eligibleAppointments.length} appointments for 2h reminders`);

      for (const apt of eligibleAppointments) {
        await processReminder(apt, "2h");
      }
    }
  } catch (error) {
    console.error("❌ Error in process2hReminders:", error);
  }
};

// ============ PROCESS 30-MINUTE REMINDERS ============
const process30minReminders = async () => {
  console.log("\n🔄 Processing 30-minute reminders...");

  try {
    const clinics = await User.find({
      bookingSlug: { $exists: true, $ne: null },
    });

    for (const clinic of clinics) {
      const timezone = clinic.timezone || "Asia/Karachi";
      const now = moment().tz(timezone);
      const todayDate = now.format("YYYY-MM-DD");

      console.log(`📍 Clinic: ${clinic.clinicName} (${timezone})`);
      console.log(`📅 Today: ${todayDate}`);
      console.log(`🕐 Current Time: ${now.format("HH:mm")}`);

      const appointments = await Appointment.find({
        userId: clinic._id,
        status: { $in: ["scheduled", "confirmed"] },
        confirmationStatus: { $in: ["pending", "no_response", "confirmed"] },
        reminder30minSent: false,
        appointmentDate: todayDate,
        reminderRetryCount: { $lt: 3 },
        reminder24hCancelled: { $ne: true },
        reminder2hCancelled: { $ne: true },
      });

      console.log(`📋 Total appointments found: ${appointments.length}`);

      const eligibleAppointments = appointments.filter((apt) => {
        return shouldSendReminder(
          apt.appointmentDate,
          apt.appointmentTime,
          "30min",
          timezone,
        );
      });

      console.log(`📋 Found ${eligibleAppointments.length} appointments for 30-minute reminders`);

      for (const apt of eligibleAppointments) {
        await processReminder(apt, "30min");
      }
    }
  } catch (error) {
    console.error("❌ Error in process30minReminders:", error);
  }
};

// ============ PROCESS NO-RESPONSE FOLLOW-UPS ============
const processNoResponseFollowups = async () => {
  console.log("\n🔄 Processing no-response follow-ups...");

  try {
    const now = moment();
    const todayDate = now.format("YYYY-MM-DD");

    const appointments = await Appointment.find({
      status: "scheduled",
      confirmationStatus: "pending",
      appointmentDate: todayDate,
    });

    console.log(`📋 Found ${appointments.length} appointments to check for no-response`);

    for (const apt of appointments) {
      // ✅ FIXED: Using new status object
      const logs = await ReminderLog.find({
        appointmentId: apt._id,
        'status.current': { $in: ["delivered", "sent"] },
      });

      if (logs.length > 0) {
        const hasInteraction = logs.some(
          (log) => log.opened === true || log.clicked === true,
        );

        if (!hasInteraction) {
          const lastLog = logs[logs.length - 1];
          const timeSinceLast = now.diff(moment(lastLog.sentAt), "minutes");

          if (timeSinceLast > 30) {
            console.log(`⏳ No response for appointment ${apt._id}, marking as no_response`);
            apt.confirmationStatus = "no_response";
            await apt.save();

            // ✅ FIXED: Update all logs for this appointment
            await ReminderLog.updateMany(
              { appointmentId: apt._id },
              { 'status.current': 'no_response' }
            );
          }
        }
      }
    }
  } catch (error) {
    console.error("❌ Error in processNoResponseFollowups:", error);
  }
};

// ============ CLEAN UP OLD LOGS ============
const cleanupOldLogs = async () => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await ReminderLog.deleteMany({
      createdAt: { $lt: thirtyDaysAgo },
    });

    if (result.deletedCount > 0) {
      console.log(`🧹 Cleaned up ${result.deletedCount} old reminder logs`);
    }
  } catch (error) {
    console.error("❌ Cleanup error:", error);
  }
};

// ============ MAIN SCHEDULER ============
const runScheduler = async () => {
  try {
    console.log(`\n🔄 Running reminder scheduler... ${new Date().toLocaleString()}`);

    await processPendingReminders();
    await process24hReminders();
    await process2hReminders();
    await process30minReminders();
    await processNoResponseFollowups();

    const hour = new Date().getHours();
    if (hour === 0) {
      await cleanupOldLogs();
    }

    console.log(`\n✅ Reminder scheduler completed at ${new Date().toLocaleString()}\n`);
  } catch (error) {
    console.error("❌ Reminder scheduler error:", error);
  }
};

// ============ START CRON JOB ============
cron.schedule("*/2 * * * *", runScheduler);

console.log("⏰ Reminder scheduler started (runs every 2 minutes)");

// ============ EXPORTS ============
module.exports = {
  runScheduler,
  processPendingReminders,
  process24hReminders,
  process2hReminders,
  process30minReminders,
  processNoResponseFollowups,
  cleanupOldLogs,
  processReminder,
  shouldSendReminder,
  isAppointmentEligible,
};