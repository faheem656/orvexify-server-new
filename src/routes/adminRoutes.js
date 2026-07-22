// src/routes/adminRoutes.js — Complete Admin Routes (Production Ready)

const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/auth");
const { isAdmin } = require("../middleware/admin");
const User = require("../models/User");
const mongoose = require("mongoose");

// ============================================
// ============ HELPER FUNCTIONS ============
// ============================================

// Validate ObjectId
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Logging function
const logAction = (action, performedBy, targetUser, details = {}) => {
  console.log(`[ADMIN] ${action} | By: ${performedBy} | Target: ${targetUser} | Details:`, details);
};

// ============================================
// ============ PROMOTE TO ADMIN ============
// ============================================
/**
 * @route   POST /api/admin/promote/:userId
 * @desc    Promote a user to admin
 * @access  Super Admin only
 */
router.post("/admin/promote/:userId", protect, isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    // ✅ Validate ObjectId
    if (!isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    // ✅ Only super_admin can promote
    if (req.user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Only super_admin can promote users to admin",
      });
    }

    // ✅ Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // ✅ Check if user is active
    if (!user.isActive) {
      return res.status(400).json({
        success: false,
        message: "Cannot promote an inactive user. Activate the user first.",
      });
    }

    // ✅ Check if user is verified
    if (!user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Cannot promote an unverified user. User must verify email first.",
      });
    }

    // ✅ Check if already admin
    if (user.role === "admin") {
      return res.status(400).json({
        success: false,
        message: "User is already an admin",
      });
    }

    // ✅ Check if already super_admin
    if (user.role === "super_admin") {
      return res.status(400).json({
        success: false,
        message: "Cannot modify super_admin role",
      });
    }

    // ✅ Prevent promoting self (if somehow self)
    if (userId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot promote yourself",
      });
    }

    // ✅ Promote to admin
    user.role = "admin";
    await user.save();

    logAction(
      "PROMOTE_TO_ADMIN",
      req.user.email,
      user.email,
      { userId: user._id, role: user.role }
    );

    res.json({
      success: true,
      message: `User ${user.email} promoted to admin successfully`,
      data: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive,
        isVerified: user.isVerified,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error("❌ Promote error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to promote user",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================
// ============ DEMOTE FROM ADMIN ============
// ============================================
/**
 * @route   POST /api/admin/demote/:userId
 * @desc    Demote an admin to regular user
 * @access  Super Admin only
 */
router.post("/admin/demote/:userId", protect, isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    // ✅ Validate ObjectId
    if (!isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    // ✅ Only super_admin can demote
    if (req.user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Only super_admin can demote users",
      });
    }

    // ✅ Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // ✅ Cannot demote self
    if (userId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot demote yourself",
      });
    }

    // ✅ Cannot demote super_admin
    if (user.role === "super_admin") {
      return res.status(400).json({
        success: false,
        message: "Cannot demote super_admin",
      });
    }

    // ✅ Check if already user
    if (user.role === "user") {
      return res.status(400).json({
        success: false,
        message: "User is already a normal user",
      });
    }

    // ✅ Check if user is active
    if (!user.isActive) {
      return res.status(400).json({
        success: false,
        message: "Cannot demote an inactive user",
      });
    }

    // ✅ Demote to user
    user.role = "user";
    await user.save();

    logAction(
      "DEMOTE_FROM_ADMIN",
      req.user.email,
      user.email,
      { userId: user._id, oldRole: "admin", newRole: "user" }
    );

    res.json({
      success: true,
      message: `User ${user.email} demoted to user successfully`,
      data: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error("❌ Demote error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to demote user",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================
// ============ GET ALL USERS ============
// ============================================
/**
 * @route   GET /api/admin/users
 * @desc    Get all users with filtering and pagination
 * @access  Admin & Super Admin
 */
router.get("/admin/users", protect, isAdmin, async (req, res) => {
  try {
    // ✅ Only super_admin and admin can view users
    if (req.user.role !== "super_admin" && req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    // ✅ Parse query parameters with defaults
    const {
      role,
      search,
      isActive,
      isVerified,
      plan,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // ✅ Build query
    let query = {};

    // Role filter
    if (role && ["user", "admin", "super_admin"].includes(role)) {
      query.role = role;
    }

    // Active status filter
    if (typeof isActive !== "undefined") {
      query.isActive = isActive === "true";
    }

    // Verified status filter
    if (typeof isVerified !== "undefined") {
      query.isVerified = isVerified === "true";
    }

    // Plan filter
    if (plan && ["free", "starter", "pro"].includes(plan)) {
      query.plan = plan;
    }

    // Search filter
    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: "i" };
      query.$or = [
        { fullName: searchRegex },
        { email: searchRegex },
        { clinicName: searchRegex },
      ];
    }

    // ✅ Pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // ✅ Sorting
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === "asc" ? 1 : -1;

    // ✅ Exclude sensitive fields
    const excludedFields = "-passwordHash -tokenVersion -__v -twoFactorSecret -resetPasswordToken -resetPasswordExpires -emailPassword";

    // ✅ Execute query
    const [users, total] = await Promise.all([
      User.find(query)
        .select(excludedFields)
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: users,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1,
      },
      filters: {
        role: role || null,
        search: search || null,
        isActive: isActive || null,
        isVerified: isVerified || null,
        plan: plan || null,
      },
    });
  } catch (error) {
    console.error("❌ Get users error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get users",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================
// ============ GET USER BY ID ============
// ============================================
/**
 * @route   GET /api/admin/users/:userId
 * @desc    Get single user by ID
 * @access  Admin & Super Admin
 */
router.get("/admin/users/:userId", protect, isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    // ✅ Validate ObjectId
    if (!isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    // ✅ Check if user exists
    const user = await User.findById(userId)
      .select("-passwordHash -tokenVersion -__v -twoFactorSecret -resetPasswordToken -resetPasswordExpires -emailPassword")
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // ✅ Check if user can view this user
    if (user.role === "super_admin" && req.user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Only super_admin can view super_admin details",
      });
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("❌ Get user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get user",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================
// ============ GET ADMIN STATS ============
// ============================================
/**
 * @route   GET /api/admin/stats
 * @desc    Get admin dashboard statistics
 * @access  Admin & Super Admin
 */
router.get("/admin/stats", protect, isAdmin, async (req, res) => {
  try {
    // ✅ Run all counts in parallel for better performance
    const [
      totalUsers,
      totalAdmins,
      totalSuperAdmins,
      totalActiveUsers,
      totalVerifiedUsers,
      totalInactiveUsers,
      usersByPlan,
      recentUsers,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "admin" }),
      User.countDocuments({ role: "super_admin" }),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ isVerified: true }),
      User.countDocuments({ isActive: false }),
      User.aggregate([
        { $group: { _id: "$plan", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      User.find()
        .select("fullName email role isActive isVerified createdAt")
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
    ]);

    // ✅ Format plan statistics
    const planStats = {
      free: 0,
      starter: 0,
      pro: 0,
    };
    usersByPlan.forEach((item) => {
      if (item._id in planStats) {
        planStats[item._id] = item.count;
      }
    });

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          active: totalActiveUsers,
          inactive: totalInactiveUsers,
          verified: totalVerifiedUsers,
          unverified: totalUsers - totalVerifiedUsers,
        },
        roles: {
          admins: totalAdmins,
          superAdmins: totalSuperAdmins,
          regularUsers: totalUsers - totalAdmins - totalSuperAdmins,
        },
        plans: planStats,
        recentUsers,
      },
    });
  } catch (error) {
    console.error("❌ Stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get stats",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================
// ============ UPDATE USER ============
// ============================================
/**
 * @route   PUT /api/admin/users/:userId
 * @desc    Update user details
 * @access  Admin & Super Admin
 */
router.put("/admin/users/:userId", protect, isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { fullName, email, isActive, isVerified, plan, clinicName, clinicPhone, clinicAddress } = req.body;

    // ✅ Validate ObjectId
    if (!isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    // ✅ Check if user exists
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // ✅ Cannot update super_admin unless you're super_admin
    if (targetUser.role === "super_admin" && req.user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Only super_admin can update super_admin",
      });
    }

    // ✅ Cannot update yourself to inactive
    if (userId === req.user._id.toString() && isActive === false) {
      return res.status(400).json({
        success: false,
        message: "You cannot deactivate your own account",
      });
    }

    // ✅ Prevent email duplicate
    if (email && email !== targetUser.email) {
      const emailExists = await User.findOne({ email: email.toLowerCase() });
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: "Email already in use",
        });
      }
    }

    // ✅ Build updates object
    const updates = {};
    if (fullName) updates.fullName = fullName.trim();
    if (email) updates.email = email.toLowerCase().trim();
    if (typeof isActive === "boolean") updates.isActive = isActive;
    if (typeof isVerified === "boolean") updates.isVerified = isVerified;
    if (plan && ["free", "starter", "pro"].includes(plan)) updates.plan = plan;
    if (clinicName) updates.clinicName = clinicName.trim();
    if (clinicPhone) updates.clinicPhone = clinicPhone.trim();
    if (clinicAddress) updates.clinicAddress = clinicAddress.trim();

    // ✅ Prevent super_admin from being deactivated
    if (targetUser.role === "super_admin" && updates.isActive === false) {
      return res.status(400).json({
        success: false,
        message: "Cannot deactivate super_admin account",
      });
    }

    // ✅ Update user
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updates,
      {
        new: true,
        runValidators: true,
        context: "query",
      }
    ).select("-passwordHash -tokenVersion -__v -twoFactorSecret -resetPasswordToken -resetPasswordExpires -emailPassword");

    logAction(
      "UPDATE_USER",
      req.user.email,
      targetUser.email,
      { userId, updates }
    );

    res.json({
      success: true,
      message: "User updated successfully",
      data: updatedUser,
    });
  } catch (error) {
    console.error("❌ Update user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update user",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================
// ============ DELETE USER ============
// ============================================
/**
 * @route   DELETE /api/admin/users/:userId
 * @desc    Delete a user permanently
 * @access  Super Admin only
 */
router.delete("/admin/users/:userId", protect, isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    // ✅ Validate ObjectId
    if (!isValidObjectId(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
      });
    }

    // ✅ Only super_admin can delete
    if (req.user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Only super_admin can delete users",
      });
    }

    // ✅ Cannot delete self
    if (userId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete your own account",
      });
    }

    // ✅ Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // ✅ Cannot delete super_admin
    if (user.role === "super_admin") {
      return res.status(400).json({
        success: false,
        message: "Cannot delete super_admin account",
      });
    }

    // ✅ Store user info before deletion for response
    const userInfo = {
      id: user._id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };

    // ✅ Delete user
    await User.findByIdAndDelete(userId);

    logAction(
      "DELETE_USER",
      req.user.email,
      user.email,
      { userId: user._id, role: user.role }
    );

    res.json({
      success: true,
      message: `User ${user.email} deleted successfully`,
      data: userInfo,
    });
  } catch (error) {
    console.error("❌ Delete user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete user",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================
// ============ BULK ACTIONS ============
// ============================================

/**
 * @route   POST /api/admin/users/bulk/activate
 * @desc    Bulk activate users
 * @access  Super Admin only
 */
router.post("/admin/users/bulk/activate", protect, isAdmin, async (req, res) => {
  try {
    const { userIds } = req.body;

    // ✅ Validate input
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of user IDs",
      });
    }

    // ✅ Only super_admin can bulk activate
    if (req.user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Only super_admin can perform bulk actions",
      });
    }

    // ✅ Validate all IDs
    const invalidIds = userIds.filter(id => !isValidObjectId(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
        invalidIds,
      });
    }

    // ✅ Bulk update
    const result = await User.updateMany(
      { _id: { $in: userIds } },
      { isActive: true }
    );

    logAction(
      "BULK_ACTIVATE",
      req.user.email,
      `${result.modifiedCount} users`,
      { userIds, count: result.modifiedCount }
    );

    res.json({
      success: true,
      message: `${result.modifiedCount} users activated successfully`,
      data: {
        matched: result.matchedCount,
        modified: result.modifiedCount,
      },
    });
  } catch (error) {
    console.error("❌ Bulk activate error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to bulk activate users",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

/**
 * @route   POST /api/admin/users/bulk/deactivate
 * @desc    Bulk deactivate users
 * @access  Super Admin only
 */
router.post("/admin/users/bulk/deactivate", protect, isAdmin, async (req, res) => {
  try {
    const { userIds } = req.body;

    // ✅ Validate input
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of user IDs",
      });
    }

    // ✅ Only super_admin can bulk deactivate
    if (req.user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Only super_admin can perform bulk actions",
      });
    }

    // ✅ Cannot deactivate self
    if (userIds.includes(req.user._id.toString())) {
      return res.status(400).json({
        success: false,
        message: "You cannot deactivate your own account",
      });
    }

    // ✅ Validate all IDs
    const invalidIds = userIds.filter(id => !isValidObjectId(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
        invalidIds,
      });
    }

    // ✅ Check for super_admin in the list
    const superAdmins = await User.find({
      _id: { $in: userIds },
      role: "super_admin",
    }).select("_id");

    if (superAdmins.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot deactivate super_admin accounts",
        superAdminIds: superAdmins.map(u => u._id),
      });
    }

    // ✅ Bulk update
    const result = await User.updateMany(
      { _id: { $in: userIds } },
      { isActive: false }
    );

    logAction(
      "BULK_DEACTIVATE",
      req.user.email,
      `${result.modifiedCount} users`,
      { userIds, count: result.modifiedCount }
    );

    res.json({
      success: true,
      message: `${result.modifiedCount} users deactivated successfully`,
      data: {
        matched: result.matchedCount,
        modified: result.modifiedCount,
      },
    });
  } catch (error) {
    console.error("❌ Bulk deactivate error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to bulk deactivate users",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

/**
 * @route   DELETE /api/admin/users/bulk/delete
 * @desc    Bulk delete users
 * @access  Super Admin only
 */
router.delete("/admin/users/bulk/delete", protect, isAdmin, async (req, res) => {
  try {
    const { userIds } = req.body;

    // ✅ Validate input
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide an array of user IDs",
      });
    }

    // ✅ Only super_admin can bulk delete
    if (req.user.role !== "super_admin") {
      return res.status(403).json({
        success: false,
        message: "Only super_admin can perform bulk actions",
      });
    }

    // ✅ Cannot delete self
    if (userIds.includes(req.user._id.toString())) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account",
      });
    }

    // ✅ Validate all IDs
    const invalidIds = userIds.filter(id => !isValidObjectId(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format",
        invalidIds,
      });
    }

    // ✅ Check for super_admin in the list
    const superAdmins = await User.find({
      _id: { $in: userIds },
      role: "super_admin",
    }).select("_id");

    if (superAdmins.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete super_admin accounts",
        superAdminIds: superAdmins.map(u => u._id),
      });
    }

    // ✅ Bulk delete
    const result = await User.deleteMany({ _id: { $in: userIds } });

    logAction(
      "BULK_DELETE",
      req.user.email,
      `${result.deletedCount} users`,
      { userIds, count: result.deletedCount }
    );

    res.json({
      success: true,
      message: `${result.deletedCount} users deleted successfully`,
      data: {
        deleted: result.deletedCount,
      },
    });
  } catch (error) {
    console.error("❌ Bulk delete error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to bulk delete users",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// ============================================
// ============ EXPORT ROUTER ============
// ============================================

module.exports = router;