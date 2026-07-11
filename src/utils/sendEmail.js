// src/utils/sendEmail.js — Add tracking

const crypto = require('crypto');
const { sendEmail } = require('../config/email');
const ReminderLog = require('../models/ReminderLog');

// Generate tracking token
const generateTrackingToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Send reminder email with tracking
const sendReminderEmail = async (appointment, patient, doctor, clinic, reminderType, logId) => {
  const clinicName = clinic.clinicName || 'Clinic';
  const doctorName = doctor?.name || 'Doctor';
  
  // Generate tracking token for this email
  const trackingToken = generateTrackingToken();
  
  // Tracking pixel URL (for open tracking)
  const trackingPixelUrl = `${process.env.FRONTEND_URL}/api/track/open/${trackingToken}`;
  
  // Confirm and cancel links with tracking
  const confirmLink = `${process.env.FRONTEND_URL}/confirm/${appointment.confirmationToken}?track=${trackingToken}`;
  const cancelLink = `${process.env.FRONTEND_URL}/cancel/${appointment.cancellationToken}?track=${trackingToken}`;
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Appointment Reminder</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 500px; margin: 0 auto; background: #ffffff; }
        .header { background: linear-gradient(135deg, #3b82f6, #06b6d4); padding: 30px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 24px; }
        .content { padding: 30px; background: #f8fafc; }
        .details { background: white; padding: 20px; border-radius: 10px; margin: 20px 0; border: 1px solid #e2e8f0; }
        .button { display: inline-block; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500; margin: 8px; }
        .btn-confirm { background: #22c55e; color: white; }
        .btn-cancel { background: #ef4444; color: white; }
        .btn-confirm:hover { background: #16a34a; }
        .btn-cancel:hover { background: #dc2626; }
        .footer { text-align: center; padding: 20px; color: #94a3b8; font-size: 12px; }
        .footer a { color: #3b82f6; text-decoration: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${clinicName}</h1>
        </div>
        <div class="content">
          <h2>Dear ${patient.name},</h2>
          <p>This is a reminder for your upcoming appointment.</p>
          <div class="details">
            <p><strong>📅 Date:</strong> ${appointment.appointmentDate}</p>
            <p><strong>⏰ Time:</strong> ${appointment.appointmentTime}</p>
            <p><strong>👨‍⚕️ Doctor:</strong> ${doctorName}</p>
          </div>
          <p style="text-align: center;">
            <a href="${confirmLink}" class="button btn-confirm">✅ Confirm Appointment</a>
            <a href="${cancelLink}" class="button btn-cancel">❌ Cancel Appointment</a>
          </p>
          <p style="font-size: 12px; color: #64748b;">If you have any questions, please contact the clinic directly.</p>
        </div>
        <div class="footer">
          <p>&copy; 2024 Orvexify. All rights reserved.</p>
          <p><a href="${process.env.FRONTEND_URL}/privacy">Privacy Policy</a></p>
        </div>
      </div>
      <!-- Tracking Pixel -->
      <img src="${trackingPixelUrl}" alt="" style="display:none;" width="1" height="1" />
    </body>
    </html>
  `;
  
  // Update log with tracking token
  await ReminderLog.findByIdAndUpdate(logId, {
    trackingToken: trackingToken
  });
  
  return await sendEmail(patient.email, `Appointment Reminder - ${clinicName}`, html);
};





const sendBookingConfirmation = async (to, name, date, time, clinicName) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Appointment Confirmed</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 500px; margin: 0 auto; background: #ffffff; }
        .header { background: linear-gradient(135deg, #3b82f6, #06b6d4); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { color: white; margin: 0; font-size: 24px; }
        .content { padding: 30px; background: #f8fafc; border-radius: 0 0 10px 10px; }
        .details { background: white; padding: 20px; border-radius: 10px; margin: 20px 0; border: 1px solid #e2e8f0; }
        .footer { text-align: center; padding: 20px; color: #94a3b8; font-size: 12px; }
        .btn { display: inline-block; padding: 10px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${clinicName || 'Orvexify'}</h1>
        </div>
        <div class="content">
          <h2>Hello ${name},</h2>
          <p>Your appointment has been successfully booked.</p>
          <div class="details">
            <p><strong>📅 Date:</strong> ${date}</p>
            <p><strong>⏰ Time:</strong> ${time}</p>
          </div>
          <p>You will receive a reminder 24 hours before your appointment.</p>
          <p style="margin-top: 20px; font-size: 14px;">Thank you for choosing us!</p>
        </div>
        <div class="footer">
          <p>&copy; 2024 Orvexify. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail(to, 'Appointment Confirmed - Orvexify', html);
};



// ✅ ============ SEND WELCOME EMAIL ============
const sendWelcomeEmail = async (to, name) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Welcome to Orvexify</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 500px; margin: 0 auto; background: #ffffff; }
        .header { background: linear-gradient(135deg, #3b82f6, #06b6d4); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .header h1 { color: white; margin: 0; font-size: 24px; }
        .content { padding: 30px; background: #f8fafc; border-radius: 0 0 10px 10px; }
        .footer { text-align: center; padding: 20px; color: #94a3b8; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Welcome to Orvexify!</h1>
        </div>
        <div class="content">
          <h2>Hello ${name},</h2>
          <p>Thank you for registering with Orvexify.</p>
          <p>Your email has been successfully verified.</p>
          <p>You can now start managing your appointments, patients, and reminders.</p>
          <p style="margin-top: 20px;">Best regards,<br><strong>Orvexify Team</strong></p>
        </div>
        <div class="footer">
          <p>&copy; 2024 Orvexify. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail(to, 'Welcome to Orvexify!', html);
};


module.exports = { 
  sendWelcomeEmail,
  sendEmail: sendEmail,
  sendBookingConfirmation,  // ✅ ADD THIS
  sendReminderEmail
};
