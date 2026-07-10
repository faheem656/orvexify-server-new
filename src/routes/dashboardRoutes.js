// src/routes/dashboardRoutes.js — Create this file

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Appointment = require('../models/Appointment');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const User = require('../models/User');
const moment = require('moment-timezone');

// ============ GET DASHBOARD STATS ============
router.get('/stats', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const timezone = req.user.timezone || 'Asia/Karachi';
    const now = moment().tz(timezone);
    const todayDate = now.format('YYYY-MM-DD');
    const todayStart = now.startOf('day').toDate();
    const todayEnd = now.endOf('day').toDate();

    // ✅ Get today's appointments
    const todayAppointments = await Appointment.find({
      userId: userId,
      appointmentDate: todayDate
    });

    const totalToday = todayAppointments.length;
    const confirmed = todayAppointments.filter(a => a.confirmationStatus === 'confirmed').length;
    const pending = todayAppointments.filter(a => a.confirmationStatus === 'pending').length;
    const cancelled = todayAppointments.filter(a => a.confirmationStatus === 'cancelled').length;
    const noResponse = todayAppointments.filter(a => a.confirmationStatus === 'no_response').length;

    // ✅ Calculate confirmation rate
    const confirmationRate = totalToday > 0 ? Math.round((confirmed / totalToday) * 100) : 0;
    const noShowRate = totalToday > 0 ? Math.round((noResponse / totalToday) * 100) : 0;

    // ✅ Get upcoming appointments (next 7 days)
    const weekLater = now.clone().add(7, 'days');
    const upcomingAppointments = await Appointment.find({
      userId: userId,
      appointmentDate: { $gte: todayDate, $lte: weekLater.format('YYYY-MM-DD') }
    })
    .sort({ appointmentDate: 1, appointmentTime: 1 })
    .limit(10)
    .lean();

    // ✅ Get patient and doctor details for appointments
    const patientIds = [...new Set(upcomingAppointments.map(a => a.patientId))];
    const doctorIds = [...new Set(upcomingAppointments.map(a => a.doctorId))];
    
    const patients = await Patient.find({ _id: { $in: patientIds } }).lean();
    const doctors = await Doctor.find({ _id: { $in: doctorIds } }).lean();
    
    const patientMap = {};
    patients.forEach(p => patientMap[p._id] = p);
    
    const doctorMap = {};
    doctors.forEach(d => doctorMap[d._id] = d);

    const appointments = upcomingAppointments.map(apt => ({
      id: apt._id,
      patientName: patientMap[apt.patientId]?.name || 'Unknown Patient',
      patientEmail: patientMap[apt.patientId]?.email || '',
      time: apt.appointmentTime,
      doctor: doctorMap[apt.doctorId]?.name || 'Unknown Doctor',
      status: apt.status,
      confirmationStatus: apt.confirmationStatus
    }));

    // ✅ Get recent activity (from reminder logs)
    const ReminderLog = require('../models/ReminderLog');
    const recentLogs = await ReminderLog.find({ userId: userId })
      .sort({ sentAt: -1 })
      .limit(5)
      .populate('patientId', 'name email')
      .lean();

    const activity = recentLogs.map(log => {
      let type = 'sent';
      let message = 'Reminder sent';
      
      if (log.clickedAction === 'confirm') {
        type = 'confirmed';
        message = `${log.patientId?.name || 'Patient'} confirmed appointment`;
      } else if (log.clickedAction === 'cancel') {
        type = 'cancelled';
        message = `${log.patientId?.name || 'Patient'} cancelled appointment`;
      } else if (log.emailStatus === 'failed') {
        type = 'failed';
        message = `Failed to send reminder to ${log.patientId?.name || 'patient'}`;
      } else {
        message = `Reminder sent to ${log.patientId?.email || 'patient'}`;
      }
      
      return {
        id: log._id,
        message: message,
        time: moment(log.sentAt).tz(timezone).format('h:mm A'),
        type: type
      };
    });

    res.json({
      success: true,
      stats: {
        todayAppointments: totalToday,
        confirmed: confirmed,
        pending: pending,
        cancelled: cancelled,
        noResponse: noResponse,
        confirmationRate: confirmationRate,
        noShowRate: noShowRate
      },
      appointments: appointments,
      activity: activity
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message
    });
  }
});

// ============ GET RECENT ACTIVITY ============
router.get('/activity', protect, async (req, res) => {
  try {
    const userId = req.user._id;
    const timezone = req.user.timezone || 'Asia/Karachi';
    
    const ReminderLog = require('../models/ReminderLog');
    const recentLogs = await ReminderLog.find({ userId: userId })
      .sort({ sentAt: -1 })
      .limit(20)
      .populate('patientId', 'name email')
      .lean();

    const activity = recentLogs.map(log => {
      let type = 'sent';
      let message = 'Reminder sent';
      
      if (log.clickedAction === 'confirm') {
        type = 'confirmed';
        message = `${log.patientId?.name || 'Patient'} confirmed appointment`;
      } else if (log.clickedAction === 'cancel') {
        type = 'cancelled';
        message = `${log.patientId?.name || 'Patient'} cancelled appointment`;
      } else if (log.emailStatus === 'failed') {
        type = 'failed';
        message = `Failed to send reminder to ${log.patientId?.name || 'patient'}`;
      } else {
        message = `Reminder sent to ${log.patientId?.email || 'patient'}`;
      }
      
      return {
        id: log._id,
        message: message,
        time: moment(log.sentAt).tz(timezone).format('h:mm A'),
        type: type
      };
    });

    res.json({
      success: true,
      activity: activity
    });
  } catch (error) {
    console.error('Activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;