/**
 * DROP-IN: src/routes/patientRoutes.js
 *
 * server.js:
 *   const patientRoutes = require('./src/routes/patientRoutes');
 *   app.use('/api', patientRoutes);
 *
 * /patients/merge BEFORE /patients/:id
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getPatients,
  getPatientById,
  createPatient,
  updatePatient,
  deletePatient,
  mergePatients,
} = require('../controllers/patient.controller');

router.get('/patients', protect, getPatients);
router.post('/patients/merge', protect, mergePatients);
router.get('/patients/:id', protect, getPatientById);
router.post('/patients', protect, createPatient);
router.put('/patients/:id', protect, updatePatient);
router.delete('/patients/:id', protect, deletePatient);

module.exports = router;
