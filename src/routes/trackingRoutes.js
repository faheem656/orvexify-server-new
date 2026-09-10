/** DROP-IN: src/routes/trackingRoutes.js
 *
 * server.js (already):
 *   const trackingRoutes = require('./src/routes/trackingRoutes');
 *   app.use('/api/tracking', trackingRoutes);
 *
 * GET /api/tracking/pixel/:token
 * GET /api/tracking/click
 * GET /api/tracking/test/:token
 * GET /api/tracking/test-open/:token
 */

const express = require('express');
const router = express.Router();
const {
  trackPixel,
  trackClick,
  testTracking,
  testOpen,
} = require('../controllers/tracking.controller');

router.get('/pixel/:token', trackPixel);
router.get('/click', trackClick);
router.get('/test/:token', testTracking);
router.get('/test-open/:token', testOpen);

module.exports = router;
