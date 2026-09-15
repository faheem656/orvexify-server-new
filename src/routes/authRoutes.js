/** DROP-IN: src/routes/authRoutes.js
 *
 * Thin file. Handlers: src/controllers/auth.controller.js
 *
 * server.js — same mount, do NOT remount:
 *   const authRoutes = require('./src/routes/authRoutes');
 *   app.use('/api/auth', authRoutes);
 */

const express = require('express');
const { body } = require('express-validator');
const { protect } = require('../middleware/auth');
const {
  register,
  verifyEmail,
  resendVerification,
  login,
  logout,
  logoutAll,
  getSession,
  changePassword,
  enable2FA,
  verify2FA,
  disable2FA,
  get2FAStatus,
  forgotPassword,
  verifyOtp,
  resetPassword,
  resendOtp,
} = require('../controllers/auth.controller');

const router = express.Router();

router.post(
  '/register',
  [
    body('clinicName').notEmpty().withMessage('Clinic name is required'),
    body('fullName').notEmpty().withMessage('Full name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
    body('timezone').optional(),
  ],
  register
);

router.post(
  '/verify-email',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('code')
      .isLength({ min: 6, max: 6 })
      .withMessage('6-digit code is required'),
  ],
  verifyEmail
);

router.post(
  '/resend-verification',
  [body('email').isEmail().withMessage('Valid email is required')],
  resendVerification
);

router.post('/login', login);

router.post('/logout', protect, logout);
router.post('/logout-all', protect, logoutAll);
router.get('/session', protect, getSession);
router.post('/change-password', protect, changePassword);

router.post('/2fa/enable', protect, enable2FA);
router.post('/2fa/verify', protect, verify2FA);
router.post('/2fa/disable', protect, disable2FA);
router.get('/2fa/status', protect, get2FAStatus);

router.post('/forgot-password', forgotPassword);
router.post('/verify-otp', verifyOtp);
router.post('/reset-password', resetPassword);
router.post('/resend-otp', resendOtp);

module.exports = router;
