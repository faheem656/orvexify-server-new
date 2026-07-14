// src/routes/reminderLogRoutes.js — Fixed Stats Calculation

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
    
    if (type && type !== 'all') {
      query.reminderType = type;
    }
    
    // ✅ COMPLETE FIXED: ALL Boolean filters
    if (status && status !== 'all') {
      switch (status) {
        case 'pending':
          query['status.isPending'] = true;
          break;
        case 'sent':
          query['status.isSent'] = true;
          break;
        case 'delivered':
          query['status.isDelivered'] = true;
          break;
        case 'failed':
          query['status.isFailed'] = true;
          break;
        case 'opened':
          // ✅ FIXED: Check BOTH opened field AND status.isOpened
          query.$or = [
            { 'status.isOpened': true },
            { opened: true }
          ];
          break;
        case 'clicked':
          query['status.isClicked'] = true;
          break;
        case 'confirmed':
          query.clickedAction = 'confirm';
          break;
        case 'cancelled':
          query.clickedAction = 'cancel';
          break;
        case 'no_response':
          query['status.isNoResponse'] = true;
          break;
        default:
          break;
      }
    }
    
    if (dateFrom) {
      query.sentAt = { $gte: new Date(dateFrom) };
    }
    if (dateTo) {
      query.sentAt = { ...query.sentAt, $lte: new Date(dateTo) };
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const logs = await ReminderLog.find(query)
      .sort({ sentAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const total = await ReminderLog.countDocuments(query);
    
    const patientIds = [...new Set(logs.map(l => l.patientId))];
    const patients = await Patient.find({ _id: { $in: patientIds } }).lean();
    const patientMap = {};
    patients.forEach(p => patientMap[p._id] = p);
    
    const appointmentIds = [...new Set(logs.map(l => l.appointmentId))];
    const appointments = await Appointment.find({ _id: { $in: appointmentIds } }).lean();
    const appointmentMap = {};
    appointments.forEach(a => appointmentMap[a._id] = a);
    
    // ✅ Ensure ALL status fields exist
    const enrichedLogs = logs.map(log => ({
      ...log,
      status: {
        current: log.status?.current || 'pending',
        isPending: log.status?.isPending || false,
        isSent: log.status?.isSent || false,
        isDelivered: log.status?.isDelivered || false,
        isFailed: log.status?.isFailed || false,
        isOpened: log.status?.isOpened || false,
        isClicked: log.status?.isClicked || false,
        isNoResponse: log.status?.isNoResponse || false,
      },
      patient: patientMap[log.patientId] || null,
      appointment: appointmentMap[log.appointmentId] || null
    }));
    
    let filteredLogs = enrichedLogs;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredLogs = enrichedLogs.filter(log => 
        log.patient?.name?.toLowerCase().includes(searchLower) ||
        log.patient?.email?.toLowerCase().includes(searchLower)
      );
    }
    
    // ✅ Stats with Boolean fields
    const allLogs = await ReminderLog.find({ userId: req.user._id }).lean();
    
    const stats = {
      totalSent: allLogs.length,
      pending: allLogs.filter(l => l.status?.isPending === true).length,
      sent: allLogs.filter(l => l.status?.isSent === true).length,
      delivered: allLogs.filter(l => l.status?.isDelivered === true).length,
      failed: allLogs.filter(l => l.status?.isFailed === true).length,
      opened: allLogs.filter(l => l.status?.isOpened === true || l.opened === true).length,  // ✅ FIXED
      clicked: allLogs.filter(l => l.status?.isClicked === true || l.clicked === true).length,
      confirmed: allLogs.filter(l => l.clickedAction === 'confirm').length,
      cancelled: allLogs.filter(l => l.clickedAction === 'cancel').length,
      noResponse: allLogs.filter(l => l.status?.isNoResponse === true).length,
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
    
    const logs = await ReminderLog.find({
      appointmentId: appointmentId,
      userId: req.user._id
    }).sort({ sentAt: -1 }).lean();
    
    const patient = await Patient.findById(appointment.patientId).lean();
    const doctor = await Doctor.findById(appointment.doctorId).lean();
    
    const enrichedLogs = logs.map(log => ({
      ...log,
      status: {
        current: log.status?.current || 'pending',
        isPending: log.status?.isPending || false,
        isSent: log.status?.isSent || false,
        isDelivered: log.status?.isDelivered || false,
        isFailed: log.status?.isFailed || false,
        isOpened: log.status?.isOpened || false,
        isClicked: log.status?.isClicked || false,
        isNoResponse: log.status?.isNoResponse || false,
      },
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
    
    // ✅ FIXED: Stats with delivered count
    const stats = {
      totalReminders: logs.length,
      sent24h: logs.filter(l => l.reminderType === '24h').length,
      sent2h: logs.filter(l => l.reminderType === '2h').length,
      sent30min: logs.filter(l => l.reminderType === '30min').length,
      pending: logs.filter(l => l.status?.current === 'pending' || l.status?.isPending === true).length,
      sent: logs.filter(l => l.status?.current === 'sent' || l.status?.isSent === true).length,
      delivered: logs.filter(l => l.status?.isDelivered === true).length,  // ✅ FIXED
      opened: logs.filter(l => l.opened === true || l.status?.current === 'opened' || l.status?.isOpened === true).length,
      clicked: logs.filter(l => l.clicked === true || l.status?.current === 'clicked' || l.status?.isClicked === true).length,
      clickedAction: logs.find(l => l.clicked === true)?.clickedAction || null,
      failed: logs.filter(l => l.status?.current === 'failed' || l.status?.isFailed === true).length,
      noResponse: logs.filter(l => l.status?.current === 'no_response' || l.status?.isNoResponse === true).length,
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
    
    const patient = await Patient.findById(log.patientId).lean();
    const appointment = await Appointment.findById(log.appointmentId).lean();
    const doctor = await Doctor.findById(log.doctorId).lean();
    
    res.json({
      success: true,
      log: {
        ...log,
        status: {
          current: log.status?.current || 'pending',
          isPending: log.status?.isPending || false,
          isSent: log.status?.isSent || false,
          isDelivered: log.status?.isDelivered || false,
          isFailed: log.status?.isFailed || false,
          isOpened: log.status?.isOpened || false,
          isClicked: log.status?.isClicked || false,
          isNoResponse: log.status?.isNoResponse || false,
        },
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
    
    // ✅ Update ALL status fields
    log.status.current = status;
    log.status.isPending = status === 'pending';
    log.status.isSent = status === 'sent' || status === 'delivered' || status === 'opened' || status === 'clicked';
    log.status.isDelivered = status === 'sent' || status === 'delivered' || status === 'opened' || status === 'clicked';
    log.status.isFailed = status === 'failed';
    log.status.isOpened = status === 'opened';
    log.status.isClicked = status === 'clicked';
    log.status.isNoResponse = status === 'no_response';
    await log.save();
    
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
    
    log.opened = true;
    log.openedAt = new Date();
    log.openedCount = (log.openedCount || 0) + 1;
    log.status.current = 'opened';
    log.status.isPending = false;
    log.status.isSent = true;
    log.status.isDelivered = true;
    log.status.isFailed = false;
    log.status.isOpened = true;
    log.status.isClicked = false;
    log.status.isNoResponse = false;
    await log.save();
    
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
    
    log.clicked = true;
    log.clickedAt = new Date();
    log.clickedCount = (log.clickedCount || 0) + 1;
    log.clickedAction = action;
    log.status.current = 'clicked';
    log.status.isPending = false;
    log.status.isSent = true;
    log.status.isDelivered = true;
    log.status.isFailed = false;
    log.status.isOpened = true;
    log.status.isClicked = true;
    log.status.isNoResponse = false;
    await log.save();
    
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
    
    if (status && status !== 'all') {
      query['status.current'] = status;
    }
    
    const logs = await ReminderLog.find(query).sort({ sentAt: -1 }).lean();
    
    const patientIds = [...new Set(logs.map(l => l.patientId))];
    const patients = await Patient.find({ _id: { $in: patientIds } }).lean();
    const patientMap = {};
    patients.forEach(p => patientMap[p._id] = p);
    
    const exportData = logs.map(log => ({
      'Patient Name': patientMap[log.patientId]?.name || 'N/A',
      'Patient Email': patientMap[log.patientId]?.email || 'N/A',
      'Reminder Type': log.reminderType === '24h' ? '24 Hour' : log.reminderType === '2h' ? '2 Hour' : '30 Minute',
      'Sent At': new Date(log.sentAt).toLocaleString(),
      'Status': log.status?.current || 'pending',
      'Pending': log.status?.isPending ? 'Yes' : 'No',
      'Sent': log.status?.isSent ? 'Yes' : 'No',
      'Delivered': log.status?.isDelivered ? 'Yes' : 'No',  // ✅ FIXED
      'Failed': log.status?.isFailed ? 'Yes' : 'No',
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