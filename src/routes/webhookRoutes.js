// src/routes/trackingRoutes.js — Tracking Routes (Express.js)

const express = require('express');
const router = express.Router();
const ReminderLog = require('../models/ReminderLog');

// ============ TRACKING PIXEL ============
router.get('/pixel/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // ✅ Find and update log
    const log = await ReminderLog.findOne({ trackingToken: token });
    
    if (log) {
      // ✅ Update open tracking
      log.opened = true;
      log.openedAt = new Date();
      log.openedCount = (log.openedCount || 0) + 1;
      log.emailStatus = 'opened';
      await log.save();
      
      console.log(`✅ Pixel tracked for token: ${token}`);
    }

    // ✅ Return 1x1 transparent pixel
    const pixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.send(pixel);
  } catch (error) {
    console.error('❌ Tracking pixel error:', error);
    // Return empty pixel on error
    const pixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    res.setHeader('Content-Type', 'image/png');
    res.send(pixel);
  }
});

// ============ TRACKING CLICK ============
router.get('/click', async (req, res) => {
  try {
    const { tracking, action } = req.query;

    if (!tracking) {
      return res.redirect('/');
    }

    // ✅ Find and update log
    const log = await ReminderLog.findOne({ trackingToken: tracking });
    const Appointment = require('../models/Appointment');
    
    if (log) {
      log.clicked = true;
      log.clickedAt = new Date();
      log.clickedCount = (log.clickedCount || 0) + 1;
      log.clickedAction = action || 'unknown';
      log.emailStatus = 'clicked';
      await log.save();

      console.log(`✅ Click tracked for token: ${tracking}, action: ${action}`);

      // ✅ Redirect based on action
      if (action === 'confirm') {
        const appointment = await Appointment.findById(log.appointmentId);
        if (appointment) {
          appointment.confirmationStatus = 'confirmed';
          appointment.status = 'confirmed';
          await appointment.save();
          return res.redirect(`/confirm/success/${appointment.confirmationToken}`);
        }
      } else if (action === 'cancel') {
        const appointment = await Appointment.findById(log.appointmentId);
        if (appointment) {
          appointment.confirmationStatus = 'cancelled';
          appointment.status = 'cancelled';
          await appointment.save();
          return res.redirect(`/cancel/success/${appointment.cancellationToken}`);
        }
      }
    }

    res.redirect('/');
  } catch (error) {
    console.error('❌ Tracking click error:', error);
    res.redirect('/');
  }
});

module.exports = router;