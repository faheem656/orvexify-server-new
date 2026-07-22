// src/routes/blogPublicRoutes.js
const express = require('express');
const router = express.Router();
const BlogPost = require('../models/BlogPost');
const BlogCategory = require('../models/BlogCategory');
const BlogTag = require('../models/BlogTag');

// ============ GET PUBLIC POSTS ============
router.get('/public/blog', async (req, res) => {
  try {
    const { page = 1, limit = 10, category, tag, search } = req.query;

    // ✅ Fixed query
    let query = { 
      status: 'published'
    };

    if (category) {
      const categoryDoc = await BlogCategory.findOne({ slug: category });
      if (categoryDoc) query.categories = categoryDoc._id;
    }

    if (tag) {
      const tagDoc = await BlogTag.findOne({ slug: tag });
      if (tagDoc) query.tags = tagDoc._id;
    }

    if (search) {
      query.$text = { $search: search };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const posts = await BlogPost.find(query)
      .populate('categories', 'name slug color')
      .populate('tags', 'name slug')
      .populate({
        path: 'author',
        populate: {
          path: 'userId',
          model: 'User',
          select: 'fullName email avatar'
        }
      })
      .sort({ isSticky: -1, publishedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await BlogPost.countDocuments(query);

    console.log(`✅ Found ${posts.length} posts`);

    res.json({
      success: true,
      data: posts,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('❌ Public posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get posts',
      error: error.message
    });
  }
});

// ============ GET SINGLE POST (PUBLIC) ============
router.get('/public/blog/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const post = await BlogPost.findOne({ 
      slug, 
      status: 'published' 
    })
      .populate('categories', 'name slug color')
      .populate('tags', 'name slug')
      .populate({
        path: 'author',
        populate: {
          path: 'userId',
          model: 'User',
          select: 'fullName email avatar'
        }
      })
      .populate('relatedPosts', 'title slug featuredImage excerpt')
      .lean();

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // ✅ Increase view count
    await BlogPost.findByIdAndUpdate(post._id, {
      $inc: { viewCount: 1 }
    });

    res.json({
      success: true,
      data: post
    });
  } catch (error) {
    console.error('❌ Public post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get post',
      error: error.message
    });
  }
});

// ============ GET CATEGORIES (PUBLIC) ============
router.get('/public/blog/categories/all', async (req, res) => {
  try {
    const categories = await BlogCategory.find({ isActive: true })
      .sort({ postCount: -1 })
      .lean();

    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error('❌ Public categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get categories',
      error: error.message
    });
  }
});

// ============ GET TAGS (PUBLIC) ============
router.get('/public/blog/tags/all', async (req, res) => {
  try {
    const tags = await BlogTag.find({ isActive: true })
      .sort({ postCount: -1 })
      .lean();

    res.json({
      success: true,
      data: tags
    });
  } catch (error) {
    console.error('❌ Public tags error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tags',
      error: error.message
    });
  }
});

// ============ SEARCH POSTS ============
router.get('/public/blog/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 2) {
      return res.json({
        success: true,
        data: []
      });
    }

    const posts = await BlogPost.find({
      status: 'published',
      $text: { $search: q }
    })
    .select('title slug excerpt featuredImage publishedAt')
    .populate({
      path: 'author',
      populate: {
        path: 'userId',
        model: 'User',
        select: 'fullName'
      }
    })
    .limit(10)
    .lean();

    res.json({
      success: true,
      data: posts
    });
  } catch (error) {
    console.error('❌ Search error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search posts',
      error: error.message
    });
  }
});

// ============ FEATURED POSTS ============
router.get('/public/blog/featured', async (req, res) => {
  try {
    const posts = await BlogPost.find({
      status: 'published',
      isFeatured: true
    })
    .populate('categories', 'name slug color')
    .populate({
      path: 'author',
      populate: {
        path: 'userId',
        model: 'User',
        select: 'fullName email avatar'
      }
    })
    .sort({ publishedAt: -1 })
    .limit(5)
    .lean();

    res.json({
      success: true,
      data: posts
    });
  } catch (error) {
    console.error('❌ Featured posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get featured posts',
      error: error.message
    });
  }
});

module.exports = router;