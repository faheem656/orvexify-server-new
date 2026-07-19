// src/routes/adminRoutes.js — Complete Admin Routes

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { isAdmin } = require('../middleware/admin');
const User = require('../models/User');

// ============================================
// ============ PROMOTE TO ADMIN ============
// ============================================
// ✅ Only super_admin can promote users to admin
router.post('/admin/promote/:userId', protect, isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // ✅ Only super_admin can promote
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super_admin can promote users to admin'
      });
    }
    
    // ✅ Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // ✅ Check if already admin
    if (user.role === 'admin') {
      return res.status(400).json({
        success: false,
        message: 'User is already an admin'
      });
    }
    
    // ✅ Check if already super_admin
    if (user.role === 'super_admin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot demote super_admin'
      });
    }
    
    // ✅ Promote to admin
    user.role = 'admin';
    await user.save();
    
    console.log(`✅ ${user.email} promoted to admin by ${req.user.email}`);
    
    res.json({
      success: true,
      message: `User ${user.email} promoted to admin successfully`,
      data: { 
        id: user._id, 
        email: user.email, 
        name: user.name,
        role: user.role 
      }
    });
  } catch (error) {
    console.error('❌ Promote error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to promote user',
      error: error.message
    });
  }
});

// ============================================
// ============ DEMOTE FROM ADMIN ============
// ============================================
router.post('/admin/demote/:userId', protect, isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // ✅ Only super_admin can demote
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super_admin can demote users'
      });
    }
    
    // ✅ Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // ✅ Cannot demote super_admin
    if (user.role === 'super_admin') {
      return res.status(400).json({
        success: false,
        message: 'Cannot demote super_admin'
      });
    }
    
    // ✅ Check if already user
    if (user.role === 'user') {
      return res.status(400).json({
        success: false,
        message: 'User is already a normal user'
      });
    }
    
    // ✅ Demote to user
    user.role = 'user';
    await user.save();
    
    console.log(`✅ ${user.email} demoted to user by ${req.user.email}`);
    
    res.json({
      success: true,
      message: `User ${user.email} demoted to user successfully`,
      data: { 
        id: user._id, 
        email: user.email, 
        name: user.name,
        role: user.role 
      }
    });
  } catch (error) {
    console.error('❌ Demote error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to demote user',
      error: error.message
    });
  }
});

// ============================================
// ============ GET ALL USERS ============
// ============================================
router.get('/admin/users', protect, isAdmin, async (req, res) => {
  try {
    // ✅ Only super_admin and admin can view users
    if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    
    const { role, search, page = 1, limit = 20 } = req.query;
    
    let query = {};
    if (role) query.role = role;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const users = await User.find(query)
      .select('-passwordHash -tokenVersion -__v')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const total = await User.countDocuments(query);
    
    res.json({
      success: true,
      data: users,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('❌ Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users',
      error: error.message
    });
  }
});

// ============================================
// ============ GET ADMIN STATS ============
// ============================================
router.get('/admin/stats', protect, isAdmin, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalAdmins = await User.countDocuments({ role: 'admin' });
    const totalSuperAdmins = await User.countDocuments({ role: 'super_admin' });
    const totalActiveUsers = await User.countDocuments({ isActive: true });
    
    res.json({
      success: true,
      data: {
        totalUsers,
        totalAdmins,
        totalSuperAdmins,
        totalActiveUsers,
        totalInactiveUsers: totalUsers - totalActiveUsers
      }
    });
  } catch (error) {
    console.error('❌ Stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get stats',
      error: error.message
    });
  }
});

// ============================================
// ============ UPDATE USER ============
// ============================================
router.put('/admin/users/:userId', protect, isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, email, isActive } = req.body;
    
    // ✅ Only super_admin and admin can update
    if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    
    // ✅ Cannot update super_admin unless you're super_admin
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    if (targetUser.role === 'super_admin' && req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super_admin can update super_admin'
      });
    }
    
    const updates = {};
    if (name) updates.name = name;
    if (email) updates.email = email;
    if (typeof isActive === 'boolean') updates.isActive = isActive;
    
    const user = await User.findByIdAndUpdate(
      userId,
      updates,
      { new: true, runValidators: true }
    ).select('-passwordHash -tokenVersion -__v');
    
    res.json({
      success: true,
      message: 'User updated successfully',
      data: user
    });
  } catch (error) {
    console.error('❌ Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user',
      error: error.message
    });
  }
});

// ============================================
// ============ DELETE USER ============
// ============================================
router.delete('/admin/users/:userId', protect, isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // ✅ Only super_admin can delete
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super_admin can delete users'
      });
    }
    
    // ✅ Cannot delete self
    if (userId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete yourself'
      });
    }
    
    const user = await User.findByIdAndDelete(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    console.log(`✅ User ${user.email} deleted by ${req.user.email}`);
    
    res.json({
      success: true,
      message: `User ${user.email} deleted successfully`
    });
  } catch (error) {
    console.error('❌ Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user',
      error: error.message
    });
  }
});

module.exports = router;