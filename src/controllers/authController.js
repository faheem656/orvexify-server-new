// src/controllers/authController.js
import jwt from "jsonwebtoken";
import { validationResult } from "express-validator";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import VerificationCode from "../models/VerificationCode.js";
import TokenBlacklist from "../models/TokenBlacklist.js";
import ClinicSettings from "../models/ClinicSettings.js";
import { hashPassword } from "../utils/hashPassword.js";
import { generateVerificationCode } from "../utils/generateToken.js";
import { sendWelcomeEmail } from "../utils/sendEmail.js";
import { sendEmail } from "../config/email.js";
import { sendVerificationEmail } from "../services/emailService.js";
import { generateToken } from "../middleware/auth.js";
import { defaultTemplates } from "../utils/defaultTemplates.js";

// ============ GENERATE UNIQUE BOOKING SLUG ============
const generateBookingSlug = async (clinicName) => {
let baseSlug = clinicName
.toLowerCase()
.trim()
.replace(/[^\w\s-]/g, '')
.replace(/\s+/g, '-')
.replace(/-+/g, '-')
.replace(/^-+|-+$/g, '');

if (!baseSlug || baseSlug.length < 3) {
baseSlug = 'clinic';
}

let finalSlug = baseSlug;
let counter = 1;
let exists = await User.findOne({ bookingSlug: finalSlug });

while (exists) {
finalSlug = `${baseSlug}-${counter}`;
exists = await User.findOne({ bookingSlug: finalSlug });
counter++;
}

return finalSlug;
};

// ============ REGISTER ============
export const register = async (req, res) => {
const errors = validationResult(req);
if (!errors.isEmpty()) {
return res.status(400).json({
success: false,
errors: errors.array(),
});
}

const { clinicName, fullName, email, password, timezone } = req.body;

try {
const existingUser = await User.findOne({ email: email.toLowerCase() });
if (existingUser) {
return res.status(400).json({
success: false,
message: 'User already exists with this email',
});
}

const bookingSlug = await generateBookingSlug(clinicName);
console.log(`✅ Booking slug generated: ${bookingSlug} for clinic: ${clinicName}`);

const hashedPassword = await hashPassword(password);

const user = await User.create({
clinicName,
fullName,
email: email.toLowerCase(),
passwordHash: hashedPassword,
timezone: timezone || 'Asia/Karachi',
isVerified: false,
isActive: true,
bookingSlug: bookingSlug,
plan: 'free',
});

console.log(`✅ User created: ${user.email} with slug: ${user.bookingSlug}`);

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

const verificationCode = generateVerificationCode();
const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

await VerificationCode.create({
userId: user._id,
code: verificationCode,
expiresAt,
});

await sendVerificationEmail(
user._id,
user.email,
user.fullName,
verificationCode,
);

const token = generateToken(user._id, user.email);

res.status(201).json({
success: true,
message: 'Registration successful. Please check your email for verification code.',
token,
user: {
id: user._id,
clinicName: user.clinicName,
fullName: user.fullName,
email: user.email,
isVerified: user.isVerified,
plan: user.plan,
bookingSlug: user.bookingSlug,
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
};

// ============ VERIFY EMAIL ============
export const verifyEmail = async (req, res) => {
const errors = validationResult(req);
if (!errors.isEmpty()) {
return res.status(400).json({
success: false,
errors: errors.array(),
});
}

const { email, code } = req.body;

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

if (verificationRecord.expiresAt < new Date()) {
await VerificationCode.deleteOne({ _id: verificationRecord._id });
return res.status(400).json({
success: false,
message: "Verification code has expired. Please request a new one.",
});
}

user.isVerified = true;
await user.save();

await VerificationCode.deleteOne({ _id: verificationRecord._id });

await sendWelcomeEmail(user.email, user.fullName);

const token = generateToken(user._id, user.email);

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
};

// ============ RESEND VERIFICATION ============
export const resendVerification = async (req, res) => {
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

await VerificationCode.deleteMany({ userId: user._id });

const verificationCode = generateVerificationCode();
const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

await VerificationCode.create({
userId: user._id,
code: verificationCode,
expiresAt,
});

await sendVerificationEmail(user.email, user.fullName, verificationCode);

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
};

// ============ LOGIN ============
export const login = async (req, res) => {
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

if (user.isTwoFactorEnabled) {
if (backupCode) {
const backupCodeIndex = user.twoFactorBackupCodes.indexOf(backupCode);
if (backupCodeIndex !== -1) {
user.isTwoFactorEnabled = false;
user.twoFactorSecret = null;
user.twoFactorBackupCodes = [];
await user.save();

const html = `

<div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;"> <div style="background: linear-gradient(135deg, #3b82f6, #06b6d4); padding: 30px; text-align: center;"> <h1 style="color: white;">2FA Disabled</h1> </div> <div style="padding: 30px; background: #f8fafc;"> <h2>Hello ${user.fullName},</h2> <p>Two-Factor Authentication has been <strong>disabled</strong> on your account because you used a backup code to login.</p> <p>If you did this, you can now login with just your password.</p> <p>To enable 2FA again, go to Settings → Security.</p> <p style="margin-top: 20px;">If you didn't do this, please contact support immediately.</p> </div> </div> `;
await sendEmail(user.email, "2FA Disabled - Orvexify", html);

const token = generateToken(user);
return res.json({
success: true,
twoFactorDisabled: true,
message: "2FA has been disabled. You can now login with your password.",
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
};

// ============ LOGOUT ============
export const logout = async (req, res) => {
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
};

// ============ LOGOUT ALL ============
export const logoutAll = async (req, res) => {
try {
req.user.tokenVersion = (req.user.tokenVersion || 0) + 1;
await req.user.save();

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
};

// ============ GET SESSION ============
export const getSession = async (req, res) => {
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
};

// ============ CHANGE PASSWORD ============
export const changePassword = async (req, res) => {
const { currentPassword, newPassword } = req.body;

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

const hashedPassword = await bcrypt.hash(newPassword, 10);

user.passwordHash = hashedPassword;
user.passwordChangedAt = new Date();
await user.save();

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
};

// ============ ENABLE 2FA ============
export const enable2FA = async (req, res) => {
try {
const user = await User.findById(req.user._id);

if (user.isTwoFactorEnabled) {
return res.status(400).json({
success: false,
message: "2FA is already enabled",
});
}

const secret = speakeasy.generateSecret({
name: `Orvexify:${user.email}`,
length: 20,
});

const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

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
};

// ============ VERIFY 2FA ============
export const verify2FA = async (req, res) => {
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

const backupCodes = [];
for (let i = 0; i < 8; i++) {
backupCodes.push(
Math.floor(10000000 + Math.random() * 90000000).toString(),
);
}

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
};

// ============ DISABLE 2FA ============
export const disable2FA = async (req, res) => {
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
};

// ============ GET 2FA STATUS ============
export const get2FAStatus = async (req, res) => {
res.json({
success: true,
isEnabled: req.user.isTwoFactorEnabled || false,
});
};

// ============ FORGOT PASSWORD ============
export const forgotPassword = async (req, res) => {
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

const otp = Math.floor(100000 + Math.random() * 900000).toString();
const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

const hashedToken = crypto.createHash("sha256").update(otp).digest("hex");
user.resetPasswordToken = hashedToken;
user.resetPasswordExpires = expiresAt;
await user.save();

const html = `

<!DOCTYPE html> <html> <head> <meta charset="UTF-8"> <title>Reset Your Password</title> <style> body { font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; } .container { max-width: 500px; margin: 0 auto; background: #ffffff; } .header { background: linear-gradient(135deg, #3b82f6, #06b6d4); padding: 30px 20px; text-align: center; } .header h1 { color: white; margin: 0; font-size: 28px; } .content { padding: 30px; background: #f8fafc; } .code-box { background: white; padding: 20px; text-align: center; border-radius: 12px; margin: 20px 0; border: 1px solid #e2e8f0; } .code { font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #3b82f6; font-family: monospace; } .expiry { font-size: 12px; color: #64748b; text-align: center; margin-top: 10px; } .footer { text-align: center; padding: 20px; color: #94a3b8; font-size: 12px; } </style> </head> <body> <div class="container"> <div class="header"> <h1>Orvexify</h1> </div> <div class="content"> <h2>Reset Your Password</h2> <p>We received a request to reset your password. Use the code below to continue.</p> <div class="code-box"> <div class="code">${otp}</div> </div> <div class="expiry">This code will expire in 10 minutes</div> <p style="margin-top: 20px; font-size: 14px;"> If you didn't request this, you can safely ignore this email. </p> </div> <div class="footer"> <p>&copy; 2024 Orvexify. All rights reserved.</p> </div> </div> </body> </html> `;
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
};

// ============ VERIFY OTP ============
export const verifyOTP = async (req, res) => {
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

const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

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
};

// ============ RESET PASSWORD ============
export const resetPassword = async (req, res) => {
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

const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

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

const hashedPassword = await bcrypt.hash(newPassword, 10);

user.passwordHash = hashedPassword;
user.passwordChangedAt = new Date();
user.resetPasswordToken = null;
user.resetPasswordExpires = null;
await user.save();

await TokenBlacklist.deleteMany({ userId: user._id });

const html = `

<!DOCTYPE html> <html> <head> <meta charset="UTF-8"> <title>Password Changed</title> <style> body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; } .container { max-width: 500px; margin: 0 auto; padding: 20px; } .header { background: linear-gradient(135deg, #3b82f6, #06b6d4); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; } .header h1 { color: white; margin: 0; } .content { background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px; } .button { display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; } .footer { text-align: center; padding: 20px; color: #94a3b8; font-size: 12px; } </style> </head> <body> <div class="container"> <div class="header"> <h1>Password Changed</h1> </div> <div class="content"> <h2>Hello ${user.fullName},</h2> <p>Your password has been successfully changed.</p> <p>If you didn't make this change, please contact support immediately.</p> <a href="${process.env.FRONTEND_URL}/auth/login" class="button">Login Now</a> <p style="margin-top: 20px;">Best regards,<br><strong>Orvexify Team</strong></p> </div> <div class="footer"> <p>&copy; 2024 Orvexify. All rights reserved.</p> </div> </div> </body> </html> `;
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
};

// ============ RESEND OTP ============
export const resendOTP = async (req, res) => {
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

const otp = Math.floor(100000 + Math.random() * 900000).toString();
const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

const hashedToken = crypto.createHash("sha256").update(otp).digest("hex");
user.resetPasswordToken = hashedToken;
user.resetPasswordExpires = expiresAt;
await user.save();

const html = `

<div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;"> <div style="background: linear-gradient(135deg, #3b82f6, #06b6d4); padding: 30px; text-align: center;"> <h1 style="color: white; margin: 0;">Orvexify</h1> </div> <div style="padding: 30px; background: #f8fafc;"> <h2>Reset Your Password</h2> <p>Use the code below to reset your password:</p> <div style="background: white; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #3b82f6;">${otp}</div> <p style="font-size: 12px; color: #64748b;">This code expires in 10 minutes.</p> </div> </div> `;
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
};

