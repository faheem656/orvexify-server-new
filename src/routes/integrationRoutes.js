/** DROP-IN: src/routes/integrationRoutes.js
 *
 * server.js (already):
 *   const integrationRoutes = require('./src/routes/integrationRoutes');
 *   app.use('/api', integrationRoutes);
 *
 * GET  /api/integrations/email
 * PUT  /api/integrations/email
 * POST /api/integrations/email/test
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getEmailSettings,
  saveEmailSettings,
  testEmailConnection,
} = require('../controllers/integration.controller');

router.get('/integrations/email', protect, getEmailSettings);
router.put('/integrations/email', protect, saveEmailSettings);
router.post('/integrations/email/test', protect, testEmailConnection);

module.exports = router;
