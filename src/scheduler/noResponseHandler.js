// src/scheduler/noResponseHandler.js — Create this file

const cron = require('node-cron');
const moment = require('moment-timezone');
const Appointment = require('../models/Appointment');
const ReminderLog = require('../models/ReminderLog');

// ============ MARK NO RESPONSE ============
const markNoResponseAppointments = async () => {
  console.log('🔄 Checking for no-response appointments...');
  
  try {
    const now = moment();
    const today = now.format('YYYY-MM-DD');
    
    // ✅ Find appointments where:
    // 1. Status is pending
    // 2. Appointment date is today or in past
    // 3. Confirmation status is pending
    const appointments = await Appointment.find({
      confirmationStatus: { $in: ['pending', 'no_response'] },
      status: 'scheduled',
      appointmentDate: { $lte: today }
    });
    
    console.log(`📋 Found ${appointments.length} pending appointments to check`);
    
    let markedCount = 0;
    
    for (const apt of appointments) {
      const timezone = apt.timezone || 'Asia/Karachi';
      const aptTime = moment.tz(
        `${apt.appointmentDate} ${apt.appointmentTime}`,
        'YYYY-MM-DD HH:mm',
        timezone
      );
      
      // ✅ If appointment time has passed
      if (now.isAfter(aptTime)) {
        // ✅ Check if patient responded via logs
        const logs = await ReminderLog.find({
          appointmentId: apt._id,
          clicked: true
        });
        
        // ✅ If no response in logs, mark as no_response
        if (logs.length === 0 || logs.every(l => !l.clicked)) {
          apt.confirmationStatus = 'no_response';
          apt.status = 'no_show';
          await apt.save();
          
          // ✅ Update reminder logs
          await ReminderLog.updateMany(
            { 
              appointmentId: apt._id,
              'status.current': 'pending'
            },
            { 
              $set: { 
                'status.current': 'no_response',
                'status.isPending': false,
                'status.isSent': true,
                'status.isDelivered': true,
                'status.isNoResponse': true,
                'status.isFailed': false,
                'status.isOpened': false,
                'status.isClicked': false
              }
            }
          );
          
          markedCount++;
          console.log(`⏰ Marked no_response: ${apt._id} (${apt.appointmentDate} ${apt.appointmentTime})`);
        }
      }
    }
    
    console.log(`✅ Marked ${markedCount} appointments as no_response`);
  } catch (error) {
    console.error('❌ No-response handler error:', error);
  }
};

// ============ CRON: Run every hour ============
cron.schedule('0 * * * *', markNoResponseAppointments);

// ============ RUN ON STARTUP ============
setTimeout(markNoResponseAppointments, 10000);

console.log('✅ No-response handler started');
console.log('  - Runs: Every hour');
console.log('  - Checks: Past appointments with no response');

module.exports = {
  markNoResponseAppointments
};