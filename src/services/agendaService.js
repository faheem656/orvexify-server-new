// src/services/agendaService.js

const Agenda = require('agenda');  // Agenda 4.x ke liye

const agenda = new Agenda({
  db: {
    address: process.env.MONGODB_URI,
    collection: 'agendaJobs'
  },
  processEvery: '30 seconds',
});

// ✅ Define jobs
agenda.define('send-24h-reminder', async (job) => {
  console.log(`📧 [24h] Job triggered for ${job.attrs.data.appointmentId}`);
});

agenda.define('send-2h-reminder', async (job) => {
  console.log(`📧 [2h] Job triggered for ${job.attrs.data.appointmentId}`);
});

agenda.define('send-30min-reminder', async (job) => {
  console.log(`📧 [30min] Job triggered for ${job.attrs.data.appointmentId}`);
});

// ✅ Start Agenda
agenda.on('ready', () => {
  console.log('✅ Agenda started successfully!');
});

agenda.on('error', (error) => {
  console.error('❌ Agenda error:', error);
});

agenda.start();

console.log('🚀 Agenda service loaded');

module.exports = { agenda };