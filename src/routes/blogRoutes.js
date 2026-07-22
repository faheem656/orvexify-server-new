const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { isAdmin } = require('../middleware/admin');
const {
  // Posts
  createPost,
  getAllPosts,
  getPostById,
  updatePost,
  deletePost,
  uploadImage,
  increaseViewCount,
  
  // Categories
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
  
  // Tags
  createTag,
  getAllTags,
  getTagById,
  updateTag,
  deleteTag,
  
  // Authors
  getAuthors,
  deleteImage,
} = require('../controllers/blogController');
const { upload } = require('../config/cloudinary');

// ============================================
// ============ BLOG POSTS ============
// ============================================

// Admin routes
router.post('/blog/posts', protect, isAdmin, createPost);
router.get('/blog/posts', protect, isAdmin, getAllPosts);
router.get('/blog/posts/:id', protect, isAdmin, getPostById);
router.put('/blog/posts/:id', protect, isAdmin, updatePost);
router.delete('/blog/posts/:id', protect, isAdmin, deletePost);

// ✅ Image upload - use Cloudinary upload
router.post('/blog/upload', protect, isAdmin, upload.single('image'), uploadImage);
router.delete('/blog/delete-image/:publicId', protect, isAdmin, deleteImage);

// Public routes
router.post('/blog/posts/:id/view', increaseViewCount);

// ============================================
// ============ BLOG CATEGORIES ============
// ============================================

// Admin routes - Full CRUD
router.post('/blog/categories', protect, isAdmin, createCategory);
router.get('/blog/categories', protect, isAdmin, getAllCategories);
router.get('/blog/categories/:id', protect, isAdmin, getCategoryById);
router.put('/blog/categories/:id', protect, isAdmin, updateCategory);
router.delete('/blog/categories/:id', protect, isAdmin, deleteCategory);

// ============================================
// ============ BLOG TAGS ============
// ============================================

// Admin routes - Full CRUD
router.post('/blog/tags', protect, isAdmin, createTag);
router.get('/blog/tags', protect, isAdmin, getAllTags);
router.get('/blog/tags/:id', protect, isAdmin, getTagById);
router.put('/blog/tags/:id', protect, isAdmin, updateTag);
router.delete('/blog/tags/:id', protect, isAdmin, deleteTag);

// ============================================
// ============ BLOG AUTHORS ============
// ============================================

router.get('/blog/authors', protect, isAdmin, getAuthors);

module.exports = router;