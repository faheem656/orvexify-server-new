/**
 * DROP-IN: src/routes/reminderRoutes.js
 *
 * server.js:
 *   const reminderRoutes = require('./src/routes/reminderRoutes');
 *   app.use('/api', reminderRoutes);
 *
 * GET /api/reminder-settings
 * PUT /api/reminder-settings
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getReminderSettings,
  updateReminderSettings,
} = require('../controllers/reminder.controller');

router.get('/reminder-settings', protect, getReminderSettings);
router.put('/reminder-settings', protect, updateReminderSettings);

module.exports = router;
