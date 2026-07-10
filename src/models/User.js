// src/models/User.js — Complete with isActive

import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    clinicName: {
      type: String,
      required: [true, "Clinic name is required"],
      trim: true,
    },
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: [true, "Password is required"],
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    plan: {
      type: String,
      enum: ["free", "starter", "pro"],
      default: "free",
    },
    timezone: {
      type: String,
      default: "Asia/Karachi",
    },
    clinicPhone: {
      type: String,
      default: "",
    },
    clinicAddress: {
      type: String,
      default: "",
    },
    isTwoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorSecret: {
      type: String,
      default: null,
    },
    twoFactorBackupCodes: {
      type: [String],
      default: [],
    },
    bookingSlug: {
      type: String,
      unique: true,
      sparse: true,
      default: null,
    },
    dateFormat: {
      type: String,
      default: "YYYY-MM-DD",
    },
    timeFormat: {
      type: String,
      enum: ["12h", "24h"],
      default: "12h",
    },
    passwordChangedAt: {
      type: Date,
      default: null,
    },
    resetPasswordToken: {
      type: String,
      default: null,
    },
    resetPasswordExpires: {
      type: Date,
      default: null,
    },
    tokenVersion: {
      type: Number,
      default: 0,
    },
    smtpHost: {
      type: String,
      default: "",
    },
    smtpPort: {
      type: String,
      default: "587",
    },
    fromEmail: {
      type: String,
      default: "",
    },
    fromName: {
      type: String,
      default: "",
    },
    emailPassword: {
      type: String,
      default: "",
    },
    useTLS: {
      type: Boolean,
      default: true,
    },
    useSSL: {
      type: Boolean,
      default: false,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    lastLoginIP: {
      type: String,
      default: "",
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.passwordHash);
};

// Update last login method
userSchema.methods.updateLastLogin = async function (ipAddress) {
  this.lastLoginAt = Date.now();
  this.lastLoginIP = ipAddress;
  await this.save();
};

// Increment token version method
userSchema.methods.incrementTokenVersion = async function () {
  this.tokenVersion += 1;
  await this.save();
  return this.tokenVersion;
};

// Method to check if password was changed after token issuance
userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10,
    );
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

export default mongoose.model("User", userSchema);
