/**
 * DROP-IN: src/routes/booking.routes.js
 *
 * server.js (tumhara /api prefix):
 *
 *   const bookingRoutes = require('./src/routes/booking.routes');
 *   app.use('/api/booking', bookingRoutes);
 *
 * Purana `bookingRoutes.js` bhi isi file ko re-export karta hai.
 */

const express = require('express');
const {
  getPublicClinic,
  getPublicDoctor,
  getPublicSlots,
  bookPublicAppointment,
} = require('../controllers/booking.controller');

const router = express.Router();

router.get('/clinic/:slug', getPublicClinic);
router.get('/doctor/:doctorId', getPublicDoctor);
router.post('/available-slots', getPublicSlots);
router.post('/book', bookPublicAppointment);

module.exports = router;
