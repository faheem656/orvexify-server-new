// src/middleware/auth.js — COMPLETE FIXED VERSION

const jwt = require("jsonwebtoken");
const TokenBlacklist = require("../models/TokenBlacklist");
const User = require("../models/User");

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token && req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Not authorized, no token",
    });
  }

  try {
    const isBlacklisted = await TokenBlacklist.findOne({ token });
    if (isBlacklisted) {
      return res.status(401).json({
        success: false,
        message: "Token has been revoked. Please login again.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-passwordHash");

    if (
      decoded.version !== undefined &&
      decoded.version !== user.tokenVersion
    ) {
      // Blacklist the old token
      await TokenBlacklist.create({
        token,
        userId: user._id,
        expiresAt: new Date(decoded.exp * 1000),
      });

      return res.status(401).json({
        success: false,
        message: "Session expired. Please login again.",
      });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.isActive === false) {
      return res.status(401).json({
        success: false,
        message: "Account is deactivated. Please contact support.",
      });
    }

    if (
      decoded.version !== undefined &&
      decoded.version !== user.tokenVersion
    ) {
      await TokenBlacklist.create({
        token,
        userId: user._id,
        expiresAt: new Date(decoded.exp * 1000),
        reason: "version_mismatch",
      });

      return res.status(401).json({
        success: false,
        message: "Session expired. Please login again.",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account is deactivated. Please contact support.",
      });
    }

    req.user = user;
    req.token = token;
    req.tokenVersion = decoded.version;

    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token",
      });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired. Please login again.",
      });
    }
    console.error("Auth middleware error:", error);
    return res.status(401).json({
      success: false,
      message: "Not authorized",
    });
  }
};

// ✅ FIXED generateToken function
const generateToken = (user, expiresIn = null) => {
  // Ensure we have a valid expiry value
  const expiry = expiresIn || process.env.JWT_EXPIRES_IN || "7d";

  const payload = {
    id: user._id,
    email: user.email,
    version: user.tokenVersion || 0,
  };

  try {
    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: expiry });
  } catch (error) {
    console.error("JWT Sign Error:", error);
    // Fallback token without expiry
    return jwt.sign(payload, process.env.JWT_SECRET);
  }
};

module.exports = { protect, generateToken };
