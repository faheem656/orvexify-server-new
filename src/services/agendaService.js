// src/services/agendaService.js — Complete Working

const Agenda = require('agenda');

console.log('📋 MONGO_URI:', process.env.MONGODB_URI ? '✅ Set' : '❌ Not set');

const agenda = new Agenda({
  db: {
    address: process.env.MONGODB_URI,
    collection: 'agendaJobs'
  },
  processEvery: '30 seconds',
  defaultConcurrency: 5,
  maxConcurrency: 10,
  defaultLockLimit: 1,
  defaultLockLifetime: 10000,
});

// ============ AGENDA EVENTS ============

agenda.on('ready', () => {
  console.log('✅ Agenda ready! Worker is starting...');
  
  // ✅ Force process to start
  agenda.start().then(() => {
    console.log('✅ Agenda worker started successfully!');
    console.log('⏰ Will check jobs every 30 seconds');
  }).catch(err => {
    console.error('❌ Agenda worker start failed:', err);
  });
});

agenda.on('error', (error) => {
  console.error('❌ Agenda error:', error);
});

agenda.on('start', (job) => {
  console.log(`🔄 [DEBUG] Job started: ${job.attrs.name}`);
});

agenda.on('success', (job) => {
  console.log(`✅ [DEBUG] Job completed: ${job.attrs.name}`);
});

agenda.on('fail', (error, job) => {
  console.error(`❌ [DEBUG] Job failed: ${job.attrs.name}`, error.message);
});

// ============ DEFINE JOBS ============

agenda.define('send-24h-reminder', async (job) => {
  const { appointmentId } = job.attrs.data;
  console.log(`📧 [24h] Sending for ${appointmentId} at ${new Date().toISOString()}`);
  // Your logic here
});

agenda.define('send-2h-reminder', async (job) => {
  const { appointmentId } = job.attrs.data;
  console.log(`📧 [2h] Sending for ${appointmentId} at ${new Date().toISOString()}`);
  // Your logic here
});

agenda.define('send-30min-reminder', async (job) => {
  const { appointmentId } = job.attrs.data;
  console.log(`📧 [30min] Sending for ${appointmentId} at ${new Date().toISOString()}`);
  // Your logic here
});

// ============ CHECK JOBS ============

const checkJobs = async () => {
  try {
    const jobs = await agenda.jobs({});
    console.log(`📋 Total jobs in Agenda: ${jobs.length}`);
    
    for (const job of jobs) {
      console.log(`  - ${job.attrs.name} → ${job.attrs.data.appointmentId} at ${job.attrs.nextRunAt}`);
    }
  } catch (error) {
    console.error('❌ Error checking jobs:', error);
  }
};

// ✅ Check every 10 seconds for debugging
setInterval(checkJobs, 10000);

// ============ TEST JOB ============

// ✅ Schedule a test job after 30 seconds
setTimeout(async () => {
  try {
    const testJob = await agenda.schedule(
      new Date(Date.now() + 30000),
      'send-24h-reminder',
      { appointmentId: 'test-123' }
    );
    console.log('✅ Test job scheduled for 30 seconds from now');
  } catch (error) {
    console.error('❌ Failed to schedule test job:', error);
  }
}, 5000);

// ============ START AGENDA ============

console.log('🚀 Agenda service loading...');

// ✅ Start agenda directly
agenda.start()
  .then(() => {
    console.log('✅ Agenda start() called successfully');
  })
  .catch((error) => {
    console.error('❌ Agenda start() failed:', error);
  });

console.log('🚀 Agenda service loaded');

module.exports = { agenda, checkJobs };