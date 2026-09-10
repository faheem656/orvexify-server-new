/**
 * DROP-IN: src/routes/notificationRoutes.js
 *
 * server.js:
 *   const notificationRoutes = require('./src/routes/notificationRoutes');
 *   app.use('/api', notificationRoutes);
 *
 * GET /api/notification-settings
 * PUT /api/notification-settings
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getNotificationSettings,
  updateNotificationSettings,
} = require('../controllers/notification.controller');

router.get('/notification-settings', protect, getNotificationSettings);
router.put('/notification-settings', protect, updateNotificationSettings);

module.exports = router;
