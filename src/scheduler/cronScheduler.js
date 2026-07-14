// src/scheduler/cronScheduler.js — Create this file

const cron = require('node-cron');
const {
  scheduleNewAppointments,
  recoverMissedJobs,
} = require('../queues/backupQueue');

// ✅ Schedule new appointments (every 2 minutes)
cron.schedule('*/2 * * * *', () => {
  console.log('🕐 Running schedule...');
  scheduleNewAppointments();
});

// ✅ Recovery check (every 5 minutes)
cron.schedule('*/5 * * * *', () => {
  console.log('🕐 Running recovery...');
  recoverMissedJobs();
});

// ✅ Run on startup
setTimeout(() => {
  console.log('🔄 Initial recovery on startup...');
  recoverMissedJobs();
}, 5000);

console.log('✅ Cron scheduler started:');
console.log('  - Schedule: Every 2 minutes');
console.log('  - Recovery: Every 5 minutes');

module.exports = {
  scheduleNewAppointments,
  recoverMissedJobs,
};