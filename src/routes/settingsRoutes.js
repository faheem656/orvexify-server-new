/** DROP-IN: src/routes/settingsRoutes.js
 *
 * server.js:
 *   const settingsRoutes = require('./src/routes/settingsRoutes');
 *   app.use('/api', settingsRoutes);
 *
 * GET    /api/settings
 * PUT    /api/settings
 * PUT    /api/settings/general
 * PUT    /api/settings/booking-slug
 * POST   /api/settings/logo     multipart field: logo
 * DELETE /api/settings/logo
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getSettings,
  updateGeneralSettings,
  updateBookingSlug,
  uploadClinicLogo,
  removeClinicLogo,
  updateReminderSettings,
  updateNotificationSettings,
  updateEmailTemplate,
  resetEmailTemplate,
} = require('../controllers/settings.controller');

let logoUpload = (req, res, next) => next();
try {
  const multer = require('multer');
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ok =
        file.mimetype === 'image/jpeg' ||
        file.mimetype === 'image/jpg' ||
        file.mimetype === 'image/png' ||
        file.mimetype === 'image/webp' ||
        file.mimetype === 'image/gif';
      if (!ok) return cb(new Error('Use a PNG, JPG, WEBP, or GIF'));
      cb(null, true);
    },
  });
  logoUpload = (req, res, next) => {
    upload.single('logo')(req, res, (err) => {
      if (!err) return next();
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        success: false,
        code: tooBig ? 'LOGO_TOO_LARGE' : 'BAD_LOGO',
        message: tooBig ? 'Logo must be under 2 MB' : err.message || 'Upload failed',
      });
    });
  };
} catch {
  logoUpload = (req, res) =>
    res.status(500).json({
      success: false,
      code: 'MULTER_MISSING',
      message: 'Run npm i multer in the API folder',
    });
}

router.get('/settings', protect, getSettings);
router.put('/settings', protect, updateGeneralSettings);
router.put('/settings/general', protect, updateGeneralSettings);
router.put('/settings/booking-slug', protect, updateBookingSlug);
router.post('/settings/logo', protect, logoUpload, uploadClinicLogo);
router.delete('/settings/logo', protect, removeClinicLogo);
router.put('/settings/reminders', protect, updateReminderSettings);
router.put('/settings/notifications', protect, updateNotificationSettings);
router.put('/settings/templates/:type', protect, updateEmailTemplate);
router.post('/settings/templates/:type/reset', protect, resetEmailTemplate);

module.exports = router;
