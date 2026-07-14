// src/routes/appointmentRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Appointment = require('../models/Appointment');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');

// ============ GET ALL APPOINTMENTS ============
router.get('/appointments', protect, async (req, res) => {
  try {
    const { status, dateFrom, dateTo, search } = req.query;
    
    let query = { userId: req.user._id };
    
    if (status && status !== 'all') {
      query.confirmationStatus = status;
    }
    
    if (dateFrom) {
      query.appointmentDate = { $gte: dateFrom };
    }
    if (dateTo) {
      query.appointmentDate = { ...query.appointmentDate, $lte: dateTo };
    }
    
    let appointments = await Appointment.find(query)
      .sort({ appointmentDate: 1, appointmentTime: 1 })
      .lean();
    
    // Get patient and doctor details
    const patientIds = [...new Set(appointments.map(a => a.patientId))];
    const doctorIds = [...new Set(appointments.map(a => a.doctorId))];
    
    const patients = await Patient.find({ _id: { $in: patientIds } }).lean();
    const doctors = await Doctor.find({ _id: { $in: doctorIds } }).lean();
    
    const patientMap = {};
    patients.forEach(p => patientMap[p._id] = p);
    
    const doctorMap = {};
    doctors.forEach(d => doctorMap[d._id] = d);
    
    // Combine data
    appointments = appointments.map(apt => ({
      ...apt,
      patient: patientMap[apt.patientId] || null,
      doctor: doctorMap[apt.doctorId] || null
    }));
    
    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      appointments = appointments.filter(apt => 
        apt.patient?.name?.toLowerCase().includes(searchLower) ||
        apt.patient?.email?.toLowerCase().includes(searchLower) ||
        apt.doctor?.name?.toLowerCase().includes(searchLower)
      );
    }
    
    res.json({ success: true, appointments });
  } catch (error) {
    console.error('Get appointments error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ GET SINGLE APPOINTMENT ============
router.get('/appointments/:id', protect, async (req, res) => {
  try {
    const appointment = await Appointment.findOne({ _id: req.params.id, userId: req.user._id });
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }
    
    const patient = await Patient.findById(appointment.patientId);
    const doctor = await Doctor.findById(appointment.doctorId);
    
    res.json({
      success: true,
      appointment: {
        ...appointment.toObject(),
        patient,
        doctor
      }
    });
  } catch (error) {
    console.error('Get appointment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ CREATE APPOINTMENT ============
router.post('/appointments', protect, async (req, res) => {
  const { patientName, patientEmail, patientPhone, appointmentDate, appointmentTime, doctorId, notes } = req.body;
  
  try {
    // Find or create patient
    let patient = await Patient.findOne({ email: patientEmail, userId: req.user._id });
    
    if (!patient) {
      patient = await Patient.create({
        userId: req.user._id,
        name: patientName,
        email: patientEmail,
        phone: patientPhone || '',
        notes: notes || ''
      });
    }
    
    // Check for duplicate appointment
    const existingAppointment = await Appointment.findOne({
      userId: req.user._id,
      doctorId,
      appointmentDate,
      appointmentTime
    });
    
    if (existingAppointment) {
      return res.status(400).json({ success: false, message: 'An appointment already exists at this time' });
    }
    
    const appointment = await Appointment.create({
      userId: req.user._id,
      patientId: patient._id,
      doctorId,
      appointmentDate,
      appointmentTime,
      status: 'scheduled',
      confirmationStatus: 'pending',
      notes: notes || ''
    });
    
    res.status(201).json({ success: true, appointment });
  } catch (error) {
    console.error('Create appointment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ UPDATE APPOINTMENT ============
router.put('/appointments/:id', protect, async (req, res) => {
  const { appointmentDate, appointmentTime, doctorId, notes, status, confirmationStatus } = req.body;
  
  try {
    const appointment = await Appointment.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { appointmentDate, appointmentTime, doctorId, notes, status, confirmationStatus, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );
    
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }
    
    res.json({ success: true, appointment });
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ DELETE APPOINTMENT ============
router.delete('/appointments/:id', protect, async (req, res) => {
  try {
    const appointment = await Appointment.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }
    
    res.json({ success: true, message: 'Appointment deleted successfully' });
  } catch (error) {
    console.error('Delete appointment error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ RESEND REMINDER ============
router.post('/appointments/:id/resend', protect, async (req, res) => {
  try {
    const appointment = await Appointment.findOne({ _id: req.params.id, userId: req.user._id });
    
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found' });
    }
    
    // Trigger reminder (to be implemented)
    // await sendReminderEmail(appointment);
    
    res.json({ success: true, message: 'Reminder resent successfully' });
  } catch (error) {
    console.error('Resend reminder error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});



// ============================================
// ============ CONFIRM APPOINTMENT ============
// ============================================
router.post('/confirm/:token', async (req, res) => {
  try {
    const { token } = req.params;

    console.log(`📧 Confirming appointment with token: ${token}`);

    // ✅ Find appointment by confirmation token
    const appointment = await Appointment.findOne({ 
      confirmationToken: token 
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: '❌ Invalid or expired confirmation link. Please contact the clinic.'
      });
    }

    // ✅ CHECK: If already confirmed
    if (appointment.confirmationStatus === 'confirmed') {
      return res.status(400).json({
        success: false,
        message: '✅ This appointment has already been confirmed.',
        alreadyConfirmed: true,
        appointment: {
          id: appointment._id,
          date: appointment.appointmentDate,
          time: appointment.appointmentTime,
          status: appointment.confirmationStatus
        }
      });
    }

    // ✅ CHECK: If already cancelled
    if (appointment.confirmationStatus === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: '❌ This appointment has been cancelled and cannot be confirmed.',
        alreadyCancelled: true,
        appointment: {
          id: appointment._id,
          date: appointment.appointmentDate,
          time: appointment.appointmentTime,
          status: appointment.confirmationStatus
        }
      });
    }

    // ✅ CHECK: If appointment is in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const appointmentDate = new Date(appointment.appointmentDate + 'T00:00:00');
    appointmentDate.setHours(0, 0, 0, 0);
    
    if (appointmentDate < today) {
      return res.status(400).json({
        success: false,
        message: '❌ This appointment is in the past and cannot be confirmed.',
        isPast: true
      });
    }

    // ✅ UPDATE: Confirm appointment
    appointment.confirmationStatus = 'confirmed';
    appointment.status = 'confirmed';
    await appointment.save();

    console.log(`✅ Appointment confirmed: ${appointment._id}`);

    // ✅ UPDATE: Cancel any pending reminders
    try {
      await cancelAllReminders(appointment._id);
      console.log(`✅ Pending reminders cancelled for confirmed appointment`);
    } catch (err) {
      console.error('❌ Failed to cancel reminders:', err);
    }

    // ✅ UPDATE: Reminder logs
    try {
      await ReminderLog.updateMany(
        { 
          appointmentId: appointment._id,
          'status.current': { $in: ['pending', 'sent'] }
        },
        { 
          $set: { 
            'status.current': 'confirmed',
            'status.isPending': false,
            'status.isSent': true,
            'status.isDelivered': true,
            'status.isOpened': true,
            'status.isClicked': true,
            'status.isNoResponse': false,
            clickedAction: 'confirm',
            clicked: true,
            clickedAt: new Date()
          }
        }
      );
      console.log(`✅ Reminder logs updated for confirmed appointment`);
    } catch (err) {
      console.error('❌ Failed to update logs:', err);
    }

    // ✅ SEND: Confirmation email
    try {
      const [patient, doctor, clinic] = await Promise.all([
        Patient.findById(appointment.patientId),
        Doctor.findById(appointment.doctorId),
        User.findById(appointment.userId)
      ]);

      if (patient?.email) {
        await sendConfirmedEmail(
          appointment.userId,
          patient.email,
          patient.name || 'Patient',
          clinic?.clinicName || 'Clinic',
          appointment.appointmentDate,
          appointment.appointmentTime,
          doctor?.name || 'Doctor',
          clinic?.timezone || 'Asia/Karachi'
        );
        console.log(`✅ Confirmation email sent to ${patient.email}`);
      }
    } catch (emailError) {
      console.error('❌ Failed to send confirmation email:', emailError);
      // Don't fail the request if email fails
    }

    res.json({
      success: true,
      message: '✅ Your appointment has been confirmed successfully!',
      appointment: {
        id: appointment._id,
        date: appointment.appointmentDate,
        time: appointment.appointmentTime,
        status: appointment.confirmationStatus
      }
    });
  } catch (error) {
    console.error('❌ Confirm appointment error:', error);
    res.status(500).json({
      success: false,
      message: '❌ Something went wrong. Please contact the clinic.'
    });
  }
});

// ============================================
// ============ CANCEL APPOINTMENT ============
// ============================================
router.post('/cancel/:token', async (req, res) => {
  try {
    const { token } = req.params;

    console.log(`📧 Cancelling appointment with token: ${token}`);

    // ✅ Find appointment by cancellation token
    const appointment = await Appointment.findOne({ 
      cancellationToken: token 
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: '❌ Invalid or expired cancellation link. Please contact the clinic.'
      });
    }

    // ✅ CHECK: If already cancelled
    if (appointment.confirmationStatus === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: '❌ This appointment has already been cancelled.',
        alreadyCancelled: true,
        appointment: {
          id: appointment._id,
          date: appointment.appointmentDate,
          time: appointment.appointmentTime,
          status: appointment.confirmationStatus
        }
      });
    }

    // ✅ CHECK: If already confirmed
    if (appointment.confirmationStatus === 'confirmed') {
      return res.status(400).json({
        success: false,
        message: '✅ This appointment has already been confirmed and cannot be cancelled.',
        alreadyConfirmed: true,
        appointment: {
          id: appointment._id,
          date: appointment.appointmentDate,
          time: appointment.appointmentTime,
          status: appointment.confirmationStatus
        }
      });
    }

    // ✅ CHECK: If appointment is in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const appointmentDate = new Date(appointment.appointmentDate + 'T00:00:00');
    appointmentDate.setHours(0, 0, 0, 0);
    
    if (appointmentDate < today) {
      return res.status(400).json({
        success: false,
        message: '❌ This appointment is in the past and cannot be cancelled.',
        isPast: true
      });
    }

    // ✅ CHECK: If appointment is within 2 hours
    const now = new Date();
    const appointmentDateTime = new Date(appointment.appointmentDate + 'T' + appointment.appointmentTime);
    const twoHoursBefore = new Date(appointmentDateTime.getTime() - 2 * 60 * 60 * 1000);
    
    if (now > twoHoursBefore) {
      return res.status(400).json({
        success: false,
        message: '❌ Cannot cancel appointment within 2 hours of the scheduled time. Please contact the clinic directly.',
        withinTwoHours: true
      });
    }

    // ✅ UPDATE: Cancel appointment
    appointment.confirmationStatus = 'cancelled';
    appointment.status = 'cancelled';
    await appointment.save();

    console.log(`✅ Appointment cancelled: ${appointment._id}`);

    // ✅ UPDATE: Cancel any pending reminders
    try {
      await cancelAllReminders(appointment._id);
      console.log(`✅ Pending reminders cancelled for cancelled appointment`);
    } catch (err) {
      console.error('❌ Failed to cancel reminders:', err);
    }

    // ✅ UPDATE: Reminder logs
    try {
      await ReminderLog.updateMany(
        { 
          appointmentId: appointment._id,
          'status.current': { $in: ['pending', 'sent'] }
        },
        { 
          $set: { 
            'status.current': 'cancelled',
            'status.isPending': false,
            'status.isSent': true,
            'status.isDelivered': true,
            'status.isOpened': true,
            'status.isClicked': true,
            'status.isNoResponse': false,
            clickedAction: 'cancel',
            clicked: true,
            clickedAt: new Date()
          }
        }
      );
      console.log(`✅ Reminder logs updated for cancelled appointment`);
    } catch (err) {
      console.error('❌ Failed to update logs:', err);
    }

    // ✅ SEND: Cancellation email
    try {
      const [patient, clinic] = await Promise.all([
        Patient.findById(appointment.patientId),
        User.findById(appointment.userId)
      ]);

      if (patient?.email) {
        await sendCancellationEmail(
          appointment.userId,
          patient.email,
          patient.name || 'Patient',
          clinic?.clinicName || 'Clinic',
          appointment.appointmentDate,
          appointment.appointmentTime,
          clinic?.timezone || 'Asia/Karachi'
        );
        console.log(`✅ Cancellation email sent to ${patient.email}`);
      }
    } catch (emailError) {
      console.error('❌ Failed to send cancellation email:', emailError);
      // Don't fail the request if email fails
    }

    res.json({
      success: true,
      message: '✅ Your appointment has been cancelled successfully!',
      appointment: {
        id: appointment._id,
        date: appointment.appointmentDate,
        time: appointment.appointmentTime,
        status: appointment.confirmationStatus
      }
    });
  } catch (error) {
    console.error('❌ Cancel appointment error:', error);
    res.status(500).json({
      success: false,
      message: '❌ Something went wrong. Please contact the clinic.'
    });
  }
});

// ============ GET APPOINTMENT DETAILS BY TOKEN ============
router.get('/details/:token', async (req, res) => {
  try {
    const { token } = req.params;

    console.log(`📧 Fetching appointment details for token: ${token}`);

    // ✅ Find appointment by confirmation token OR cancellation token
    const appointment = await Appointment.findOne({ 
      $or: [
        { confirmationToken: token },
        { cancellationToken: token }
      ]
    })
    .populate('doctorId', 'name specialty')
    .populate('patientId', 'name email phone')
    .populate('userId', 'clinicName');

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // ✅ Check if tokens match
    const isConfirmToken = appointment.confirmationToken === token;
    const isCancelToken = appointment.cancellationToken === token;

    res.json({
      success: true,
      appointment: {
        id: appointment._id,
        appointmentDate: appointment.appointmentDate,
        appointmentTime: appointment.appointmentTime,
        doctorName: appointment.doctorId?.name || 'N/A',
        doctorSpecialty: appointment.doctorId?.specialty || 'N/A',
        clinicName: appointment.userId?.clinicName || 'N/A',
        patientName: appointment.patientId?.name || 'N/A',
        patientEmail: appointment.patientId?.email || 'N/A',
        patientPhone: appointment.patientId?.phone || 'N/A',
        status: appointment.status,
        confirmationStatus: appointment.confirmationStatus,
        isConfirmToken: isConfirmToken,
        isCancelToken: isCancelToken,
        canConfirm: appointment.confirmationStatus !== 'confirmed' && 
                    appointment.confirmationStatus !== 'cancelled',
        canCancel: appointment.confirmationStatus !== 'confirmed' && 
                   appointment.confirmationStatus !== 'cancelled'
      }
    });
  } catch (error) {
    console.error('❌ Get appointment details error:', error);
    res.status(500).json({
      success: false,
      message: 'Something went wrong'
    });
  }
});

// ============ GET APPOINTMENT STATUS ============
router.get('/status/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const appointment = await Appointment.findOne({ 
      $or: [
        { confirmationToken: token },
        { cancellationToken: token }
      ]
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    res.json({
      success: true,
      status: appointment.confirmationStatus,
      appointment: {
        id: appointment._id,
        date: appointment.appointmentDate,
        time: appointment.appointmentTime,
        status: appointment.confirmationStatus,
        isConfirmed: appointment.confirmationStatus === 'confirmed',
        isCancelled: appointment.confirmationStatus === 'cancelled',
        isPending: appointment.confirmationStatus === 'pending',
        isNoResponse: appointment.confirmationStatus === 'no_response'
      }
    });
  } catch (error) {
    console.error('❌ Get appointment status error:', error);
    res.status(500).json({
      success: false,
      message: 'Something went wrong'
    });
  }
});



module.exports = router;