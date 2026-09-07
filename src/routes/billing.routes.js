/**
 * DROP-IN: src/routes/billing.routes.js
 *
 * server.js (tumhara /api prefix):
 *
 *   const billingRoutes = require('./src/routes/billing.routes');
 *   const { stripeWebhook } = require('./src/controllers/billing.controller');
 *
 *   app.post(
 *     '/api/billing/webhook',
 *     express.raw({ type: 'application/json' }),
 *     stripeWebhook
 *   );
 *   // … cors + express.json() …
 *   app.use('/api/billing', billingRoutes);
 */

const express = require('express');
const {
  getBilling,
  getPlans,
  postWaitlist,
  deleteWaitlist,
  postCancel,
  postSubscribe,
  postPortal,
  postCard,
  getInvoices,
  getInvoiceById,
} = require('../controllers/billing.controller');

let protect;
try {
  ({ protect } = require('../middleware/auth'));
} catch {
  try {
    ({ protect } = require('../middleware/authMiddleware'));
  } catch {
    ({ protect } = require('../middlewares/auth'));
  }
}

const router = express.Router();

router.use(protect);

router.get('/', getBilling);
router.get('/plans', getPlans);
router.get('/invoices', getInvoices);
router.get('/invoices/:id', getInvoiceById);
router.post('/waitlist', postWaitlist);
router.delete('/waitlist', deleteWaitlist);
router.post('/subscribe', postSubscribe);
router.post('/portal', postPortal);
router.post('/cancel', postCancel);

module.exports = router;
