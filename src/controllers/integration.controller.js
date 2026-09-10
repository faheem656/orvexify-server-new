/** DROP-IN: src/controllers/integration.controller.js
 *
 * GET  /integrations/email
 * PUT  /integrations/email
 * POST /integrations/email/test
 *
 * Clinic SMTP. Email only. Never returns the password.
 */

const nodemailer = require('nodemailer');
const User = require('../models/User');
const { encrypt, decrypt } = require('../utils/encryption');

function httpError(message, code, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function fail(res, err) {
  const status = err.status || 500;
  if (status >= 500) console.error('integrations/email', err);
  return res.status(status).json({
    success: false,
    code: err.code || 'EMAIL_INTEGRATION_ERROR',
    message: err.message || 'Server error',
  });
}

function userIdOf(req) {
  return req.user && (req.user._id || req.user.id);
}

function serialize(user) {
  const row =
    user && typeof user.toObject === 'function' ? user.toObject() : user || {};
  const smtpHost = row.smtpHost || '';
  const fromEmail = row.fromEmail || '';
  return {
    smtpHost,
    smtpPort: row.smtpPort || '587',
    fromEmail,
    fromName: row.fromName || '',
    useTLS: row.useTLS !== undefined ? row.useTLS : true,
    useSSL: !!row.useSSL,
    isConfigured: !!(smtpHost && fromEmail && row.emailPassword),
  };
}

function createTransporter({ smtpHost, smtpPort, fromEmail, password, useSSL }) {
  const port = parseInt(smtpPort, 10) || 587;
  const secure = !!useSSL || port === 465;
  return nodemailer.createTransport({
    host: smtpHost,
    port,
    secure,
    auth: {
      user: fromEmail,
      pass: password,
    },
    tls: {
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });
}

async function loadUser(userId) {
  const user = await User.findById(userId);
  if (!user) throw httpError('User not found', 'NOT_FOUND', 404);
  return user;
}

async function getEmailSettings(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);
    const user = await loadUser(userId);
    return res.json({
      success: true,
      data: serialize(user),
    });
  } catch (error) {
    console.error('Get email settings error:', error.message);
    return fail(res, error);
  }
}

async function saveEmailSettings(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);

    const body = req.body || {};
    const smtpHost = String(body.smtpHost || '').trim();
    const fromEmail = String(body.fromEmail || '').trim();
    const password = body.password != null ? String(body.password) : '';
    const smtpPort = String(body.smtpPort || '587').trim() || '587';
    const fromName = String(body.fromName || '').trim();

    if (!smtpHost) {
      throw httpError('SMTP Host is required', 'BAD_INPUT', 400);
    }
    if (!fromEmail) {
      throw httpError('Email address is required', 'BAD_INPUT', 400);
    }

    const user = await loadUser(userId);

    if (!password && !user.emailPassword) {
      throw httpError('Password is required', 'BAD_INPUT', 400);
    }

    user.smtpHost = smtpHost;
    user.smtpPort = smtpPort;
    user.fromEmail = fromEmail;
    user.fromName = fromName;
    user.useTLS = body.useTLS !== undefined ? !!body.useTLS : true;
    user.useSSL = !!body.useSSL;

    if (password) {
      const encryptedPassword = encrypt(password);
      if (!encryptedPassword) {
        throw httpError('Could not save password', 'ENCRYPT_FAILED', 500);
      }
      const check = decrypt(encryptedPassword);
      if (check !== password) {
        throw httpError('Could not save password', 'ENCRYPT_FAILED', 500);
      }
      user.emailPassword = encryptedPassword;
    }

    await user.save();

    console.log(`✅ Email settings saved for user: ${user.email}`);

    return res.json({
      success: true,
      message: 'Email settings saved successfully',
      data: serialize(user),
    });
  } catch (error) {
    console.error('Save email error:', error.message);
    return fail(res, error);
  }
}

async function testEmailConnection(req, res) {
  try {
    const userId = userIdOf(req);
    if (!userId) throw httpError('Sign in required', 'UNAUTHORIZED', 401);

    const body = req.body || {};
    let smtpHost = String(body.smtpHost || '').trim();
    let smtpPort = body.smtpPort;
    let fromEmail = String(body.fromEmail || '').trim();
    let fromName = String(body.fromName || '').trim();
    let password = body.password != null ? String(body.password) : '';
    let useSSL = !!body.useSSL;
    const testEmail = String(body.testEmail || '').trim();

    const user = await loadUser(userId);

    if (!smtpHost) smtpHost = user.smtpHost || '';
    if (!fromEmail) fromEmail = user.fromEmail || '';
    if (!fromName) fromName = user.fromName || '';
    if (!smtpPort) smtpPort = user.smtpPort || '587';
    if (body.useSSL === undefined) useSSL = !!user.useSSL;

    if (!password && user.emailPassword) {
      try {
        password = decrypt(user.emailPassword) || '';
      } catch (err) {
        throw httpError('Saved password could not be read', 'DECRYPT_FAILED', 400);
      }
    }

    if (!smtpHost || !fromEmail || !password) {
      throw httpError(
        'SMTP Host, Email and Password are required',
        'BAD_INPUT',
        400
      );
    }

    console.log(`📧 Testing email: ${fromEmail} via ${smtpHost}:${smtpPort || 587}`);

    const transporter = createTransporter({
      smtpHost,
      smtpPort,
      fromEmail,
      password,
      useSSL,
    });

    await transporter.verify();
    console.log('✅ SMTP connection verified');

    const toEmail = testEmail || fromEmail;
    const year = new Date().getFullYear();

    const info = await transporter.sendMail({
      from: `"${fromName || 'Orvexify Test'}" <${fromEmail}>`,
      to: toEmail,
      subject: 'Email integration test — Orvexify',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a; margin: 0; padding: 0; background: #f1f5f9; }
            .container { max-width: 500px; margin: 20px auto; background: #fff; border-radius: 12px; overflow: hidden; }
            .header { background: linear-gradient(135deg, #803AFF, #4E49FF, #06A6F8); padding: 28px; text-align: center; }
            .header h1 { color: white; margin: 0; font-size: 22px; }
            .content { background: #f8fafc; padding: 28px; }
            .success { color: #22c55e; font-size: 40px; text-align: center; }
            .footer { text-align: center; padding: 16px; color: #94a3b8; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>Orvexify</h1></div>
            <div class="content">
              <div class="success">✅</div>
              <h2>Test email successful</h2>
              <p>Your email integration is working. Appointment reminders will send from this mailbox.</p>
              <p><strong>From:</strong> ${fromEmail}</p>
              <p><strong>To:</strong> ${toEmail}</p>
            </div>
            <div class="footer"><p>&copy; ${year} Orvexify LLC. All rights reserved.</p></div>
          </div>
        </body>
        </html>
      `,
    });

    console.log(`✅ Test email sent: ${info.messageId}`);

    return res.json({
      success: true,
      message: 'Email connection successful! Test email sent.',
      messageId: info.messageId,
    });
  } catch (error) {
    console.error('Test email error:', error.message);
    if (!error.status) {
      error.status = 400;
      error.code = 'SMTP_TEST_FAILED';
      error.message =
        error.message || 'Failed to connect email. Check your credentials.';
    }
    return fail(res, error);
  }
}

module.exports = {
  getEmailSettings,
  saveEmailSettings,
  testEmailConnection,
};
