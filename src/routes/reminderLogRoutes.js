/** DROP-IN: src/routes/reminderLogRoutes.js
 *
 * server.js (already):
 *   const reminderLogRoutes = require('./src/routes/reminderLogRoutes');
 *   app.use('/api', reminderLogRoutes);
 *
 * GET  /api/reminder-logs
 * GET  /api/reminder-logs/export          (before :id)
 * GET  /api/reminder-logs/appointment/:appointmentId
 * GET  /api/reminder-logs/:id
 * PUT  /api/reminder-logs/:id/status
 * POST /api/reminder-logs/:id/opened
 * POST /api/reminder-logs/:id/clicked
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getReminderLogs,
  exportReminderLogs,
  getLogsByAppointment,
  getReminderLogById,
  updateLogStatus,
  markLogOpened,
  markLogClicked,
} = require('../controllers/reminderLog.controller');

router.get('/reminder-logs', protect, getReminderLogs);
router.get('/reminder-logs/export', protect, exportReminderLogs);
router.get(
  '/reminder-logs/appointment/:appointmentId',
  protect,
  getLogsByAppointment
);
router.get('/reminder-logs/:id', protect, getReminderLogById);
router.put('/reminder-logs/:id/status', protect, updateLogStatus);
router.post('/reminder-logs/:id/opened', protect, markLogOpened);
router.post('/reminder-logs/:id/clicked', protect, markLogClicked);

module.exports = router;
