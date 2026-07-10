// src/routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const NotificationSettings = require('../models/NotificationSettings');

// ============ GET NOTIFICATION SETTINGS ============
router.get('/notification-settings', protect, async (req, res) => {
  try {
    let settings = await NotificationSettings.findOne({ userId: req.user._id });
    
    // If no settings exist, create default
    if (!settings) {
      settings = await NotificationSettings.create({
        userId: req.user._id,
        emailNotifications: true,
        appointmentConfirmedNotify: true,
        appointmentCancelledNotify: true,
        noShowNotify: true,
        dailyDigest: false,
        weeklyReport: true
      });
    }
    
    res.json({
      success: true,
      settings: {
        emailNotifications: settings.emailNotifications,
        appointmentConfirmedNotify: settings.appointmentConfirmedNotify,
        appointmentCancelledNotify: settings.appointmentCancelledNotify,
        noShowNotify: settings.noShowNotify,
        dailyDigest: settings.dailyDigest,
        weeklyReport: settings.weeklyReport
      }
    });
  } catch (error) {
    console.error('Get notification settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// ============ UPDATE NOTIFICATION SETTINGS ============
router.put('/notification-settings', protect, async (req, res) => {
  const {
    emailNotifications,
    appointmentConfirmedNotify,
    appointmentCancelledNotify,
    noShowNotify,
    dailyDigest,
    weeklyReport
  } = req.body;
  
  try {
    let settings = await NotificationSettings.findOne({ userId: req.user._id });
    
    if (settings) {
      // Update existing
      if (typeof emailNotifications === 'boolean') settings.emailNotifications = emailNotifications;
      if (typeof appointmentConfirmedNotify === 'boolean') settings.appointmentConfirmedNotify = appointmentConfirmedNotify;
      if (typeof appointmentCancelledNotify === 'boolean') settings.appointmentCancelledNotify = appointmentCancelledNotify;
      if (typeof noShowNotify === 'boolean') settings.noShowNotify = noShowNotify;
      if (typeof dailyDigest === 'boolean') settings.dailyDigest = dailyDigest;
      if (typeof weeklyReport === 'boolean') settings.weeklyReport = weeklyReport;
      await settings.save();
    } else {
      // Create new
      settings = await NotificationSettings.create({
        userId: req.user._id,
        emailNotifications: emailNotifications ?? true,
        appointmentConfirmedNotify: appointmentConfirmedNotify ?? true,
        appointmentCancelledNotify: appointmentCancelledNotify ?? true,
        noShowNotify: noShowNotify ?? true,
        dailyDigest: dailyDigest ?? false,
        weeklyReport: weeklyReport ?? true
      });
    }
    
    res.json({
      success: true,
      message: 'Notification settings updated successfully',
      settings: {
        emailNotifications: settings.emailNotifications,
        appointmentConfirmedNotify: settings.appointmentConfirmedNotify,
        appointmentCancelledNotify: settings.appointmentCancelledNotify,
        noShowNotify: settings.noShowNotify,
        dailyDigest: settings.dailyDigest,
        weeklyReport: settings.weeklyReport
      }
    });
  } catch (error) {
    console.error('Update notification settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;