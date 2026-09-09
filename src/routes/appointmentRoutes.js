/**
 * DROP-IN overwrite: src/routes/appointmentRoutes.js
 *
 * server.js:
 *   app.use('/api', require('./src/routes/appointmentRoutes'));
 *
 * Order matters: /appointments/available-slots BEFORE /appointments/:id
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

router.get('/appointments', protect, getAppointments);
router.post('/appointments/available-slots', protect, getAvailableSlots);
router.get('/appointments/:id', protect, getAppointmentById);
router.post('/appointments', protect, assertCanAddAppointment, createAppointment);
router.put('/appointments/:id', protect, updateAppointment);
router.delete('/appointments/:id', protect, deleteAppointment);
router.post('/appointments/:id/resend', protect, resendReminder);

router.post('/confirm/:token', confirmByToken);
router.post('/cancel/:token', cancelByToken);
router.get('/details/:token', getDetailsByToken);
router.get('/status/:token', getStatusByToken);

module.exports = router;
