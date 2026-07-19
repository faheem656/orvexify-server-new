// src/routes/blogRoutes.js — With Admin Check

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { isAdmin } = require('../middleware/admin');  // ✅ Import admin middleware
const { uploadSingle } = require('../middleware/upload');
const {
  createPost,
  getAllPosts,
  getPostById,
  updatePost,
  deletePost,
  uploadImage,
  createCategory,
  getAllCategories,
  createTag,
  getAllTags,
  increaseViewCount
} = require('../controllers/blogController');

// ============ ADMIN ROUTES (protect + isAdmin) ============
router.post('/blog/posts', protect, isAdmin, createPost);        // ✅ Admin only
router.get('/blog/posts', protect, isAdmin, getAllPosts);       // ✅ Admin only
router.get('/blog/posts/:id', protect, isAdmin, getPostById);   // ✅ Admin only
router.put('/blog/posts/:id', protect, isAdmin, updatePost);    // ✅ Admin only
router.delete('/blog/posts/:id', protect, isAdmin, deletePost); // ✅ Admin only

router.post('/blog/upload', protect, isAdmin, uploadSingle, uploadImage); // ✅ Admin only

router.post('/blog/categories', protect, isAdmin, createCategory); // ✅ Admin only
router.get('/blog/categories', protect, isAdmin, getAllCategories); // ✅ Admin only

router.post('/blog/tags', protect, isAdmin, createTag);        // ✅ Admin only
router.get('/blog/tags', protect, isAdmin, getAllTags);        // ✅ Admin only

// ============ PUBLIC ROUTES (No auth) ============
router.post('/blog/posts/:id/view', increaseViewCount);

module.exports = router;