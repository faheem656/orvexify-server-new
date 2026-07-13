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
    
    // ✅ FIXED: Filter by status (using new status object)
    if (status && status !== 'all') {
      switch (status) {
        case 'pending':
          query['status.current'] = 'pending';
          break;
        case 'sent':
          query['status.current'] = 'sent';
          break;
        case 'delivered':
          query['status.current'] = 'delivered';
          break;
        case 'failed':
          query['status.current'] = 'failed';
          break;
        case 'opened':
          query['status.current'] = 'opened';
          break;
        case 'clicked':
          query['status.current'] = 'clicked';
          break;
        case 'confirmed':
          query.clickedAction = 'confirm';
          break;
        case 'cancelled':
          query.clickedAction = 'cancel';
          break;
        case 'no_response':
          query['status.current'] = 'no_response';
          break;
        default:
          break;
      }
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
    
    // ✅ FIXED: Statistics with new status object
    const allLogs = await ReminderLog.find({ userId: req.user._id }).lean();
    const stats = {
      totalSent: allLogs.length,
      pending: allLogs.filter(l => l.status?.current === 'pending').length,
      sent: allLogs.filter(l => l.status?.current === 'sent').length,
      delivered: allLogs.filter(l => l.status?.current === 'delivered').length,
      failed: allLogs.filter(l => l.status?.current === 'failed').length,
      opened: allLogs.filter(l => l.status?.current === 'opened' || l.opened === true).length,
      clicked: allLogs.filter(l => l.status?.current === 'clicked' || l.clicked === true).length,
      confirmed: allLogs.filter(l => l.clickedAction === 'confirm').length,
      cancelled: allLogs.filter(l => l.clickedAction === 'cancel').length,
      noResponse: allLogs.filter(l => l.status?.current === 'no_response').length,
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
    
    // First verify appointment belongs to this user
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
    
    // Get all logs for this appointment
    const logs = await ReminderLog.find({
      appointmentId: appointmentId,
      userId: req.user._id
    }).sort({ sentAt: -1 }).lean();
    
    // Get patient and doctor details
    const patient = await Patient.findById(appointment.patientId).lean();
    const doctor = await Doctor.findById(appointment.doctorId).lean();
    
    // Enrich logs with patient and doctor info
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
    
    // ✅ FIXED: Calculate statistics with new status object
    const stats = {
      totalReminders: logs.length,
      sent24h: logs.filter(l => l.reminderType === '24h').length,
      sent2h: logs.filter(l => l.reminderType === '2h').length,
      sent30min: logs.filter(l => l.reminderType === '30min').length,
      pending: logs.filter(l => l.status?.current === 'pending').length,
      sent: logs.filter(l => l.status?.current === 'sent').length,
      delivered: logs.filter(l => l.status?.current === 'delivered').length,
      opened: logs.filter(l => l.status?.current === 'opened' || l.opened === true).length,
      clicked: logs.filter(l => l.status?.current === 'clicked' || l.clicked === true).length,
      clickedAction: logs.find(l => l.clicked === true)?.clickedAction || null,
      failed: logs.filter(l => l.status?.current === 'failed').length,
      noResponse: logs.filter(l => l.status?.current === 'no_response').length,
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

// ============ UPDATE LOG STATUS ============
router.put('/reminder-logs/:id/status', protect, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'sent', 'delivered', 'failed', 'opened', 'clicked', 'no_response'];
    
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
      });
    }
    
    const log = await ReminderLog.findOne({ _id: req.params.id, userId: req.user._id });
    
    if (!log) {
      return res.status(404).json({ success: false, message: 'Log not found' });
    }
    
    // Use helper method to update status
    await log.updateStatus(status);
    
    res.json({
      success: true,
      message: 'Status updated successfully',
      log: log
    });
  } catch (error) {
    console.error('Update log status error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ MARK LOG AS OPENED ============
router.post('/reminder-logs/:id/opened', protect, async (req, res) => {
  try {
    const log = await ReminderLog.findOne({ _id: req.params.id, userId: req.user._id });
    
    if (!log) {
      return res.status(404).json({ success: false, message: 'Log not found' });
    }
    
    await log.markOpened();
    
    res.json({
      success: true,
      message: 'Marked as opened',
      log: log
    });
  } catch (error) {
    console.error('Mark opened error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ MARK LOG AS CLICKED ============
router.post('/reminder-logs/:id/clicked', protect, async (req, res) => {
  try {
    const { action } = req.body;
    
    if (!action || !['confirm', 'cancel'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Action must be "confirm" or "cancel"'
      });
    }
    
    const log = await ReminderLog.findOne({ _id: req.params.id, userId: req.user._id });
    
    if (!log) {
      return res.status(404).json({ success: false, message: 'Log not found' });
    }
    
    await log.markClicked(action);
    
    res.json({
      success: true,
      message: 'Marked as clicked',
      log: log
    });
  } catch (error) {
    console.error('Mark clicked error:', error);
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
    
    // ✅ Status filter with new status object
    if (status && status !== 'all') {
      query['status.current'] = status;
    }
    
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
      'Reminder Type': log.reminderType === '24h' ? '24 Hour' : log.reminderType === '2h' ? '2 Hour' : '30 Minute',
      'Sent At': new Date(log.sentAt).toLocaleString(),
      'Status': log.status?.current || 'pending',
      'Opened': log.opened ? 'Yes' : 'No',
      'Opened At': log.openedAt ? new Date(log.openedAt).toLocaleString() : '-',
      'Action': log.clickedAction || 'None',
      'Action At': log.clickedAt ? new Date(log.clickedAt).toLocaleString() : '-',
      'Retry Count': log.retryCount || 0,
      'Error': log.errorMessage || '-'
    }));
    
    res.json({ success: true, exportData });
  } catch (error) {
    console.error('Export logs error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;