// src/routes/trackingRoutes.js — Complete Tracking Routes

const express = require('express');
const router = express.Router();
const Appointment = require('../models/Appointment');
const ReminderLog = require('../models/ReminderLog');

// ============ TRACKING PIXEL (Email Open) ============
router.get('/pixel/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    console.log(`📊 Tracking pixel hit for token: ${token}`);

    if (!token) {
      console.log('❌ No tracking token provided');
      return sendPixel(res);
    }

    // ✅ Find log by tracking token
    const log = await ReminderLog.findOne({ trackingToken: token });
    
    if (!log) {
      console.log(`❌ No log found for token: ${token}`);
      return sendPixel(res);
    }

    // ✅ Update open tracking
    log.opened = true;
    log.openedAt = new Date();
    log.openedCount = (log.openedCount || 0) + 1;
    
    // ✅ Update email status if not already clicked
    if (log.emailStatus !== 'clicked') {
      log.emailStatus = 'opened';
    }
    
    await log.save();
    
    console.log(`✅ Pixel tracked for token: ${token}`);
    console.log(`   - Opened: ${log.opened}`);
    console.log(`   - Opened Count: ${log.openedCount}`);
    console.log(`   - Opened At: ${log.openedAt}`);

    // ✅ Also update appointment if needed
    if (log.appointmentId) {
      const appointment = await Appointment.findById(log.appointmentId);
      if (appointment) {
        // Optional: Track that patient opened email
        // You can add a field like 'emailOpened' if needed
        console.log(`   - Appointment: ${appointment._id}`);
      }
    }

    // ✅ Return 1x1 transparent pixel
    return sendPixel(res);
  } catch (error) {
    console.error('❌ Tracking pixel error:', error);
    return sendPixel(res);
  }
});

// ============ TRACKING CLICK (Confirm/Cancel) ============
router.get('/click', async (req, res) => {
  try {
    const { tracking, action, redirect } = req.query;

    console.log(`📊 Tracking click: tracking=${tracking}, action=${action}`);

    if (!tracking) {
      return res.redirect('/');
    }

    // ✅ Find log by tracking token
    const log = await ReminderLog.findOne({ trackingToken: tracking });
    
    if (log) {
      log.clicked = true;
      log.clickedAt = new Date();
      log.clickedCount = (log.clickedCount || 0) + 1;
      log.clickedAction = action || 'unknown';
      log.emailStatus = 'clicked';
      await log.save();

      console.log(`✅ Click tracked for token: ${tracking}`);

      // ✅ Process action
      if (action === 'confirm') {
        const appointment = await Appointment.findById(log.appointmentId);
        if (appointment) {
          // ✅ Update appointment status
          appointment.confirmationStatus = 'confirmed';
          appointment.status = 'confirmed';
          await appointment.save();
          console.log(`✅ Appointment confirmed: ${appointment._id}`);
          
          // ✅ Redirect to confirmation success page with token
          const frontendUrl = process.env.FRONTEND_URL  ;
          return res.redirect(`${frontendUrl}/confirm/${appointment.confirmationToken}?tracking=${tracking}&action=confirm&success=true`);
        }
      } else if (action === 'cancel') {
        const appointment = await Appointment.findById(log.appointmentId);
        if (appointment) {
          appointment.confirmationStatus = 'cancelled';
          appointment.status = 'cancelled';
          await appointment.save();
          console.log(`✅ Appointment cancelled: ${appointment._id}`);
          
          // ✅ Redirect to cancellation page
          const frontendUrl = process.env.FRONTEND_URL  ;
          return res.redirect(`${frontendUrl}/cancel/${appointment.cancellationToken}?tracking=${tracking}&action=cancel&success=true`);
        }
      }
    }

    // ✅ Default redirect
    const frontendUrl = process.env.FRONTEND_URL  ;
    return res.redirect(`${frontendUrl}/`);
  } catch (error) {
    console.error('❌ Tracking click error:', error);
    const frontendUrl = process.env.FRONTEND_URL  ;
    return res.redirect(`${frontendUrl}/`);
  }
});


// ============ TEST TRACKING ENDPOINT ============
router.get('/test/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const log = await ReminderLog.findOne({ trackingToken: token });
    
    res.json({
      success: true,
      log: log ? {
        id: log._id,
        trackingToken: log.trackingToken,
        opened: log.opened,
        openedAt: log.openedAt,
        openedCount: log.openedCount,
        clicked: log.clicked,
        clickedAt: log.clickedAt,
        clickedAction: log.clickedAction,
        emailStatus: log.emailStatus
      } : null,
      message: log ? 'Log found' : 'No log found'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ HELPER: Send Pixel ============
function sendPixel(res) {
  // ✅ 1x1 transparent GIF pixel
  const pixel = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
  );
  
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Content-Length', pixel.length);
  res.send(pixel);
}




// ============ TEST TRACKING ============
router.get('/test-open/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // ✅ Find log
    const log = await ReminderLog.findOne({ trackingToken: token });
    
    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'No log found for token: ' + token
      });
    }

    // ✅ Manually mark as opened
    log.opened = true;
    log.openedAt = new Date();
    log.openedCount = (log.openedCount || 0) + 1;
    if (log.emailStatus !== 'clicked') {
      log.emailStatus = 'opened';
    }
    await log.save();

    res.json({
      success: true,
      message: 'Email marked as opened',
      log: {
        id: log._id,
        trackingToken: log.trackingToken,
        opened: log.opened,
        openedAt: log.openedAt,
        openedCount: log.openedCount,
        emailStatus: log.emailStatus
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


module.exports = router;