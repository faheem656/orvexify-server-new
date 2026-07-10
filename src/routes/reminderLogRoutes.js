// src/routes/reminderLogRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const ReminderLog = require('../models/ReminderLog');
const Patient = require('../models/Patient');
const Appointment = require('../models/Appointment');
const Doctor = require('../models/Doctor');

// ============ GET ALL REMINDER LOGS ============
router.get('/reminder-logs', protect, async (req, res) => {
  try {
    const { 
      search, 
      type, 
      status, 
      dateFrom, 
      dateTo,
      page = 1,
      limit = 20
    } = req.query;
    
    let query = { userId: req.user._id };
    
    // Filter by reminder type
    if (type && type !== 'all') {
      query.reminderType = type;
    }
    
    // Filter by status
    if (status && status !== 'all') {
      if (status === 'delivered') query.emailStatus = 'delivered';
      else if (status === 'failed') query.emailStatus = 'failed';
      else if (status === 'opened') query.opened = true;
      else if (status === 'not_opened') query.opened = false;
      else if (status === 'confirmed') query.clickedAction = 'confirm';
      else if (status === 'cancelled') query.clickedAction = 'cancel';
    }
    
    // Filter by date range
    if (dateFrom) {
      query.sentAt = { $gte: new Date(dateFrom) };
    }
    if (dateTo) {
      query.sentAt = { ...query.sentAt, $lte: new Date(dateTo) };
    }
    
    // Get logs with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const logs = await ReminderLog.find(query)
      .sort({ sentAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const total = await ReminderLog.countDocuments(query);
    
    // Get patient details for each log
    const patientIds = [...new Set(logs.map(l => l.patientId))];
    const patients = await Patient.find({ _id: { $in: patientIds } }).lean();
    const patientMap = {};
    patients.forEach(p => patientMap[p._id] = p);
    
    // Get appointment details
    const appointmentIds = [...new Set(logs.map(l => l.appointmentId))];
    const appointments = await Appointment.find({ _id: { $in: appointmentIds } }).lean();
    const appointmentMap = {};
    appointments.forEach(a => appointmentMap[a._id] = a);
    
    // Combine data
    const enrichedLogs = logs.map(log => ({
      ...log,
      patient: patientMap[log.patientId] || null,
      appointment: appointmentMap[log.appointmentId] || null
    }));
    
    // Apply search filter
    let filteredLogs = enrichedLogs;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredLogs = enrichedLogs.filter(log => 
        log.patient?.name?.toLowerCase().includes(searchLower) ||
        log.patient?.email?.toLowerCase().includes(searchLower)
      );
    }
    
    // Statistics
    const allLogs = await ReminderLog.find({ userId: req.user._id }).lean();
    const stats = {
      totalSent: allLogs.length,
      delivered: allLogs.filter(l => l.emailStatus === 'delivered').length,
      failed: allLogs.filter(l => l.emailStatus === 'failed').length,
      opened: allLogs.filter(l => l.opened === true).length,
      confirmed: allLogs.filter(l => l.clickedAction === 'confirm').length,
      cancelled: allLogs.filter(l => l.clickedAction === 'cancel').length,
      noResponse: allLogs.filter(l => l.emailStatus === 'no_response').length
    };
    
    res.json({
      success: true,
      logs: filteredLogs,
      stats,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get reminder logs error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});



// ============ GET REMINDER LOGS BY APPOINTMENT ID ============
router.get('/reminder-logs/appointment/:appointmentId', protect, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    
    // ✅ First verify appointment belongs to this user
    const appointment = await Appointment.findOne({ 
      _id: appointmentId, 
      userId: req.user._id 
    });
    
    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found or unauthorized'
      });
    }
    
    // ✅ Get all logs for this appointment
    const logs = await ReminderLog.find({
      appointmentId: appointmentId,
      userId: req.user._id
    }).sort({ sentAt: -1 }).lean();
    
    // ✅ Get patient and doctor details
    const patient = await Patient.findById(appointment.patientId).lean();
    const doctor = await Doctor.findById(appointment.doctorId).lean();
    
    // ✅ Enrich logs with patient and doctor info
    const enrichedLogs = logs.map(log => ({
      ...log,
      patient: patient || null,
      doctor: doctor || null,
      appointment: {
        id: appointment._id,
        date: appointment.appointmentDate,
        time: appointment.appointmentTime,
        status: appointment.status,
        confirmationStatus: appointment.confirmationStatus
      }
    }));
    
    // ✅ Calculate statistics for this appointment
    const stats = {
      totalReminders: logs.length,
      sent24h: logs.filter(l => l.reminderType === '24h').length,
      sent2h: logs.filter(l => l.reminderType === '2h').length,
      delivered: logs.filter(l => l.emailStatus === 'delivered').length,
      opened: logs.filter(l => l.opened === true).length,
      clicked: logs.filter(l => l.clicked === true).length,
      clickedAction: logs.find(l => l.clicked === true)?.clickedAction || null,
      failed: logs.filter(l => l.emailStatus === 'failed').length,
      pending: logs.filter(l => l.emailStatus === 'pending').length,
      noResponse: logs.filter(l => l.emailStatus === 'no_response').length
    };
    
    res.json({
      success: true,
      appointment: {
        id: appointment._id,
        date: appointment.appointmentDate,
        time: appointment.appointmentTime,
        patient: patient ? {
          id: patient._id,
          name: patient.name,
          email: patient.email,
          phone: patient.phone
        } : null,
        doctor: doctor ? {
          id: doctor._id,
          name: doctor.name,
          specialty: doctor.specialty
        } : null,
        status: appointment.status,
        confirmationStatus: appointment.confirmationStatus
      },
      logs: enrichedLogs,
      stats: stats,
      summary: {
        lastReminder: logs.length > 0 ? logs[0].sentAt : null,
        firstReminder: logs.length > 0 ? logs[logs.length - 1].sentAt : null,
        totalReminders: logs.length,
        hasInteraction: logs.some(l => l.clicked === true || l.opened === true)
      }
    });
  } catch (error) {
    console.error('Get appointment logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message
    });
  }
});



// ============ GET SINGLE REMINDER LOG ============
router.get('/reminder-logs/:id', protect, async (req, res) => {
  try {
    const log = await ReminderLog.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    
    if (!log) {
      return res.status(404).json({ success: false, message: 'Log not found' });
    }
    
    // Get related data
    const patient = await Patient.findById(log.patientId).lean();
    const appointment = await Appointment.findById(log.appointmentId).lean();
    const doctor = await Doctor.findById(log.doctorId).lean();
    
    res.json({
      success: true,
      log: {
        ...log,
        patient,
        appointment,
        doctor
      }
    });
  } catch (error) {
    console.error('Get reminder log error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ EXPORT LOGS ============
router.get('/reminder-logs/export', protect, async (req, res) => {
  try {
    const { dateFrom, dateTo, type, status } = req.query;
    
    let query = { userId: req.user._id };
    
    if (type && type !== 'all') query.reminderType = type;
    if (dateFrom) query.sentAt = { $gte: new Date(dateFrom) };
    if (dateTo) query.sentAt = { ...query.sentAt, $lte: new Date(dateTo) };
    
    const logs = await ReminderLog.find(query).sort({ sentAt: -1 }).lean();
    
    // Get patient details
    const patientIds = [...new Set(logs.map(l => l.patientId))];
    const patients = await Patient.find({ _id: { $in: patientIds } }).lean();
    const patientMap = {};
    patients.forEach(p => patientMap[p._id] = p);
    
    // Format for CSV export
    const exportData = logs.map(log => ({
      'Patient Name': patientMap[log.patientId]?.name || 'N/A',
      'Patient Email': patientMap[log.patientId]?.email || 'N/A',
      'Reminder Type': log.reminderType === '24h' ? '24 Hour' : '2 Hour',
      'Sent At': new Date(log.sentAt).toLocaleString(),
      'Status': log.emailStatus,
      'Opened': log.opened ? 'Yes' : 'No',
      'Opened At': log.openedAt ? new Date(log.openedAt).toLocaleString() : '-',
      'Action': log.clickedAction || 'None',
      'Action At': log.clickedAt ? new Date(log.clickedAt).toLocaleString() : '-'
    }));
    
    res.json({ success: true, exportData });
  } catch (error) {
    console.error('Export logs error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;