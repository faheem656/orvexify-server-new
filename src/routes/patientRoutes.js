// src/routes/patientRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Patient = require('../models/Patient');
const Appointment = require('../models/Appointment');

// ============ GET ALL PATIENTS ============
router.get('/patients', protect, async (req, res) => {
  try {
    const { search, status } = req.query;
    
    let query = { userId: req.user._id };
    
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex }
      ];
    }
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    let patients = await Patient.find(query).sort({ createdAt: -1 });
    
    // Get appointment counts for each patient
    for (let patient of patients) {
      const appointments = await Appointment.find({ patientId: patient._id, userId: req.user._id });
      patient.totalAppointments = appointments.length;
      patient.lastVisit = appointments.length > 0 ? appointments[appointments.length - 1].appointmentDate : null;
      patient.noShowCount = appointments.filter(a => a.status === 'no_show').length;
      
      const confirmedCount = appointments.filter(a => a.confirmationStatus === 'confirmed').length;
      patient.confirmedRate = appointments.length > 0 ? (confirmedCount / appointments.length) * 100 : 0;
    }
    
    res.json({ success: true, patients });
  } catch (error) {
    console.error('Get patients error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ GET SINGLE PATIENT WITH APPOINTMENTS ============
router.get('/patients/:id', protect, async (req, res) => {
  try {
    const patient = await Patient.findOne({ _id: req.params.id, userId: req.user._id });
    
    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found' });
    }
    
    // Get all appointments for this patient
    const appointments = await Appointment.find({ patientId: patient._id, userId: req.user._id })
      .sort({ appointmentDate: -1 })
      .lean();
    
    // Get doctor details for each appointment
    const Doctor = require('../models/Doctor');
    for (let apt of appointments) {
      const doctor = await Doctor.findById(apt.doctorId).select('name specialty');
      apt.doctor = doctor;
    }
    
    res.json({
      success: true,
      patient: {
        ...patient.toObject(),
        appointments,
        totalAppointments: appointments.length,
        lastVisit: appointments.length > 0 ? appointments[0].appointmentDate : null,
        noShowCount: appointments.filter(a => a.status === 'no_show').length,
        confirmedRate: appointments.length > 0 
          ? (appointments.filter(a => a.confirmationStatus === 'confirmed').length / appointments.length) * 100 
          : 0
      }
    });
  } catch (error) {
    console.error('Get patient error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ CREATE PATIENT (with duplicate check) ============
router.post('/patients', protect, async (req, res) => {
  const { name, email, phone, dateOfBirth, gender, address, notes } = req.body;
  
  try {
    // Check for duplicate by email OR phone
    const existingPatient = await Patient.findOne({
      userId: req.user._id,
      $or: [
        { email: email.toLowerCase() },
        { phone: phone }
      ]
    });
    
    if (existingPatient) {
      return res.status(400).json({
        success: false,
        message: `A patient already exists with this ${existingPatient.email === email.toLowerCase() ? 'email' : 'phone number'}`,
        existingPatient: {
          id: existingPatient._id,
          name: existingPatient.name,
          email: existingPatient.email,
          phone: existingPatient.phone
        }
      });
    }
    
    const patient = await Patient.create({
      userId: req.user._id,
      name,
      email: email.toLowerCase(),
      phone,
      dateOfBirth: dateOfBirth || '',
      gender: gender || '',
      address: address || '',
      notes: notes || '',
      status: 'active'
    });
    
    res.status(201).json({ success: true, patient });
  } catch (error) {
    console.error('Create patient error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ UPDATE PATIENT ============
router.put('/patients/:id', protect, async (req, res) => {
  const { name, email, phone, dateOfBirth, gender, address, notes, status } = req.body;
  
  try {
    // Check for duplicate with other patients
    const existingPatient = await Patient.findOne({
      userId: req.user._id,
      _id: { $ne: req.params.id },
      $or: [
        { email: email.toLowerCase() },
        { phone: phone }
      ]
    });
    
    if (existingPatient) {
      return res.status(400).json({
        success: false,
        message: `Another patient already exists with this ${existingPatient.email === email.toLowerCase() ? 'email' : 'phone number'}`
      });
    }
    
    const patient = await Patient.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { name, email: email.toLowerCase(), phone, dateOfBirth, gender, address, notes, status, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );
    
    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found' });
    }
    
    res.json({ success: true, patient });
  } catch (error) {
    console.error('Update patient error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ DELETE PATIENT ============
router.delete('/patients/:id', protect, async (req, res) => {
  try {
    // First check if patient has appointments
    const appointments = await Appointment.find({ patientId: req.params.id, userId: req.user._id });
    
    if (appointments.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete patient. This patient has ${appointments.length} appointment(s). Please reassign or delete appointments first.`
      });
    }
    
    const patient = await Patient.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    
    if (!patient) {
      return res.status(404).json({ success: false, message: 'Patient not found' });
    }
    
    res.json({ success: true, message: 'Patient deleted successfully' });
  } catch (error) {
    console.error('Delete patient error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ MERGE DUPLICATE PATIENTS ============
router.post('/patients/merge', protect, async (req, res) => {
  const { primaryId, duplicateId } = req.body;
  
  try {
    // Move all appointments from duplicate to primary
    await Appointment.updateMany(
      { patientId: duplicateId, userId: req.user._id },
      { patientId: primaryId }
    );
    
    // Delete duplicate patient
    await Patient.findOneAndDelete({ _id: duplicateId, userId: req.user._id });
    
    res.json({ success: true, message: 'Patients merged successfully' });
  } catch (error) {
    console.error('Merge patients error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;