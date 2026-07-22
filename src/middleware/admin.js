// src/middleware/admin.js

const User = require("../models/User");

const isAdmin = async (req, res, next) => {
  try {
    // ✅ User already attached by protect middleware
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: User not found",
      });
    }

    // ✅ Check if user has admin role
    const user = await User.findById(req.user._id);

     if (!req.user.isActive) {
      return res.status(403).json({
        success: false,
        message: "Account is deactivated. Please contact support."
      });
    }
    
    if (req.user.role === "admin" || req.user.role === "super_admin") {
      return next();
    }

    next();
  } catch (error) {
    console.error("❌ Admin check error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = { isAdmin };
