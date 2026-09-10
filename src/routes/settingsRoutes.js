/**
 * DROP-IN: src/routes/settingsRoutes.js
 *
 * server.js (pehle se /api pe mount):
 *
 *   const settingsRoutes = require('./src/routes/settingsRoutes');
 *   app.use('/api', settingsRoutes);
 *
 * Frontend Save clinic → PUT /api/settings/general  (PUT /api/settings bhi alias)
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getSettings,
  updateGeneralSettings,
  updateBookingSlug,
  updateReminderSettings,
  updateNotificationSettings,
  updateEmailTemplate,
  resetEmailTemplate,
} = require('../controllers/settings.controller');

router.get('/settings', protect, getSettings);
router.put('/settings', protect, updateGeneralSettings);
router.put('/settings/general', protect, updateGeneralSettings);
router.put('/settings/booking-slug', protect, updateBookingSlug);
router.put('/settings/reminders', protect, updateReminderSettings);
router.put('/settings/notifications', protect, updateNotificationSettings);
router.put('/settings/templates/:type', protect, updateEmailTemplate);
router.post('/settings/templates/:type/reset', protect, resetEmailTemplate);

module.exports = router;
