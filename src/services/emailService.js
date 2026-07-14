// src/services/emailService.js — Complete Fixed Version

const nodemailer = require("nodemailer");
const crypto = require("crypto");
const User = require("../models/User");
const ReminderLog = require("../models/ReminderLog");
const { decrypt } = require("../utils/encryption");

// ============ GET USER EMAIL SETTINGS ============
const getUserEmailSettings = async (userId) => {
  try {
    const user = await User.findById(userId);

    if (!user) {
      console.log("❌ User not found:", userId);
      return null;
    }

    console.log("📧 User email settings check:");
    console.log("  - smtpHost:", user.smtpHost ? "✅ Set" : "❌ Not set");
    console.log("  - fromEmail:", user.fromEmail ? "✅ Set" : "❌ Not set");
    console.log("  - emailPassword:", user.emailPassword ? "✅ Set" : "❌ Not set");

    if (!user.smtpHost || !user.fromEmail || !user.emailPassword) {
      console.log("⚠️ No SMTP configured, using default settings...");
      
      if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        console.log("✅ Using default email settings from .env");
        return {
          smtpHost: process.env.EMAIL_HOST,
          smtpPort: process.env.EMAIL_PORT || "587",
          fromEmail: process.env.EMAIL_FROM || user.email,
          fromName: user.fromName || user.clinicName || "Clinic",
          password: process.env.EMAIL_PASS,
          useTLS: true,
          useSSL: false,
          timezone: user.timezone || "Asia/Karachi",
        };
      }
      
      console.log("❌ Missing email configuration for clinic");
      return null;
    }

    let decryptedPassword;
    try {
      decryptedPassword = decrypt(user.emailPassword);
    } catch (decryptError) {
      console.error("❌ Decryption failed:", decryptError.message);
      return null;
    }

    if (!decryptedPassword) {
      console.log("❌ Decrypted password is empty");
      return null;
    }

    console.log("✅ Email settings loaded successfully");
    console.log("  - fromEmail:", user.fromEmail);
    console.log("  - smtpHost:", user.smtpHost);

    return {
      smtpHost: user.smtpHost,
      smtpPort: user.smtpPort || "587",
      fromEmail: user.fromEmail,
      fromName: user.fromName || user.clinicName || "Clinic",
      password: decryptedPassword.trim(),
      useTLS: user.useTLS !== undefined ? user.useTLS : true,
      useSSL: user.useSSL || false,
      timezone: user.timezone || "Asia/Karachi",
    };
  } catch (error) {
    console.error("❌ getUserEmailSettings error:", error);
    return null;
  }
};

// ============ GENERATE TRACKING TOKEN ============
const generateTrackingToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

// ============ CREATE TRANSPORTER ============
const createTransporter = (settings) => {
  const port = parseInt(settings.smtpPort) || 587;
  
  console.log("📧 Creating transporter:");
  console.log("  - host:", settings.smtpHost);
  console.log("  - port:", port);
  console.log("  - user:", settings.fromEmail);
  console.log("  - secure:", port === 465);

  return nodemailer.createTransport({
    host: settings.smtpHost,
    port: port,
    secure: port === 465,
    auth: {
      user: settings.fromEmail,
      pass: settings.password,
    },
    tls: {
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });
};

// ============ SEND EMAIL ============
const sendEmailFromClinic = async (userId, to, subject, html, text = "") => {
  try {
    if (!to) {
      console.error("❌ No recipient email provided");
      return { success: false, error: "No recipient email" };
    }

    to = String(to).trim();
    if (!to) {
      console.error("❌ Invalid recipient email");
      return { success: false, error: "Invalid recipient email" };
    }

    console.log(`📧 Preparing to send email to: ${to}`);

    const settings = await getUserEmailSettings(userId);

    if (!settings) {
      console.log("❌ No email configured for clinic:", userId);
      return { success: false, error: "Email not configured" };
    }

    const transporter = createTransporter(settings);

    try {
      await transporter.verify();
      console.log("✅ SMTP connection verified");
    } catch (verifyError) {
      console.error("❌ SMTP verification failed:", verifyError.message);
      return {
        success: false,
        error: "SMTP connection failed: " + verifyError.message,
      };
    }

    const info = await transporter.sendMail({
      from: `"${settings.fromName || 'Orvexify'}" <${settings.fromEmail}>`,
      to: to,
      subject: subject,
      text: text || html.replace(/<[^>]*>/g, ""),
      html: html,
    });

    console.log(`✅ Email sent from ${settings.fromEmail} to ${to}`);
    console.log(`✅ Message ID: ${info.messageId}`);
    return { success: true, info, messageId: info.messageId };
  } catch (error) {
    console.error("❌ Send email error:", error.message);
    return { success: false, error: error.message };
  }
};

// ============ FORMAT DATE ============
const formatAppointmentDate = (dateStr, timezone) => {
  try {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: timezone || "Asia/Karachi",
    });
  } catch (error) {
    return dateStr;
  }
};

// ============ GENERATE TRACKING HTML ============
const generateTrackingHTML = (pixelUrl, trackingToken) => {
  return `
    <!-- CSS BACKGROUND TRACKING -->
    <div style="background-image: url('${pixelUrl}?method=css&t=${Date.now()}'); background-repeat: no-repeat; background-size: 0 0; width: 0px; height: 0px; display: block !important; opacity: 0.001 !important; overflow: hidden !important; position: absolute !important; pointer-events: none !important; mso-hide: all;"></div>
    <style>
      .tracking-${trackingToken} {
        background-image: url('${pixelUrl}?method=class&t=${Date.now()}');
        background-size: 0 0;
        width: 0px;
        height: 0px;
        display: none !important;
      }
    </style>
    <div class="tracking-${trackingToken}"></div>
    <img src="${pixelUrl}?method=img&t=${Date.now()}" alt="" width="1" height="1" style="display:block !important; width:1px !important; height:1px !important; max-width:1px !important; max-height:1px !important; overflow:hidden !important; opacity:0.001 !important; position:absolute !important; pointer-events:none !important;" border="0" />
  `;
};

// ============ SEND REMINDER EMAIL ============
const sendReminderEmail = async (
  userId,
  to,
  patientName,
  clinicName,
  appointmentDate,
  appointmentTime,
  doctorName,
  confirmLink,
  cancelLink,
  logId,
  trackingPixel,
  reminderLabel = "Appointment Reminder",
  urgencyLevel = "low",
) => {
  console.log(`📧 Sending reminder email to: ${to}`);
  console.log(`📋 Reminder Type: ${reminderLabel}, Urgency: ${urgencyLevel}`);

  if (!to) {
    console.error("❌ sendReminderEmail: No recipient");
    return { success: false, error: "No recipient email" };
  }
  to = String(to).trim();
  if (!to) return { success: false, error: "Invalid email" };

  const trackingToken = generateTrackingToken();

  if (logId) {
    try {
      await ReminderLog.findByIdAndUpdate(logId, {
        trackingToken: trackingToken,
      });
      console.log(`✅ Tracking token saved to log: ${trackingToken}`);
    } catch (error) {
      console.error("❌ Failed to update tracking token:", error);
    }
  }

  const settings = await getUserEmailSettings(userId);
  const timezone = settings?.timezone || "Asia/Karachi";
  const backendUrl = process.env.BACKEND_URL || "http://localhost:5000";
  const pixelUrl = `${backendUrl}/api/tracking/pixel/${trackingToken}`;

  console.log(`📊 Tracking Pixel URL: ${pixelUrl}`);

  const formattedDate = formatAppointmentDate(appointmentDate, timezone);
  const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const confirmTrackingUrl = `${backendUrl}/api/tracking/click?tracking=${trackingToken}&action=confirm&redirect=${encodeURIComponent(confirmLink)}`;
  const cancelTrackingUrl = `${backendUrl}/api/tracking/click?tracking=${trackingToken}&action=cancel&redirect=${encodeURIComponent(cancelLink)}`;

  const trackingHTML = generateTrackingHTML(pixelUrl, trackingToken);

  let urgencyStyles = {
    headerBg: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
    badgeBg: '#3b82f6',
    badgeColor: 'white',
    borderColor: '#3b82f6',
    urgencyText: '',
    urgencyEmoji: '📅',
    urgencyLabel: 'Appointment Reminder',
    showWarning: false,
    warningText: '',
    buttonBg: '#22c55e'
  };

  if (urgencyLevel === 'high') {
    urgencyStyles = {
      headerBg: 'linear-gradient(135deg, #dc2626, #b91c1c)',
      badgeBg: '#dc2626',
      badgeColor: 'white',
      borderColor: '#dc2626',
      urgencyText: '⚠️ URGENT: FINAL REMINDER',
      urgencyEmoji: '⚠️',
      urgencyLabel: '30-Minute Final Reminder',
      showWarning: true,
      warningText: '⚠️ Your appointment is in less than 30 minutes. Please confirm or cancel immediately.',
      buttonBg: '#dc2626'
    };
  } else if (urgencyLevel === 'medium') {
    urgencyStyles = {
      headerBg: 'linear-gradient(135deg, #f59e0b, #d97706)',
      badgeBg: '#f59e0b',
      badgeColor: 'white',
      borderColor: '#f59e0b',
      urgencyText: '🔔 2-Hour Reminder',
      urgencyEmoji: '🔔',
      urgencyLabel: '2-Hour Reminder',
      showWarning: false,
      warningText: '',
      buttonBg: '#22c55e'
    };
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${urgencyStyles.urgencyLabel} - ${clinicName}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; line-height: 1.6; color: #1e293b; margin: 0; padding: 0; background: #f1f5f9; }
        .container { max-width: 560px; margin: 20px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
        .header { background: ${urgencyStyles.headerBg}; padding: 32px 24px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 26px; font-weight: 700; }
        .header p { color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px; }
        .content { padding: 32px 24px; background: #ffffff; }
        .urgency-badge { display: inline-block; background: ${urgencyStyles.badgeBg}; color: ${urgencyStyles.badgeColor}; padding: 6px 16px; border-radius: 50px; font-size: 13px; font-weight: 700; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
        .warning-box { background: #fef2f2; border: 2px solid #fecaca; border-radius: 10px; padding: 14px 18px; margin: 16px 0; display: ${urgencyStyles.showWarning ? 'block' : 'none'}; }
        .warning-box p { margin: 0; color: #991b1b; font-size: 15px; font-weight: 600; }
        .greeting { font-size: 16px; margin-bottom: 16px; }
        .greeting strong { color: #0f172a; }
        .details { background: #f8fafc; padding: 20px; border-radius: 12px; margin: 16px 0 20px; border: 1px solid #e2e8f0; border-left: 4px solid ${urgencyStyles.borderColor}; }
        .details p { margin: 8px 0; font-size: 15px; color: #334155; }
        .details strong { color: #0f172a; }
        .button-group { text-align: center; margin: 24px 0 16px; }
        .btn { display: inline-block; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 15px; transition: all 0.2s; margin: 4px 8px; border: none; cursor: pointer; }
        .btn-confirm { background: ${urgencyLevel === 'high' ? '#dc2626' : '#22c55e'}; color: white; }
        .btn-confirm:hover { background: ${urgencyLevel === 'high' ? '#b91c1c' : '#16a34a'}; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(34,197,94,0.3); }
        .btn-cancel { background: #ef4444; color: white; }
        .btn-cancel:hover { background: #dc2626; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(239,68,68,0.3); }
        .footer { text-align: center; padding: 20px 24px; color: #94a3b8; font-size: 12px; background: #f8fafc; border-top: 1px solid #e2e8f0; }
        .footer a { color: #3b82f6; text-decoration: none; }
        .footer a:hover { text-decoration: underline; }
        .timezone-note { font-size: 12px; color: #94a3b8; text-align: center; margin-top: 12px; padding-top: 12px; border-top: 1px solid #f1f5f9; }
        @media (max-width: 480px) {
          .container { margin: 10px; border-radius: 12px; }
          .header { padding: 24px 16px; }
          .header h1 { font-size: 22px; }
          .content { padding: 24px 16px; }
          .btn { display: block; margin: 8px 0; width: 100%; text-align: center; }
          .details { padding: 16px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${clinicName}</h1>
          <p>${urgencyStyles.urgencyEmoji} ${urgencyStyles.urgencyLabel}</p>
        </div>
        <div class="content">
          <div style="text-align: center;">
            <span class="urgency-badge">${urgencyStyles.urgencyText || urgencyStyles.urgencyLabel}</span>
          </div>
          <div class="warning-box">
            <p>${urgencyStyles.warningText}</p>
          </div>
          <p class="greeting">Dear <strong>${patientName}</strong>,</p>
          <div class="details">
            <p><strong>📅 Date:</strong> ${formattedDate}</p>
            <p><strong>⏰ Time:</strong> ${appointmentTime}</p>
            <p><strong>👨‍⚕️ Doctor:</strong> Dr. ${doctorName}</p>
            <p><strong>📍 Clinic:</strong> ${clinicName}</p>
          </div>
          <div class="button-group">
            <a href="${confirmTrackingUrl}" class="btn btn-confirm">✅ Confirm Appointment</a>
            <a href="${cancelTrackingUrl}" class="btn btn-cancel">❌ Cancel Appointment</a>
          </div>
          ${urgencyLevel === 'high' ? `
          <div style="background: #fef2f2; border-radius: 8px; padding: 12px 16px; margin: 12px 0;">
            <p style="margin: 0; font-size: 13px; color: #991b1b; text-align: center;">⚠️ Please respond immediately. Your appointment is in less than 30 minutes.</p>
          </div>` : ''}
          ${urgencyLevel === 'medium' ? `
          <div style="background: #fffbeb; border-radius: 8px; padding: 10px 14px; margin: 12px 0;">
            <p style="margin: 0; font-size: 13px; color: #92400e; text-align: center;">🔔 Please confirm or cancel within the next 2 hours.</p>
          </div>` : ''}
          <p style="font-size: 13px; color: #64748b; text-align: center; margin: 12px 0 0;">Please confirm or cancel at least 2 hours before your appointment.</p>
          <div class="timezone-note">⏰ All times are in ${timezone}</div>
        </div>
        <div class="footer">
          <p style="margin: 0;"><a href="${baseUrl}/privacy">Privacy Policy</a> &nbsp;|&nbsp; <a href="${baseUrl}/unsubscribe/${trackingToken}">Unsubscribe</a></p>
          <p style="margin: 8px 0 0;">&copy; ${new Date().getFullYear()} Orvexify. All rights reserved.</p>
        </div>
      </div>
      ${trackingHTML}
    </body>
    </html>
  `;

  console.log(`📤 Sending email with CSS Background tracking`);

  let subject = `Appointment Reminder - ${clinicName}`;
  if (urgencyLevel === 'high') {
    subject = `⚠️ URGENT: Your appointment is in 30 minutes - ${clinicName}`;
  } else if (urgencyLevel === 'medium') {
    subject = `🔔 2-Hour Reminder: Your appointment at ${clinicName}`;
  }

  const result = await sendEmailFromClinic(userId, to, subject, html);

  // ✅ FIXED: Update log with ALL status fields
  if (logId) {
    try {
      await ReminderLog.findByIdAndUpdate(logId, {
        'status.current': result.success ? 'sent' : 'failed',
        'status.isPending': false,
        'status.isSent': result.success ? true : false,
        'status.isDelivered': result.success ? true : false,
        'status.isFailed': result.success ? false : true,
        sentAt: new Date(),
        errorMessage: result.success ? null : result.error,
        reminderLabel: reminderLabel,
        urgencyLevel: urgencyLevel,
        trackingToken: trackingToken,
      });
      console.log(`✅ Log updated: ${logId}, status: ${result.success ? "sent" : "failed"}`);
    } catch (error) {
      console.error("❌ Failed to update log status:", error);
    }
  }

  return result;
};

// ============ OTHER EMAIL FUNCTIONS ============
const sendVerificationEmail = async (userId, to, name, code) => {
  console.log(`📧 Sending verification email to: ${to}`);
  const settings = await getUserEmailSettings(userId);
  const clinicName = settings?.fromName || "Orvexify";

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>Verify Your Email</title>
    <style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;}
    .container{max-width:500px;margin:0 auto;background:#fff;}
    .header{background:linear-gradient(135deg,#3b82f6,#06b6d4);padding:30px;text-align:center;border-radius:10px 10px 0 0;}
    .header h1{color:#fff;margin:0;font-size:24px;}
    .content{padding:30px;background:#f8fafc;border-radius:0 0 10px 10px;}
    .code-box{background:#fff;padding:20px;text-align:center;border-radius:12px;margin:20px 0;border:1px solid #e2e8f0;}
    .code{font-size:36px;font-weight:bold;letter-spacing:8px;color:#3b82f6;font-family:monospace;}
    .footer{text-align:center;padding:20px;color:#94a3b8;font-size:12px;}</style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>${clinicName}</h1></div>
        <div class="content">
          <h2>Welcome, ${name}!</h2>
          <p>Thank you for registering. Please verify your email address.</p>
          <div class="code-box"><div class="code">${code}</div></div>
          <p style="font-size:12px;color:#64748b;">This code expires in 10 minutes.</p>
        </div>
        <div class="footer"><p>&copy; ${new Date().getFullYear()} Orvexify. All rights reserved.</p></div>
      </div>
    </body>
    </html>
  `;

  return await sendEmailFromClinic(userId, to, `Verify Your Email - ${clinicName}`, html);
};

const sendBookingConfirmation = async (userId, to, name, date, time, clinicName, doctorName, timezone) => {
  console.log(`📧 Sending booking confirmation to: ${to}`);
  if (!to) return { success: false, error: "No recipient email" };
  to = String(to).trim();
  if (!to) return { success: false, error: "Invalid email" };

  const formattedDate = formatAppointmentDate(date, timezone);
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>Appointment Confirmed</title>
    <style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;}
    .container{max-width:500px;margin:0 auto;background:#fff;}
    .header{background:linear-gradient(135deg,#22c55e,#16a34a);padding:30px;text-align:center;border-radius:10px 10px 0 0;}
    .header h1{color:#fff;margin:0;font-size:24px;}
    .content{padding:30px;background:#f8fafc;border-radius:0 0 10px 10px;}
    .details{background:#fff;padding:20px;border-radius:10px;margin:20px 0;border:1px solid #e2e8f0;}
    .footer{text-align:center;padding:20px;color:#94a3b8;font-size:12px;}</style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>${clinicName || "Clinic"}</h1></div>
        <div class="content">
          <h2>Hello ${name || "Patient"},</h2>
          <p>Your appointment has been successfully booked.</p>
          <div class="details">
            <p><strong>📅 Date:</strong> ${formattedDate}</p>
            <p><strong>⏰ Time:</strong> ${time || "N/A"}</p>
            ${doctorName ? `<p><strong>👨‍⚕️ Doctor:</strong> Dr. ${doctorName}</p>` : ""}
          </div>
          <p>You will receive a reminder 24 hours before your appointment.</p>
          <p style="margin-top:20px;font-size:14px;">Thank you for choosing us!</p>
        </div>
        <div class="footer"><p>&copy; ${new Date().getFullYear()} Orvexify. All rights reserved.</p></div>
      </div>
    </body>
    </html>
  `;

  return await sendEmailFromClinic(userId, to, `Appointment Confirmed - ${clinicName || "Clinic"}`, html);
};

const sendCancellationEmail = async (userId, to, patientName, clinicName, appointmentDate, appointmentTime, timezone) => {
  console.log(`📧 Sending cancellation email to: ${to}`);
  if (!to) return { success: false, error: "No recipient email" };
  to = String(to).trim();
  if (!to) return { success: false, error: "Invalid email" };

  const formattedDate = formatAppointmentDate(appointmentDate, timezone);
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>Appointment Cancelled</title>
    <style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;}
    .container{max-width:500px;margin:0 auto;background:#fff;}
    .header{background:linear-gradient(135deg,#ef4444,#dc2626);padding:30px;text-align:center;border-radius:10px 10px 0 0;}
    .header h1{color:#fff;margin:0;font-size:24px;}
    .content{padding:30px;background:#f8fafc;border-radius:0 0 10px 10px;}
    .details{background:#fff;padding:20px;border-radius:10px;margin:20px 0;border:1px solid #e2e8f0;}
    .footer{text-align:center;padding:20px;color:#94a3b8;font-size:12px;}</style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>${clinicName}</h1></div>
        <div class="content">
          <h2>Dear ${patientName},</h2>
          <p>Your appointment has been <strong>cancelled</strong> as requested.</p>
          <div class="details">
            <p><strong>📅 Date:</strong> ${formattedDate}</p>
            <p><strong>⏰ Time:</strong> ${appointmentTime}</p>
          </div>
          <p>If you wish to reschedule, please contact the clinic directly.</p>
          <p style="margin-top:20px;font-size:14px;">We hope to see you again soon!</p>
        </div>
        <div class="footer"><p>&copy; ${new Date().getFullYear()} Orvexify. All rights reserved.</p></div>
      </div>
    </body>
    </html>
  `;

  return await sendEmailFromClinic(userId, to, `Appointment Cancelled - ${clinicName}`, html);
};

const sendConfirmedEmail = async (userId, to, patientName, clinicName, appointmentDate, appointmentTime, doctorName, timezone) => {
  console.log(`📧 Sending confirmed email to: ${to}`);
  if (!to) return { success: false, error: "No recipient email" };
  to = String(to).trim();
  if (!to) return { success: false, error: "Invalid email" };

  const formattedDate = formatAppointmentDate(appointmentDate, timezone);
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>Appointment Confirmed</title>
    <style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;}
    .container{max-width:500px;margin:0 auto;background:#fff;}
    .header{background:linear-gradient(135deg,#22c55e,#16a34a);padding:30px;text-align:center;border-radius:10px 10px 0 0;}
    .header h1{color:#fff;margin:0;font-size:24px;}
    .content{padding:30px;background:#f8fafc;border-radius:0 0 10px 10px;}
    .details{background:#fff;padding:20px;border-radius:10px;margin:20px 0;border:1px solid #e2e8f0;}
    .footer{text-align:center;padding:20px;color:#94a3b8;font-size:12px;}</style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>${clinicName}</h1></div>
        <div class="content">
          <h2>Dear ${patientName},</h2>
          <p>Your appointment has been <strong>confirmed</strong>.</p>
          <div class="details">
            <p><strong>📅 Date:</strong> ${formattedDate}</p>
            <p><strong>⏰ Time:</strong> ${appointmentTime}</p>
            <p><strong>👨‍⚕️ Doctor:</strong> Dr. ${doctorName}</p>
          </div>
          <p>We look forward to seeing you.</p>
        </div>
        <div class="footer"><p>&copy; ${new Date().getFullYear()} Orvexify. All rights reserved.</p></div>
      </div>
    </body>
    </html>
  `;

  return await sendEmailFromClinic(userId, to, `Appointment Confirmed - ${clinicName}`, html);
};

const sendNoResponseFollowUp = async (userId, to, patientName, clinicName, appointmentDate, appointmentTime, doctorName, confirmLink, cancelLink) => {
  console.log(`📧 Sending no-response follow-up to: ${to}`);
  if (!to) return { success: false, error: "No recipient email" };
  to = String(to).trim();
  if (!to) return { success: false, error: "Invalid email" };

  const settings = await getUserEmailSettings(userId);
  const timezone = settings?.timezone || "Asia/Karachi";
  const formattedDate = formatAppointmentDate(appointmentDate, timezone);

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>Appointment Reminder - Follow Up</title>
    <style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;}
    .container{max-width:500px;margin:0 auto;background:#fff;}
    .header{background:linear-gradient(135deg,#f59e0b,#d97706);padding:30px;text-align:center;border-radius:10px 10px 0 0;}
    .header h1{color:#fff;margin:0;font-size:24px;}
    .content{padding:30px;background:#f8fafc;border-radius:0 0 10px 10px;}
    .details{background:#fff;padding:20px;border-radius:10px;margin:20px 0;border:1px solid #e2e8f0;}
    .btn-confirm{display:inline-block;padding:12px 24px;background:#22c55e;color:#fff;text-decoration:none;border-radius:8px;margin:5px;font-weight:600;}
    .btn-cancel{display:inline-block;padding:12px 24px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;margin:5px;font-weight:600;}
    .footer{text-align:center;padding:20px;color:#94a3b8;font-size:12px;}
    .urgent{color:#dc2626;font-weight:600;}</style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>${clinicName}</h1></div>
        <div class="content">
          <h2>Dear ${patientName},</h2>
          <p class="urgent">⚠️ We haven't received your confirmation yet!</p>
          <p>This is a reminder for your upcoming appointment:</p>
          <div class="details">
            <p><strong>📅 Date:</strong> ${formattedDate}</p>
            <p><strong>⏰ Time:</strong> ${appointmentTime}</p>
            <p><strong>👨‍⚕️ Doctor:</strong> Dr. ${doctorName}</p>
          </div>
          <p>Please confirm or cancel immediately:</p>
          <div style="text-align:center;margin:20px 0;">
            <a href="${confirmLink}" class="btn-confirm">✅ Confirm Now</a>
            <a href="${cancelLink}" class="btn-cancel">❌ Cancel</a>
          </div>
          <p style="font-size:12px;color:#64748b;">If not confirmed, your slot may be released.</p>
        </div>
        <div class="footer"><p>&copy; ${new Date().getFullYear()} Orvexify. All rights reserved.</p></div>
      </div>
    </body>
    </html>
  `;

  return await sendEmailFromClinic(userId, to, `⚠️ Appointment Reminder - Please Confirm - ${clinicName}`, html);
};

// ============ EXPORT ALL ============
module.exports = {
  sendEmailFromClinic,
  sendVerificationEmail,
  sendBookingConfirmation,
  sendReminderEmail,
  sendCancellationEmail,
  sendConfirmedEmail,
  sendNoResponseFollowUp,
  getUserEmailSettings,
  generateTrackingToken,
  formatAppointmentDate,
};