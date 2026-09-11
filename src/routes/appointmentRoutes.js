/**
 * DROP-IN overwrite: src/routes/appointmentRoutes.js
 *
 * server.js:
 *   app.use('/api', require('./src/routes/appointmentRoutes'));
 *
 * Public (email links):
 *   POST /api/confirm/:token
 *   POST /api/cancel/:token
 *   GET  /api/details/:token
 *   GET  /api/status/:token
 * Aliases (same handlers):
 *   POST /api/appointments/confirm/:token
 *   POST /api/appointments/cancel/:token
 *   GET  /api/appointments/details/:token
 *   GET  /api/appointments/status/:token
 *
 * Order: available-slots + public token routes BEFORE /appointments/:id
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { assertCanAddAppointment } = require('../middleware/planLimits');
const {
  getAppointments,
  getAppointmentById,
  getAvailableSlots,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  resendReminder,
  confirmByToken,
  cancelByToken,
  getDetailsByToken,
  getStatusByToken,
} = require('../controllers/appointment.controller');

router.post('/confirm/:token', confirmByToken);
router.post('/cancel/:token', cancelByToken);
router.get('/details/:token', getDetailsByToken);
router.get('/status/:token', getStatusByToken);

router.get('/appointments', protect, getAppointments);
router.post('/appointments/available-slots', protect, getAvailableSlots);
router.post('/appointments/confirm/:token', confirmByToken);
router.post('/appointments/cancel/:token', cancelByToken);
router.get('/appointments/details/:token', getDetailsByToken);
router.get('/appointments/status/:token', getStatusByToken);
router.get('/appointments/:id', protect, getAppointmentById);
router.post('/appointments', protect, assertCanAddAppointment, createAppointment);
router.put('/appointments/:id', protect, updateAppointment);
router.delete('/appointments/:id', protect, deleteAppointment);
router.post('/appointments/:id/resend', protect, resendReminder);

module.exports = router;
