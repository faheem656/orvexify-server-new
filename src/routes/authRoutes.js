// src/routes/authRoutes.js
import express from "express";
const router = express.Router();
import { body } from "express-validator";
import {
register,
verifyEmail,
resendVerification,
login,
logout,
logoutAll,
getSession,
changePassword,
enable2FA,
verify2FA,
disable2FA,
get2FAStatus,
forgotPassword,
verifyOTP,
resetPassword,
resendOTP,
} from "../controllers/authController.js";
import { protect } from "../middleware/auth.js";

// ============ REGISTER ============
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
register
);

// ============ VERIFY EMAIL ============
router.post(
"/verify-email",
[
body("email").isEmail().withMessage("Valid email is required"),
body("code")
.isLength({ min: 6, max: 6 })
.withMessage("6-digit code is required"),
],
verifyEmail
);

// ============ RESEND VERIFICATION ============
router.post(
"/resend-verification",
[body("email").isEmail().withMessage("Valid email is required")],
resendVerification
);

// ============ LOGIN ============
router.post("/login", login);

// ============ LOGOUT ============
router.post("/logout", protect, logout);

// ============ LOGOUT ALL ============
router.post("/logout-all", protect, logoutAll);

// ============ GET SESSION ============
router.get("/session", protect, getSession);

// ============ CHANGE PASSWORD ============
router.post("/change-password", protect, changePassword);

// ============ 2FA ============
router.post("/2fa/enable", protect, enable2FA);
router.post("/2fa/verify", protect, verify2FA);
router.post("/2fa/disable", protect, disable2FA);
router.get("/2fa/status", protect, get2FAStatus);

// ============ FORGOT PASSWORD ============
router.post("/forgot-password", forgotPassword);
router.post("/verify-otp", verifyOTP);
router.post("/reset-password", resetPassword);
router.post("/resend-otp", resendOTP);

export default router;