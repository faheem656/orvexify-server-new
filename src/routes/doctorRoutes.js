/**
 * DROP-IN overwrite: src/routes/doctorRoutes.js
 *
 * server.js:
 *   app.use('/api', require('./src/routes/doctorRoutes'));
 *
 * Order: /doctors before /doctors/:id
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getDoctors,
  getDoctorById,
  createDoctor,
  updateDoctor,
  deleteDoctor,
} = require('../controllers/doctor.controller');

let assertCanAddDoctor = (req, res, next) => next();
try {
  ({ assertCanAddDoctor } = require('../middleware/planLimits'));
} catch {
  console.warn('planLimits missing — doctor POST still checks inside the controller');
}

router.get('/doctors', protect, getDoctors);
router.get('/doctors/:id', protect, getDoctorById);
router.post('/doctors', protect, assertCanAddDoctor, createDoctor);
router.put('/doctors/:id', protect, updateDoctor);
router.delete('/doctors/:id', protect, deleteDoctor);

module.exports = router;
