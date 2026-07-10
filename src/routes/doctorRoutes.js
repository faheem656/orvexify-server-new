// src/routes/doctorRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Doctor = require('../models/Doctor');

// ============ GET ALL DOCTORS ============
router.get('/doctors', protect, async (req, res) => {
  try {
    const doctors = await Doctor.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, doctors });
  } catch (error) {
    console.error('Get doctors error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ GET SINGLE DOCTOR ============
router.get('/doctors/:id', protect, async (req, res) => {
  try {
    const doctor = await Doctor.findOne({ _id: req.params.id, userId: req.user._id });
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }
    res.json({ success: true, doctor });
  } catch (error) {
    console.error('Get doctor error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ CREATE DOCTOR ============
router.post('/doctors', protect, async (req, res) => {
  try {
    const doctorData = { ...req.body, userId: req.user._id };
    const doctor = await Doctor.create(doctorData);
    res.status(201).json({ success: true, doctor });
  } catch (error) {
    console.error('Create doctor error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ UPDATE DOCTOR ============
router.put('/doctors/:id', protect, async (req, res) => {
  try {
    const doctor = await Doctor.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { ...req.body, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }
    res.json({ success: true, doctor });
  } catch (error) {
    console.error('Update doctor error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ DELETE DOCTOR ============
router.delete('/doctors/:id', protect, async (req, res) => {
  try {
    const doctor = await Doctor.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }
    res.json({ success: true, message: 'Doctor deleted successfully' });
  } catch (error) {
    console.error('Delete doctor error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;