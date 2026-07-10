// src/routes/settingsRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const User = require('../models/User');
const ClinicSettings = require('../models/ClinicSettings');
const defaultTemplates = require('../utils/defaultTemplates');

// ============ GET ALL SETTINGS ============
router.get('/settings', protect, async (req, res) => {
  try {
    // Get user settings
    const user = await User.findById(req.user._id).select('-passwordHash');
    
    // Get clinic settings
    let clinicSettings = await ClinicSettings.findOne({ userId: req.user._id });
    
    // Create default settings if not exists
    if (!clinicSettings) {
      clinicSettings = await ClinicSettings.create({
        userId: req.user._id,
        reminderSettings: {
          enable24hReminder: true,
          enable2hReminder: true,
          enableCancellationEmail: true,
          sendRemindersOnWeekends: true,
          defaultReminderHours: { firstReminder: 24, secondReminder: 2 }
        },
        notificationSettings: {
          emailNotifications: true,
          appointmentConfirmedNotify: true,
          appointmentCancelledNotify: true,
          noShowNotify: true,
          dailyDigest: false,
          weeklyReport: true
        },
        emailTemplates: {
          reminder: {
            subject: defaultTemplates.reminder.subject,
            body: defaultTemplates.reminder.body
          },
          confirmation: {
            subject: defaultTemplates.confirmation.subject,
            body: defaultTemplates.confirmation.body
          },
          cancellation: {
            subject: defaultTemplates.cancellation.subject,
            body: defaultTemplates.cancellation.body
          }
        }
      });
    }
    
    res.json({
      success: true,
      data: {
        // General Settings
        clinicName: user.clinicName,
        clinicEmail: user.email,
        clinicPhone: user.clinicPhone || '',
        clinicAddress: user.clinicAddress || '',
        timezone: user.timezone,
        dateFormat: user.dateFormat,
        timeFormat: user.timeFormat,
        bookingSlug: user.bookingSlug,
        
        // Reminder Settings
        reminderSettings: clinicSettings.reminderSettings,
        
        // Notification Settings
        notificationSettings: clinicSettings.notificationSettings,
        
        // Email Templates
        emailTemplates: clinicSettings.emailTemplates
      }
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ UPDATE GENERAL SETTINGS ============
router.put('/settings/general', protect, async (req, res) => {
  const { clinicName, clinicPhone, clinicAddress, timezone, dateFormat, timeFormat } = req.body;
  
  try {
    const user = await User.findById(req.user._id);
    
    if (clinicName) user.clinicName = clinicName;
    if (clinicPhone !== undefined) user.clinicPhone = clinicPhone;
    if (clinicAddress !== undefined) user.clinicAddress = clinicAddress;
    if (timezone) user.timezone = timezone;
    if (dateFormat) user.dateFormat = dateFormat;
    if (timeFormat) user.timeFormat = timeFormat;
    
    await user.save();
    
    res.json({
      success: true,
      message: 'General settings updated successfully',
      data: {
        clinicName: user.clinicName,
        clinicEmail: user.email,
        clinicPhone: user.clinicPhone,
        clinicAddress: user.clinicAddress,
        timezone: user.timezone,
        dateFormat: user.dateFormat,
        timeFormat: user.timeFormat
      }
    });
  } catch (error) {
    console.error('Update general settings error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ UPDATE BOOKING SLUG ============
router.put('/settings/booking-slug', protect, async (req, res) => {
  const { slug } = req.body;
  
  if (!slug || slug.length < 3) {
    return res.status(400).json({
      success: false,
      message: 'Slug must be at least 3 characters'
    });
  }
  
  if (slug.length > 50) {
    return res.status(400).json({
      success: false,
      message: 'Slug must be less than 50 characters'
    });
  }
  
  // Check if slug contains only valid characters
  const validSlugRegex = /^[a-z0-9-]+$/;
  if (!validSlugRegex.test(slug)) {
    return res.status(400).json({
      success: false,
      message: 'Slug can only contain lowercase letters, numbers, and hyphens'
    });
  }
  
  try {
    // Check if slug is already taken by another user
    const existingUser = await User.findOne({ 
      bookingSlug: slug, 
      _id: { $ne: req.user._id } 
    });
    
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'This booking URL is already taken. Please choose another one.'
      });
    }
    
    const user = await User.findById(req.user._id);
    user.bookingSlug = slug;
    await user.save();
    
    res.json({
      success: true,
      message: 'Booking URL updated successfully',
      data: { bookingSlug: slug }
    });
  } catch (error) {
    console.error('Update booking slug error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ UPDATE REMINDER SETTINGS ============
router.put('/settings/reminders', protect, async (req, res) => {
  const { enable24hReminder, enable2hReminder, enableCancellationEmail, sendRemindersOnWeekends, defaultReminderHours } = req.body;
  
  try {
    let settings = await ClinicSettings.findOne({ userId: req.user._id });
    
    if (!settings) {
      settings = new ClinicSettings({ userId: req.user._id });
    }
    
    if (typeof enable24hReminder === 'boolean') settings.reminderSettings.enable24hReminder = enable24hReminder;
    if (typeof enable2hReminder === 'boolean') settings.reminderSettings.enable2hReminder = enable2hReminder;
    if (typeof enableCancellationEmail === 'boolean') settings.reminderSettings.enableCancellationEmail = enableCancellationEmail;
    if (typeof sendRemindersOnWeekends === 'boolean') settings.reminderSettings.sendRemindersOnWeekends = sendRemindersOnWeekends;
    if (defaultReminderHours) {
      if (defaultReminderHours.firstReminder) settings.reminderSettings.defaultReminderHours.firstReminder = defaultReminderHours.firstReminder;
      if (defaultReminderHours.secondReminder) settings.reminderSettings.defaultReminderHours.secondReminder = defaultReminderHours.secondReminder;
    }
    
    await settings.save();
    
    res.json({
      success: true,
      message: 'Reminder settings updated successfully',
      data: settings.reminderSettings
    });
  } catch (error) {
    console.error('Update reminder settings error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ UPDATE NOTIFICATION SETTINGS ============
router.put('/settings/notifications', protect, async (req, res) => {
  const { emailNotifications, appointmentConfirmedNotify, appointmentCancelledNotify, noShowNotify, dailyDigest, weeklyReport } = req.body;
  
  try {
    let settings = await ClinicSettings.findOne({ userId: req.user._id });
    
    if (!settings) {
      settings = new ClinicSettings({ userId: req.user._id });
    }
    
    if (typeof emailNotifications === 'boolean') settings.notificationSettings.emailNotifications = emailNotifications;
    if (typeof appointmentConfirmedNotify === 'boolean') settings.notificationSettings.appointmentConfirmedNotify = appointmentConfirmedNotify;
    if (typeof appointmentCancelledNotify === 'boolean') settings.notificationSettings.appointmentCancelledNotify = appointmentCancelledNotify;
    if (typeof noShowNotify === 'boolean') settings.notificationSettings.noShowNotify = noShowNotify;
    if (typeof dailyDigest === 'boolean') settings.notificationSettings.dailyDigest = dailyDigest;
    if (typeof weeklyReport === 'boolean') settings.notificationSettings.weeklyReport = weeklyReport;
    
    await settings.save();
    
    res.json({
      success: true,
      message: 'Notification settings updated successfully',
      data: settings.notificationSettings
    });
  } catch (error) {
    console.error('Update notification settings error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ UPDATE EMAIL TEMPLATE ============
router.put('/settings/templates/:type', protect, async (req, res) => {
  const { type } = req.params;
  const { subject, body } = req.body;
  
  if (!['reminder', 'confirmation', 'cancellation'].includes(type)) {
    return res.status(400).json({ success: false, message: 'Invalid template type' });
  }
  
  try {
    let settings = await ClinicSettings.findOne({ userId: req.user._id });
    
    if (!settings) {
      settings = new ClinicSettings({ userId: req.user._id });
    }
    
    settings.emailTemplates[type] = { subject, body };
    await settings.save();
    
    res.json({
      success: true,
      message: `${type} template updated successfully`,
      data: settings.emailTemplates[type]
    });
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ============ RESET EMAIL TEMPLATE ============
router.post('/settings/templates/:type/reset', protect, async (req, res) => {
  const { type } = req.params;
  
  if (!['reminder', 'confirmation', 'cancellation'].includes(type)) {
    return res.status(400).json({ success: false, message: 'Invalid template type' });
  }
  
  try {
    let settings = await ClinicSettings.findOne({ userId: req.user._id });
    
    if (!settings) {
      settings = new ClinicSettings({ userId: req.user._id });
    }
    
    settings.emailTemplates[type] = {
      subject: defaultTemplates[type].subject,
      body: defaultTemplates[type].body
    };
    await settings.save();
    
    res.json({
      success: true,
      message: `${type} template reset to default`,
      data: settings.emailTemplates[type]
    });
  } catch (error) {
    console.error('Reset template error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;