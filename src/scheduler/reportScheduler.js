// src/scheduler/reportScheduler.js — COMPLETE FIXED WITH TIMEZONE SUPPORT

const cron = require('node-cron');
const moment = require('moment-timezone');
const User = require('../models/User');
const Appointment = require('../models/Appointment');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const ReminderLog = require('../models/ReminderLog');
const { sendEmailFromClinic, getUserEmailSettings } = require('../services/emailService');

// ============ GENERATE DAILY REPORT ============
const generateDailyReport = async (userId, timezone) => {
  try {
    const now = moment().tz(timezone);
    const todayDate = now.format('YYYY-MM-DD');
    const tomorrowDate = now.clone().add(1, 'day').format('YYYY-MM-DD');

    const todayAppointments = await Appointment.find({
      userId: userId,
      appointmentDate: todayDate
    })
    .populate('patientId', 'name email phone')
    .populate('doctorId', 'name specialty')
    .lean();

    const tomorrowAppointments = await Appointment.find({
      userId: userId,
      appointmentDate: tomorrowDate
    })
    .populate('patientId', 'name email phone')
    .populate('doctorId', 'name specialty')
    .lean();

    const totalToday = todayAppointments.length;
    const confirmedToday = todayAppointments.filter(a => a.confirmationStatus === 'confirmed').length;
    const pendingToday = todayAppointments.filter(a => a.confirmationStatus === 'pending').length;
    const cancelledToday = todayAppointments.filter(a => a.confirmationStatus === 'cancelled').length;
    const noResponseToday = todayAppointments.filter(a => a.confirmationStatus === 'no_response').length;

    const morningSlots = todayAppointments.filter(a => {
      const time = moment(a.appointmentTime, 'h:mm A');
      return time.hour() < 12;
    });
    const afternoonSlots = todayAppointments.filter(a => {
      const time = moment(a.appointmentTime, 'h:mm A');
      return time.hour() >= 12 && time.hour() < 17;
    });
    const eveningSlots = todayAppointments.filter(a => {
      const time = moment(a.appointmentTime, 'h:mm A');
      return time.hour() >= 17;
    });

    const clinic = await User.findById(userId);
    const clinicName = clinic?.clinicName || 'Clinic';

    return {
      clinicName,
      date: todayDate,
      timezone,
      stats: {
        total: totalToday,
        confirmed: confirmedToday,
        pending: pendingToday,
        cancelled: cancelledToday,
        noResponse: noResponseToday,
        morning: morningSlots.length,
        afternoon: afternoonSlots.length,
        evening: eveningSlots.length,
        confirmationRate: totalToday > 0 ? Math.round((confirmedToday / totalToday) * 100) : 0
      },
      appointments: todayAppointments,
      tomorrowPreview: tomorrowAppointments.slice(0, 5),
      hasTomorrow: tomorrowAppointments.length > 0,
      tomorrowCount: tomorrowAppointments.length
    };
  } catch (error) {
    console.error('❌ Generate daily report error:', error);
    return null;
  }
};

// ============ GENERATE WEEKLY REPORT ============
const generateWeeklyReport = async (userId, timezone) => {
  try {
    const now = moment().tz(timezone);
    const weekStart = now.clone().startOf('week');
    const weekEnd = now.clone().endOf('week');
    
    const startDate = weekStart.format('YYYY-MM-DD');
    const endDate = weekEnd.format('YYYY-MM-DD');

    const weekAppointments = await Appointment.find({
      userId: userId,
      appointmentDate: { $gte: startDate, $lte: endDate }
    })
    .populate('patientId', 'name email phone')
    .populate('doctorId', 'name specialty')
    .lean();

    const totalWeek = weekAppointments.length;
    const confirmedWeek = weekAppointments.filter(a => a.confirmationStatus === 'confirmed').length;
    const pendingWeek = weekAppointments.filter(a => a.confirmationStatus === 'pending').length;
    const cancelledWeek = weekAppointments.filter(a => a.confirmationStatus === 'cancelled').length;
    const noResponseWeek = weekAppointments.filter(a => a.confirmationStatus === 'no_response').length;

    const dailyBreakdown = {};
    for (let i = 0; i < 7; i++) {
      const day = weekStart.clone().add(i, 'days');
      const dayStr = day.format('YYYY-MM-DD');
      const dayName = day.format('dddd');
      const dayAppointments = weekAppointments.filter(a => a.appointmentDate === dayStr);
      dailyBreakdown[dayName] = {
        date: dayStr,
        total: dayAppointments.length,
        confirmed: dayAppointments.filter(a => a.confirmationStatus === 'confirmed').length,
        pending: dayAppointments.filter(a => a.confirmationStatus === 'pending').length,
        cancelled: dayAppointments.filter(a => a.confirmationStatus === 'cancelled').length,
        noResponse: dayAppointments.filter(a => a.confirmationStatus === 'no_response').length
      };
    }

    const doctorIds = [...new Set(weekAppointments.map(a => a.doctorId))];
    const doctors = await Doctor.find({ _id: { $in: doctorIds } }).lean();
    const doctorPerformance = doctors.map(doc => {
      const docApps = weekAppointments.filter(a => a.doctorId.toString() === doc._id.toString());
      return {
        name: doc.name,
        total: docApps.length,
        confirmed: docApps.filter(a => a.confirmationStatus === 'confirmed').length,
        cancelled: docApps.filter(a => a.confirmationStatus === 'cancelled').length,
        noResponse: docApps.filter(a => a.confirmationStatus === 'no_response').length,
        confirmationRate: docApps.length > 0 ? Math.round((docApps.filter(a => a.confirmationStatus === 'confirmed').length / docApps.length) * 100) : 0
      };
    }).sort((a, b) => b.total - a.total);

    const reminderLogs = await ReminderLog.find({
      userId: userId,
      sentAt: { $gte: weekStart.toDate(), $lte: weekEnd.toDate() }
    });

    const totalReminders = reminderLogs.length;
    const openedReminders = reminderLogs.filter(l => l.opened === true).length;
    const clickedReminders = reminderLogs.filter(l => l.clicked === true).length;
    const deliveredReminders = reminderLogs.filter(l => l.status?.current === 'delivered').length;
    const failedReminders = reminderLogs.filter(l => l.status?.current === 'failed').length;

    const clinic = await User.findById(userId);
    const clinicName = clinic?.clinicName || 'Clinic';

    return {
      clinicName,
      weekRange: `${startDate} to ${endDate}`,
      timezone,
      stats: {
        total: totalWeek,
        confirmed: confirmedWeek,
        pending: pendingWeek,
        cancelled: cancelledWeek,
        noResponse: noResponseWeek,
        confirmationRate: totalWeek > 0 ? Math.round((confirmedWeek / totalWeek) * 100) : 0,
        noShowRate: totalWeek > 0 ? Math.round((noResponseWeek / totalWeek) * 100) : 0
      },
      dailyBreakdown,
      doctorPerformance: doctorPerformance.slice(0, 5),
      reminders: {
        total: totalReminders,
        delivered: deliveredReminders,
        opened: openedReminders,
        clicked: clickedReminders,
        failed: failedReminders,
        openRate: totalReminders > 0 ? Math.round((openedReminders / totalReminders) * 100) : 0,
        clickRate: totalReminders > 0 ? Math.round((clickedReminders / totalReminders) * 100) : 0
      },
      topDoctors: doctorPerformance.slice(0, 3)
    };
  } catch (error) {
    console.error('❌ Generate weekly report error:', error);
    return null;
  }
};

// ============ SEND DAILY REPORT EMAIL ============
const sendDailyReport = async (clinic) => {
  try {
    const userId = clinic._id;
    const timezone = clinic.timezone || 'Asia/Karachi';
    const report = await generateDailyReport(userId, timezone);
    
    if (!report) {
      console.log(`❌ Failed to generate daily report for ${clinic.email}`);
      return;
    }

    const settings = await getUserEmailSettings(userId);
    if (!settings) {
      console.log(`❌ No email configured for clinic: ${clinic.email}`);
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Daily Appointment Report - ${report.clinicName}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #1e293b; background: #f1f5f9; }
          .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
          .header { background: linear-gradient(135deg, #3b82f6, #06b6d4); padding: 32px 24px; text-align: center; }
          .header h1 { color: white; margin: 0; font-size: 24px; }
          .header p { color: rgba(255,255,255,0.9); margin: 8px 0 0; }
          .content { padding: 24px; }
          .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0; }
          .stat-box { background: #f8fafc; padding: 12px; border-radius: 10px; text-align: center; border: 1px solid #e2e8f0; }
          .stat-box .number { font-size: 28px; font-weight: 800; color: #0f172a; }
          .stat-box .label { font-size: 12px; color: #64748b; margin-top: 4px; }
          .stat-box.confirmed .number { color: #22c55e; }
          .stat-box.pending .number { color: #f59e0b; }
          .stat-box.cancelled .number { color: #ef4444; }
          .appointment-list { margin: 16px 0; }
          .appointment-item { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
          .appointment-item .time { font-weight: 600; color: #0f172a; }
          .appointment-item .patient { color: #475569; }
          .appointment-item .status { font-size: 12px; padding: 2px 10px; border-radius: 12px; }
          .status-confirmed { background: #dcfce7; color: #166534; }
          .status-pending { background: #fef3c7; color: #92400e; }
          .status-cancelled { background: #fee2e2; color: #991b1b; }
          .status-no_response { background: #f1f5f9; color: #475569; }
          .footer { text-align: center; padding: 20px; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; }
          .btn { display: inline-block; padding: 10px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; }
          .tomorrow-preview { background: #f0fdf4; padding: 16px; border-radius: 10px; margin: 16px 0; border: 1px solid #bbf7d0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📋 Daily Appointment Report</h1>
            <p>${report.clinicName} · ${report.date}</p>
          </div>
          
          <div class="content">
            <h2>Today's Summary</h2>
            <div class="stats-grid">
              <div class="stat-box confirmed">
                <div class="number">${report.stats.total}</div>
                <div class="label">Total Appointments</div>
              </div>
              <div class="stat-box confirmed">
                <div class="number">${report.stats.confirmed}</div>
                <div class="label">✅ Confirmed</div>
              </div>
              <div class="stat-box pending">
                <div class="number">${report.stats.pending}</div>
                <div class="label">⏳ Pending</div>
              </div>
              <div class="stat-box cancelled">
                <div class="number">${report.stats.cancelled}</div>
                <div class="label">❌ Cancelled</div>
              </div>
              <div class="stat-box">
                <div class="number">${report.stats.noResponse}</div>
                <div class="label">📭 No Response</div>
              </div>
              <div class="stat-box">
                <div class="number">${report.stats.confirmationRate}%</div>
                <div class="label">📊 Confirmation Rate</div>
              </div>
            </div>

            <div style="margin: 16px 0; padding: 12px; background: #f8fafc; border-radius: 10px;">
              <p style="margin: 0; font-size: 14px; color: #475569;">
                <strong>🕐 Time Breakdown:</strong> 
                Morning ${report.stats.morning} · Afternoon ${report.stats.afternoon} · Evening ${report.stats.evening}
              </p>
            </div>

            <h3>Today's Appointments</h3>
            <div class="appointment-list">
              ${report.appointments.length > 0 ? report.appointments.map(apt => `
                <div class="appointment-item">
                  <span>
                    <span class="time">${apt.appointmentTime}</span>
                    <span class="patient"> - ${apt.patientId?.name || 'Unknown'}</span>
                    <span style="font-size: 12px; color: #94a3b8; margin-left: 8px;">${apt.doctorId?.name || ''}</span>
                  </span>
                  <span class="status status-${apt.confirmationStatus}">${apt.confirmationStatus || 'pending'}</span>
                </div>
              `).join('') : '<p style="color: #94a3b8; text-align: center;">No appointments today 🎉</p>'}
            </div>

            ${report.hasTomorrow ? `
              <div class="tomorrow-preview">
                <p style="margin: 0; font-weight: 600;">📅 Tomorrow Preview (${report.tomorrowCount} appointments)</p>
                ${report.tomorrowPreview.map(apt => `
                  <div style="display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px;">
                    <span>${apt.appointmentTime} - ${apt.patientId?.name || 'Unknown'}</span>
                    <span style="color: #64748b;">${apt.doctorId?.name || ''}</span>
                  </div>
                `).join('')}
                ${report.tomorrowCount > 5 ? `<p style="font-size: 12px; color: #94a3b8; margin: 4px 0;">+${report.tomorrowCount - 5} more appointments</p>` : ''}
              </div>
            ` : ''}

            <div style="text-align: center; margin: 20px 0;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard" class="btn">📊 View Full Dashboard</a>
            </div>
          </div>
          
          <div class="footer">
            <p>This is an automated daily report from Orvexify.</p>
            <p>&copy; ${new Date().getFullYear()} Orvexify. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const subject = `📋 Daily Appointment Report - ${report.date}`;
    await sendEmailFromClinic(userId, clinic.email, subject, html);

    console.log(`✅ Daily report sent to ${clinic.email} (${timezone})`);
  } catch (error) {
    console.error(`❌ Error sending daily report to ${clinic.email}:`, error);
  }
};

// ============ SEND WEEKLY REPORT EMAIL ============
const sendWeeklyReport = async (clinic) => {
  try {
    const userId = clinic._id;
    const timezone = clinic.timezone || 'Asia/Karachi';
    const report = await generateWeeklyReport(userId, timezone);
    
    if (!report) {
      console.log(`❌ Failed to generate weekly report for ${clinic.email}`);
      return;
    }

    const settings = await getUserEmailSettings(userId);
    if (!settings) {
      console.log(`❌ No email configured for clinic: ${clinic.email}`);
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Weekly Report - ${report.clinicName}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #1e293b; background: #f1f5f9; }
          .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
          .header { background: linear-gradient(135deg, #8b5cf6, #06b6d4); padding: 32px 24px; text-align: center; }
          .header h1 { color: white; margin: 0; font-size: 24px; }
          .header p { color: rgba(255,255,255,0.9); margin: 8px 0 0; }
          .content { padding: 24px; }
          .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0; }
          .stat-box { background: #f8fafc; padding: 12px; border-radius: 10px; text-align: center; border: 1px solid #e2e8f0; }
          .stat-box .number { font-size: 28px; font-weight: 800; color: #0f172a; }
          .stat-box .label { font-size: 12px; color: #64748b; margin-top: 4px; }
          .stat-box.confirmed .number { color: #22c55e; }
          .stat-box.rate .number { color: #3b82f6; }
          .stat-box.no-show .number { color: #ef4444; }
          .day-breakdown { margin: 16px 0; }
          .day-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
          .day-item .day { font-weight: 600; }
          .doctor-list { margin: 16px 0; }
          .doctor-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
          .footer { text-align: center; padding: 20px; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; }
          .btn { display: inline-block; padding: 10px 24px; background: #8b5cf6; color: white; text-decoration: none; border-radius: 8px; }
          .highlight { background: #f0fdf4; padding: 12px; border-radius: 8px; margin: 12px 0; border-left: 4px solid #22c55e; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📊 Weekly Appointment Report</h1>
            <p>${report.clinicName} · ${report.weekRange}</p>
          </div>
          
          <div class="content">
            <h2>Weekly Summary</h2>
            <div class="stats-grid">
              <div class="stat-box confirmed">
                <div class="number">${report.stats.total}</div>
                <div class="label">Total Appointments</div>
              </div>
              <div class="stat-box confirmed">
                <div class="number">${report.stats.confirmed}</div>
                <div class="label">✅ Confirmed</div>
              </div>
              <div class="stat-box">
                <div class="number">${report.stats.pending}</div>
                <div class="label">⏳ Pending</div>
              </div>
              <div class="stat-box cancelled">
                <div class="number">${report.stats.cancelled}</div>
                <div class="label">❌ Cancelled</div>
              </div>
              <div class="stat-box">
                <div class="number">${report.stats.noResponse}</div>
                <div class="label">📭 No Response</div>
              </div>
              <div class="stat-box rate">
                <div class="number">${report.stats.confirmationRate}%</div>
                <div class="label">📊 Confirmation Rate</div>
              </div>
            </div>

            <h3>📅 Daily Breakdown</h3>
            <div class="day-breakdown">
              ${Object.entries(report.dailyBreakdown).map(([day, data]) => `
                <div class="day-item">
                  <span class="day">${day}</span>
                  <span>${data.total} total · ${data.confirmed} ✅ · ${data.cancelled} ❌</span>
                </div>
              `).join('')}
            </div>

            ${report.doctorPerformance.length > 0 ? `
              <h3>👨‍⚕️ Top Doctors</h3>
              <div class="doctor-list">
                ${report.doctorPerformance.map(doc => `
                  <div class="doctor-item">
                    <span>${doc.name}</span>
                    <span>${doc.total} appointments · ${doc.confirmationRate}% confirmed</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}

            <div class="highlight">
              <h4 style="margin: 0;">📧 Reminder Performance</h4>
              <p style="margin: 4px 0; font-size: 14px;">
                ${report.reminders.total} reminders sent · 
                ${report.reminders.opened} opened (${report.reminders.openRate}%) · 
                ${report.reminders.clicked} clicked (${report.reminders.clickRate}%)
              </p>
              <p style="margin: 4px 0; font-size: 12px; color: #64748b;">
                Delivered: ${report.reminders.delivered} · Failed: ${report.reminders.failed}
              </p>
            </div>

            <div style="text-align: center; margin: 20px 0;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard" class="btn">📊 View Full Dashboard</a>
            </div>
          </div>
          
          <div class="footer">
            <p>This is an automated weekly report from Orvexify.</p>
            <p>&copy; ${new Date().getFullYear()} Orvexify. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const subject = `📊 Weekly Appointment Report - ${report.weekRange}`;
    await sendEmailFromClinic(userId, clinic.email, subject, html);

    console.log(`✅ Weekly report sent to ${clinic.email} (${timezone})`);
  } catch (error) {
    console.error(`❌ Error sending weekly report to ${clinic.email}:`, error);
  }
};

// ============ RUN DAILY REPORTS (ALL CLINICS) ============
const runDailyReports = async () => {
  console.log('📋 Running daily reports for all clinics...');
  
  try {
    const clinics = await User.find({
      isActive: true,
      email: { $exists: true, $ne: null }
    });

    console.log(`📋 Found ${clinics.length} active clinics`);

    for (const clinic of clinics) {
      const timezone = clinic.timezone || 'Asia/Karachi';
      const now = moment().tz(timezone);
      const currentHour = now.hour();
      
      // ✅ Only send if it's 10:00 PM in clinic's timezone
      if (currentHour === 22) {
        await sendDailyReport(clinic);
      } else {
        console.log(`⏭️ Skipping ${clinic.clinicName} - Current: ${now.format('HH:mm')} (not 22:00)`);
      }
    }

    console.log(`✅ Daily reports check completed`);
  } catch (error) {
    console.error('❌ Daily reports error:', error);
  }
};

// ============ RUN WEEKLY REPORTS (ALL CLINICS) ============
const runWeeklyReports = async () => {
  console.log('📊 Running weekly reports for all clinics...');
  
  try {
    const clinics = await User.find({
      isActive: true,
      email: { $exists: true, $ne: null }
    });

    console.log(`📋 Found ${clinics.length} active clinics`);

    for (const clinic of clinics) {
      const timezone = clinic.timezone || 'Asia/Karachi';
      const now = moment().tz(timezone);
      const currentHour = now.hour();
      const currentDay = now.day(); // 0 = Sunday
      
      // ✅ Only send if it's Sunday 11:00 PM in clinic's timezone
      if (currentDay === 0 && currentHour === 23) {
        await sendWeeklyReport(clinic);
      } else {
        console.log(`⏭️ Skipping ${clinic.clinicName} - Current: ${now.format('dddd HH:mm')} (not Sunday 23:00)`);
      }
    }

    console.log(`✅ Weekly reports check completed`);
  } catch (error) {
    console.error('❌ Weekly reports error:', error);
  }
};

// ============ SCHEDULE CRON JOBS ============

// ✅ Run every hour to check all clinics
cron.schedule('0 * * * *', async () => {
  console.log(`🕐 Running report check at ${new Date().toISOString()}`);
  
  // Check daily reports (10:00 PM)
  await runDailyReports();
  
  // Check weekly reports (Sunday 11:00 PM)
  await runWeeklyReports();
});

console.log('📋 Report scheduler started:');
console.log('  - Checks every hour');
console.log('  - Sends daily report at 10:00 PM (clinic timezone)');
console.log('  - Sends weekly report at Sunday 11:00 PM (clinic timezone)');

// ============ EXPORTS ============
module.exports = {
  runDailyReports,
  runWeeklyReports,
  sendDailyReport,
  sendWeeklyReport,
  generateDailyReport,
  generateWeeklyReport
};