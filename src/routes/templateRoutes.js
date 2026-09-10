/**
 * DROP-IN: src/routes/templateRoutes.js
 *
 * server.js:
 *   const templateRoutes = require('./src/routes/templateRoutes');
 *   app.use('/api', templateRoutes);
 *
 * GET  /api/templates
 * PUT  /api/templates/:type
 * POST /api/templates/:type/reset
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getTemplates,
  updateTemplate,
  resetTemplate,
} = require('../controllers/template.controller');

router.get('/templates', protect, getTemplates);
router.put('/templates/:type', protect, updateTemplate);
router.post('/templates/:type/reset', protect, resetTemplate);

module.exports = router;
