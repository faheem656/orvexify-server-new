// src/routes/integrationRoutes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const nodemailer = require("nodemailer");
const User = require("../models/User");
const { encrypt, decrypt } = require("../utils/encryption");

// ============ GET EMAIL SETTINGS ============
router.get("/integrations/email", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    res.json({
      success: true,
      data: {
        smtpHost: user.smtpHost || "",
        smtpPort: user.smtpPort || "587",
        fromEmail: user.fromEmail || "",
        fromName: user.fromName || "",
        useTLS: user.useTLS !== undefined ? user.useTLS : true,
        useSSL: user.useSSL || false,
        isConfigured: !!(user.smtpHost && user.fromEmail && user.emailPassword),
      },
    });
  } catch (error) {
    console.error("Get email settings error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ============ SAVE EMAIL SETTINGS (WITH ENCRYPTION) ============
router.put("/integrations/email", protect, async (req, res) => {
  const { smtpHost, smtpPort, fromEmail, password, fromName, useTLS, useSSL } =
    req.body;

  // ✅ Validation
  if (!smtpHost) {
    return res
      .status(400)
      .json({ success: false, message: "SMTP Host is required" });
  }
  if (!fromEmail) {
    return res
      .status(400)
      .json({ success: false, message: "Email address is required" });
  }
  if (!password) {
    return res
      .status(400)
      .json({ success: false, message: "Password is required" });
  }

  try {
    const user = await User.findById(req.user._id);

    // ✅ Save all settings
    user.smtpHost = smtpHost;
    user.smtpPort = smtpPort || "587";
    user.fromEmail = fromEmail;
    user.fromName = fromName || "";
    user.useTLS = useTLS !== undefined ? useTLS : true;
    user.useSSL = useSSL || false;

    // ✅ ENCRYPT PASSWORD BEFORE SAVING
    const encryptedPassword = encrypt(password);
    console.log("🔐 Password encrypted successfully");
    user.emailPassword = encryptedPassword;

    await user.save();

    // ✅ Test decrypt immediately to verify
    const testDecrypt = decrypt(user.emailPassword);
    if (testDecrypt === password) {
      console.log("✅ Encryption/Decryption test passed");
    } else {
      console.log("⚠️ Encryption/Decryption test failed");
    }

    console.log(`✅ Email settings saved for user: ${user.email}`);

    res.json({
      success: true,
      message: "Email settings saved successfully",
      data: {
        smtpHost: user.smtpHost,
        smtpPort: user.smtpPort,
        fromEmail: user.fromEmail,
        fromName: user.fromName,
        isConfigured: true,
      },
    });
  } catch (error) {
    console.error("Save email error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error: " + error.message });
  }
});

// ============ TEST EMAIL CONNECTION ============
router.post("/integrations/email/test", protect, async (req, res) => {
  const {
    smtpHost,
    smtpPort,
    fromEmail,
    password,
    fromName,
    useTLS,
    useSSL,
    testEmail,
  } = req.body;

  if (!smtpHost || !fromEmail || !password) {
    return res.status(400).json({
      success: false,
      message: "SMTP Host, Email and Password are required",
    });
  }

  try {
    console.log(`📧 Testing email: ${fromEmail} via ${smtpHost}:${smtpPort}`);

    // ✅ For Gmail, use port 465 with SSL or 587 with TLS
    const port = parseInt(smtpPort) || 587;
    const secure = useSSL || port === 465;

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: port,
      secure: secure,
      auth: {
        user: fromEmail,
        pass: password,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });

    // ✅ Verify connection
    await transporter.verify();
    console.log("✅ SMTP connection verified");

    const toEmail = testEmail || fromEmail;

    console.log(`📧 Sending test email to: ${toEmail}`);

    // ✅ Send test email
    const info = await transporter.sendMail({
      from: `"${fromName || "Orvexify Test"}" <${fromEmail}>`,
      to: toEmail,
      subject: "✅ Email Integration Test - Orvexify",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; }
            .container { max-width: 500px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #3b82f6, #06b6d4); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .header h1 { color: white; margin: 0; }
            .content { background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px; }
            .success { color: #22c55e; font-size: 48px; text-align: center; }
            .footer { text-align: center; padding: 20px; color: #94a3b8; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header"><h1>Orvexify</h1></div>
            <div class="content">
              <div class="success">✅</div>
              <h2>Test Email Successful!</h2>
              <p>Your email integration is working correctly.</p>
              <p><strong>From:</strong> ${fromEmail}</p>
              <p><strong>To:</strong> ${toEmail}</p>
              <p><strong>Sent at:</strong> ${new Date().toLocaleString()}</p>
            </div>
            <div class="footer"><p>&copy; 2024 Orvexify. All rights reserved.</p></div>
          </div>
        </body>
        </html>
      `,
    });

    console.log(`✅ Test email sent: ${info.messageId}`);

    res.json({
      success: true,
      message: "Email connection successful! Test email sent.",
      messageId: info.messageId,
    });
  } catch (error) {
    console.error("❌ Test email error:", error);
    res.status(400).json({
      success: false,
      message:
        error.message || "Failed to connect email. Check your credentials.",
    });
  }
});

module.exports = router;