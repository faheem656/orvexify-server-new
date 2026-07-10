// src/routes/reminderRoutes.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const ReminderSettings = require('../models/ReminderSettings');

// ============ GET REMINDER SETTINGS ============
router.get('/reminder-settings', protect, async (req, res) => {
  try {
    let settings = await ReminderSettings.findOne({ userId: req.user._id });
    
    // If no settings exist, create default
    if (!settings) {
      settings = await ReminderSettings.create({
        userId: req.user._id,
        enable24hReminder: true,
        enable2hReminder: true,
        enableCancellationEmail: true,
        sendRemindersOnWeekends: true,
        defaultReminderHours: {
          firstReminder: 24,
          secondReminder: 2
        }
      });
    }
    
    res.json({
      success: true,
      settings: {
        enable24hReminder: settings.enable24hReminder,
        enable2hReminder: settings.enable2hReminder,
        enableCancellationEmail: settings.enableCancellationEmail,
        sendRemindersOnWeekends: settings.sendRemindersOnWeekends,
        defaultReminderHours: settings.defaultReminderHours
      }
    });
  } catch (error) {
    console.error('Get reminder settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// ============ UPDATE REMINDER SETTINGS ============
router.put('/reminder-settings', protect, async (req, res) => {
  const {
    enable24hReminder,
    enable2hReminder,
    enableCancellationEmail,
    sendRemindersOnWeekends,
    defaultReminderHours
  } = req.body;
  
  try {
    let settings = await ReminderSettings.findOne({ userId: req.user._id });
    
    if (settings) {
      // Update existing
      if (typeof enable24hReminder === 'boolean') settings.enable24hReminder = enable24hReminder;
      if (typeof enable2hReminder === 'boolean') settings.enable2hReminder = enable2hReminder;
      if (typeof enableCancellationEmail === 'boolean') settings.enableCancellationEmail = enableCancellationEmail;
      if (typeof sendRemindersOnWeekends === 'boolean') settings.sendRemindersOnWeekends = sendRemindersOnWeekends;
      if (defaultReminderHours) {
        if (defaultReminderHours.firstReminder) settings.defaultReminderHours.firstReminder = defaultReminderHours.firstReminder;
        if (defaultReminderHours.secondReminder) settings.defaultReminderHours.secondReminder = defaultReminderHours.secondReminder;
      }
      await settings.save();
    } else {
      // Create new
      settings = await ReminderSettings.create({
        userId: req.user._id,
        enable24hReminder: enable24hReminder ?? true,
        enable2hReminder: enable2hReminder ?? true,
        enableCancellationEmail: enableCancellationEmail ?? true,
        sendRemindersOnWeekends: sendRemindersOnWeekends ?? true,
        defaultReminderHours: defaultReminderHours || { firstReminder: 24, secondReminder: 2 }
      });
    }
    
    res.json({
      success: true,
      message: 'Reminder settings updated successfully',
      settings: {
        enable24hReminder: settings.enable24hReminder,
        enable2hReminder: settings.enable2hReminder,
        enableCancellationEmail: settings.enableCancellationEmail,
        sendRemindersOnWeekends: settings.sendRemindersOnWeekends,
        defaultReminderHours: settings.defaultReminderHours
      }
    });
  } catch (error) {
    console.error('Update reminder settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;