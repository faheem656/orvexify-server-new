// src/routes/authRoutes.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const crypto = require("crypto"); // ✅ ADD THIS LINE
const {sendWelcomeEmail} = require("../utils/sendEmail")
// Models
const User = require("../models/User");
const VerificationCode = require("../models/VerificationCode");
const TokenBlacklist = require("../models/TokenBlacklist");

// Utils
const { hashPassword, comparePassword } = require("../utils/hashPassword");
const { generateVerificationCode } = require("../utils/generateToken");
const { protect, generateToken } = require("../middleware/auth");
const bcrypt = require("bcryptjs");
const { sendEmail } = require("../config/email");
const ClinicSettings = require("../models/ClinicSettings");
const defaultTemplates = require("../utils/defaultTemplates");
const { sendVerificationEmail } = require("../services/emailService");




// ============ GENERATE UNIQUE BOOKING SLUG ============
const generateBookingSlug = async (clinicName) => {
  // ✅ Convert clinic name to slug
  let baseSlug = clinicName
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

  // ✅ If empty, use default
  if (!baseSlug || baseSlug.length < 3) {
    baseSlug = 'clinic';
  }

  // ✅ Check if slug already exists
  let finalSlug = baseSlug;
  let counter = 1;
  let exists = await User.findOne({ bookingSlug: finalSlug });

  // ✅ Keep adding counter until unique
  while (exists) {
    finalSlug = `${baseSlug}-${counter}`;
    exists = await User.findOne({ bookingSlug: finalSlug });
    counter++;
  }

  return finalSlug;
};





// ============ REGISTER API ============
router.post(
  '/register',
  [
    body('clinicName').notEmpty().withMessage('Clinic name is required'),
    body('fullName').notEmpty().withMessage('Full name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
    body('timezone').optional(),
  ],
  async (req, res) => {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { clinicName, fullName, email, password, timezone } = req.body;

    try {
      // Check if user already exists
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User already exists with this email',
        });
      }

      // ✅ Generate unique booking slug
      const bookingSlug = await generateBookingSlug(clinicName);
      console.log(`✅ Booking slug generated: ${bookingSlug} for clinic: ${clinicName}`);

      // Hash password
      const hashedPassword = await hashPassword(password);

      // ✅ Create user with bookingSlug
      const user = await User.create({
        clinicName,
        fullName,
        email: email.toLowerCase(),
        passwordHash: hashedPassword,
        timezone: timezone || 'Asia/Karachi',
        isVerified: false,
        isActive: true,
        bookingSlug: bookingSlug, // ✅ Added bookingSlug
        plan: 'free',
      });

      console.log(`✅ User created: ${user.email} with slug: ${user.bookingSlug}`);

      // Create clinic settings
      await ClinicSettings.create({
        userId: user._id,
        reminderSettings: {
          enable24hReminder: true,
          enable2hReminder: true,
          enableCancellationEmail: true,
          sendRemindersOnWeekends: true,
          defaultReminderHours: { firstReminder: 24, secondReminder: 2 },
        },
        notificationSettings: {
          emailNotifications: true,
          appointmentConfirmedNotify: true,
          appointmentCancelledNotify: true,
          noShowNotify: true,
          dailyDigest: false,
          weeklyReport: true,
        },
        emailTemplates: {
          reminder: {
            subject: defaultTemplates.reminder.subject,
            body: defaultTemplates.reminder.body,
          },
          confirmation: {
            subject: defaultTemplates.confirmation.subject,
            body: defaultTemplates.confirmation.body,
          },
          cancellation: {
            subject: defaultTemplates.cancellation.subject,
            body: defaultTemplates.cancellation.body,
          },
        },
      });

      // Generate verification code
      const verificationCode = generateVerificationCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await VerificationCode.create({
        userId: user._id,
        code: verificationCode,
        expiresAt,
      });

      // Send verification email
      await sendVerificationEmail(
        user._id,
        user.email,
        user.fullName,
        verificationCode,
      );

      // Generate JWT token
      const token = generateToken(user);

      res.status(201).json({
        success: true,
        message:
          'Registration successful. Please check your email for verification code.',
        token,
        user: {
          id: user._id,
          clinicName: user.clinicName,
          fullName: user.fullName,
          email: user.email,
          isVerified: user.isVerified,
          plan: user.plan,
          bookingSlug: user.bookingSlug, // ✅ Return bookingSlug
          isActive: user.isActive,
        },
      });
    } catch (error) {
      console.error('Register error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error. Please try again.',
      });
    }
  },
);

// ============ VERIFY EMAIL API ============
router.post(
  "/verify-email",
  [
    body("email").isEmail().withMessage("Valid email is required"),
    body("code")
      .isLength({ min: 6, max: 6 })
      .withMessage("6-digit code is required"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { email, code } = req.body;

    try {
      // Find user
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Check if already verified
      if (user.isVerified) {
        return res.status(400).json({
          success: false,
          message: "Email already verified",
        });
      }

      // Find verification code
      const verificationRecord = await VerificationCode.findOne({
        userId: user._id,
        code: code,
      });

      if (!verificationRecord) {
        return res.status(400).json({
          success: false,
          message: "Invalid verification code",
        });
      }

      // Check if expired
      if (verificationRecord.expiresAt < new Date()) {
        await VerificationCode.deleteOne({ _id: verificationRecord._id });
        return res.status(400).json({
          success: false,
          message: "Verification code has expired. Please request a new one.",
        });
      }

      // Verify user
      user.isVerified = true;
      await user.save();

      // Delete used verification code
      await VerificationCode.deleteOne({ _id: verificationRecord._id });

      // Send welcome email
      await sendWelcomeEmail(user.email, user.fullName);

      // Generate new token
      const token = generateToken(user);

      res.json({
        success: true,
        message: "Email verified successfully!",
        token,
        user: {
          id: user._id,
          clinicName: user.clinicName,
          fullName: user.fullName,
          email: user.email,
          isVerified: user.isVerified,
          plan: user.plan,
        },
      });
    } catch (error) {
      console.error("Verify email error:", error);
      res.status(500).json({
        success: false,
        message: "Server error. Please try again.",
      });
    }
  },
);

// ============ RESEND VERIFICATION CODE ============
router.post(
  "/resend-verification",
  [body("email").isEmail().withMessage("Valid email is required")],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { email } = req.body;

    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      if (user.isVerified) {
        return res.status(400).json({
          success: false,
          message: "Email already verified",
        });
      }

      // Delete old verification codes
      await VerificationCode.deleteMany({ userId: user._id });

      // Generate new code
      const verificationCode = generateVerificationCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await VerificationCode.create({
        userId: user._id,
        code: verificationCode,
        expiresAt,
      });

      // Resend email
      await sendVerificationEmail(user._id, user.email, user.fullName, verificationCode);

      res.json({
        success: true,
        message: "New verification code sent to your email",
      });
    } catch (error) {
      console.error("Resend code error:", error);
      res.status(500).json({
        success: false,
        message: "Server error. Please try again.",
      });
    }
  },
);

// ============ LOGIN API ============
router.post("/login", async (req, res) => {
  const { email, password, twoFactorToken, backupCode } = req.body;

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }

    if (!user.isVerified) {
      return res
        .status(401)
        .json({ success: false, message: "Please verify your email first" });
    }

    // Check 2FA
    if (user.isTwoFactorEnabled) {
      // Check backup code first
      if (backupCode) {
        const backupCodeIndex = user.twoFactorBackupCodes.indexOf(backupCode);
        if (backupCodeIndex !== -1) {
          // ✅ AUTO DISABLE 2FA WHEN BACKUP CODE IS USED
          user.isTwoFactorEnabled = false;
          user.twoFactorSecret = null;
          user.twoFactorBackupCodes = [];
          await user.save();

          // Send email notification
          const html = `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #3b82f6, #06b6d4); padding: 30px; text-align: center;">
                <h1 style="color: white;">2FA Disabled</h1>
              </div>
              <div style="padding: 30px; background: #f8fafc;">
                <h2>Hello ${user.fullName},</h2>
                <p>Two-Factor Authentication has been <strong>disabled</strong> on your account because you used a backup code to login.</p>
                <p>If you did this, you can now login with just your password.</p>
                <p>To enable 2FA again, go to Settings → Security.</p>
                <p style="margin-top: 20px;">If you didn't do this, please contact support immediately.</p>
              </div>
            </div>
          `;

          await sendEmail(user.email, "2FA Disabled - Orvexify", html);

          const token = generateToken(user);
          return res.json({
            success: true,
            twoFactorDisabled: true, // ← Flag to show message on frontend
            message:
              "2FA has been disabled. You can now login with your password.",
            token,
            user: {
              id: user._id,
              clinicName: user.clinicName,
              fullName: user.fullName,
              email: user.email,
              isVerified: user.isVerified,
              plan: user.plan,
              isTwoFactorEnabled: false,
            },
          });
        } else {
          return res
            .status(401)
            .json({ success: false, message: "Invalid backup code" });
        }
      }

      // Normal 2FA verification
      if (!twoFactorToken) {
        return res.status(401).json({
          success: false,
          requiresTwoFactor: true,
          message: "2FA token required",
        });
      }

      const isValid2FA = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: "base32",
        token: twoFactorToken,
        window: 1,
      });

      if (!isValid2FA) {
        return res.status(401).json({
          success: false,
          message: "Invalid 2FA token",
        });
      }
    }

    const token = generateToken(user);

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        clinicName: user.clinicName,
        fullName: user.fullName,
        email: user.email,
        isVerified: user.isVerified,
        plan: user.plan,
        isTwoFactorEnabled: user.isTwoFactorEnabled,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ============ LOGOUT API ============
router.post("/logout", protect, async (req, res) => {
  try {
    const token = req.token;
    const decoded = jwt.decode(token);

    await TokenBlacklist.create({
      token: token,
      userId: req.user._id,
      expiresAt: new Date(decoded.exp * 1000),
    });

    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error during logout" });
  }
});

// ============ LOGOUT FROM ALL DEVICES ============
router.post("/logout-all", protect, async (req, res) => {
  try {
    // ✅ Increment token version (invalidates all existing tokens)
    req.user.tokenVersion = (req.user.tokenVersion || 0) + 1;
    await req.user.save();

    // Add current token to blacklist
    const decoded = jwt.decode(req.token);
    if (decoded && decoded.exp) {
      await TokenBlacklist.create({
        token: req.token,
        userId: req.user._id,
        expiresAt: new Date(decoded.exp * 1000),
      });
    }

    res.json({
      success: true,
      message: "Logged out from all devices successfully",
    });
  } catch (error) {
    console.error("Logout all error:", error);
    res.status(500).json({
      success: false,
      message: "Server error: " + error.message,
    });
  }
});

// ============ GET SESSION INFO ============
router.get("/session", protect, async (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      clinicName: req.user.clinicName,
      fullName: req.user.fullName,
      email: req.user.email,
      plan: req.user.plan,
      isVerified: req.user.isVerified,
    },
    tokenVersion: req.user.tokenVersion,
  });
});

// ============ CHANGE PASSWORD ============
router.post("/change-password", protect, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // Validation
  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: "Current password and new password are required",
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: "New password must be at least 6 characters",
    });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({
      success: false,
      message: "New password must be different from current password",
    });
  }

  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    user.passwordHash = hashedPassword;
    user.passwordChangedAt = new Date();
    await user.save();

    // Blacklist all existing tokens (force logout from all devices)
    await TokenBlacklist.deleteMany({ userId: user._id });

    res.json({
      success: true,
      message: "Password changed successfully. Please login again.",
    });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// ============ ENABLE 2FA - Generate Secret ============
router.post("/2fa/enable", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user.isTwoFactorEnabled) {
      return res.status(400).json({
        success: false,
        message: "2FA is already enabled",
      });
    }

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `Orvexify:${user.email}`,
      length: 20,
    });

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    // Save secret temporarily (will be verified before enabling)
    user.twoFactorSecret = secret.base32;
    await user.save();

    res.json({
      success: true,
      message: "2FA setup initiated",
      secret: secret.base32,
      qrCode: qrCodeUrl,
    });
  } catch (error) {
    console.error("2FA enable error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// ============ VERIFY 2FA AND ENABLE ============
router.post("/2fa/verify", protect, async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({
      success: false,
      message: "Verification token is required",
    });
  }

  try {
    const user = await User.findById(req.user._id);

    if (!user.twoFactorSecret) {
      return res.status(400).json({
        success: false,
        message: "2FA setup not initiated",
      });
    }

    // Verify token
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: "base32",
      token: token,
      window: 1,
    });

    if (!verified) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
      });
    }

    // Generate backup codes
    const backupCodes = [];
    for (let i = 0; i < 8; i++) {
      backupCodes.push(
        Math.floor(10000000 + Math.random() * 90000000).toString(),
      );
    }

    // Enable 2FA
    user.isTwoFactorEnabled = true;
    user.twoFactorBackupCodes = backupCodes;
    await user.save();

    res.json({
      success: true,
      message: "2FA enabled successfully",
      backupCodes: backupCodes,
    });
  } catch (error) {
    console.error("2FA verify error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// ============ DISABLE 2FA ============
router.post("/2fa/disable", protect, async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({
      success: false,
      message: "Verification token is required",
    });
  }

  try {
    const user = await User.findById(req.user._id);

    if (!user.isTwoFactorEnabled) {
      return res.status(400).json({
        success: false,
        message: "2FA is not enabled",
      });
    }

    // Verify token
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: "base32",
      token: token,
      window: 1,
    });

    if (!verified) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
      });
    }

    // Disable 2FA
    user.isTwoFactorEnabled = false;
    user.twoFactorSecret = null;
    user.twoFactorBackupCodes = [];
    await user.save();

    res.json({
      success: true,
      message: "2FA disabled successfully",
    });
  } catch (error) {
    console.error("2FA disable error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// ============ GET 2FA STATUS ============
router.get("/2fa/status", protect, async (req, res) => {
  res.json({
    success: true,
    isEnabled: req.user.isTwoFactorEnabled || false,
  });
});

// ============ FORGOT PASSWORD - Send OTP ============
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email",
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Set expiry (10 minutes)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Save reset token (hashed for security)
    const hashedToken = crypto.createHash("sha256").update(otp).digest("hex");
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = expiresAt;
    await user.save();

    // Send OTP email
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Reset Your Password</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 500px; margin: 0 auto; background: #ffffff; }
          .header { background: linear-gradient(135deg, #3b82f6, #06b6d4); padding: 30px 20px; text-align: center; }
          .header h1 { color: white; margin: 0; font-size: 28px; }
          .content { padding: 30px; background: #f8fafc; }
          .code-box { background: white; padding: 20px; text-align: center; border-radius: 12px; margin: 20px 0; border: 1px solid #e2e8f0; }
          .code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #3b82f6; font-family: monospace; }
          .expiry { font-size: 12px; color: #64748b; text-align: center; margin-top: 10px; }
          .footer { text-align: center; padding: 20px; color: #94a3b8; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Orvexify</h1>
          </div>
          <div class="content">
            <h2>Reset Your Password</h2>
            <p>We received a request to reset your password. Use the code below to continue.</p>
            <div class="code-box">
              <div class="code">${otp}</div>
            </div>
            <div class="expiry">This code will expire in 10 minutes</div>
            <p style="margin-top: 20px; font-size: 14px;">
              If you didn't request this, you can safely ignore this email.
            </p>
          </div>
          <div class="footer">
            <p>&copy; 2024 Orvexify. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await sendEmail(email, "Reset Your Password - Orvexify", html);

    res.json({
      success: true,
      message: "OTP sent to your email",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
});

// ============ VERIFY OTP ============
router.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({
      success: false,
      message: "Email and OTP are required",
    });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Hash the entered OTP
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    // Check if token exists and not expired
    if (
      !user.resetPasswordToken ||
      user.resetPasswordToken !== hashedOtp ||
      user.resetPasswordExpires < new Date()
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    res.json({
      success: true,
      message: "OTP verified successfully",
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
});

// ============ RESET PASSWORD ============
router.post("/reset-password", async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).json({
      success: false,
      message: "Email, OTP, and new password are required",
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters",
    });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Hash the entered OTP
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    // Check if token exists and not expired
    if (
      !user.resetPasswordToken ||
      user.resetPasswordToken !== hashedOtp ||
      user.resetPasswordExpires < new Date()
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    user.passwordHash = hashedPassword;
    user.passwordChangedAt = new Date();
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    // Blacklist all existing tokens (force logout from all devices)
    await TokenBlacklist.deleteMany({ userId: user._id });

    // Send confirmation email
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Password Changed</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 500px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #3b82f6, #06b6d4); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .header h1 { color: white; margin: 0; }
          .content { background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; }
          .footer { text-align: center; padding: 20px; color: #94a3b8; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Password Changed</h1>
          </div>
          <div class="content">
            <h2>Hello ${user.fullName},</h2>
            <p>Your password has been successfully changed.</p>
            <p>If you didn't make this change, please contact support immediately.</p>
            <a href="${process.env.FRONTEND_URL}/auth/login" class="button">Login Now</a>
            <p style="margin-top: 20px;">Best regards,<br><strong>Orvexify Team</strong></p>
          </div>
          <div class="footer">
            <p>&copy; 2024 Orvexify. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await sendEmail(email, "Your Password Has Been Changed", html);

    res.json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
});

// ============ RESEND OTP ============
router.post("/resend-otp", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email",
      });
    }

    // Generate new OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Set expiry (10 minutes)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Save reset token
    const hashedToken = crypto.createHash("sha256").update(otp).digest("hex");
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = expiresAt;
    await user.save();

    // Send OTP email
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #3b82f6, #06b6d4); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0;">Orvexify</h1>
        </div>
        <div style="padding: 30px; background: #f8fafc;">
          <h2>Reset Your Password</h2>
          <p>Use the code below to reset your password:</p>
          <div style="background: white; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #3b82f6;">${otp}</div>
          <p style="font-size: 12px; color: #64748b;">This code expires in 10 minutes.</p>
        </div>
      </div>
    `;

    await sendEmail(email, "Reset Your Password - Orvexify", html);

    res.json({
      success: true,
      message: "New OTP sent to your email",
    });
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Server error. Please try again.",
    });
  }
});

module.exports = router;
