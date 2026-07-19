// src/controllers/blogController.js

const BlogPost = require('../models/BlogPost');
const BlogCategory = require('../models/BlogCategory');
const BlogTag = require('../models/BlogTag');
const BlogAuthor = require('../models/BlogAuthor');
const User = require('../models/User');

// ============ GENERATE SLUG ============
const generateSlug = (title) => {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    + '-' + Date.now().toString(36);
};

// ============ CREATE BLOG POST ============
const createPost = async (req, res) => {
  try {
    const {
      title,
      content,
      excerpt,
      categories,
      tags,
      metaTitle,
      metaDescription,
      metaKeywords,
      canonicalUrl,
      ogImage,
      ogTitle,
      ogDescription,
      featuredImage,
      featuredImageAlt,
      status,
      scheduledPublishAt,
      isFeatured,
      isSticky,
      allowComments,
      showInSitemap,
      faqs,
      tableOfContents,
      relatedPosts
    } = req.body;

    // ✅ Get or create author
    let author = await BlogAuthor.findOne({ userId: req.user._id });
    if (!author) {
      author = await BlogAuthor.create({
        userId: req.user._id,
        bio: req.user.bio || '',
        avatar: req.user.avatar || '',
        socialLinks: {
          twitter: req.user.twitter || '',
          linkedin: req.user.linkedin || '',
          github: req.user.github || '',
          website: req.user.website || '',
          facebook: req.user.facebook || '',
          instagram: req.user.instagram || ''
        }
      });
    }

    // ✅ Generate slug
    const slug = generateSlug(title);

    // ✅ Create post
    const post = await BlogPost.create({
      title,
      slug,
      content,
      excerpt,
      categories: categories || [],
      tags: tags || [],
      author: author._id,
      metaTitle: metaTitle || title,
      metaDescription: metaDescription || excerpt.substring(0, 160),
      metaKeywords: metaKeywords || [],
      canonicalUrl: canonicalUrl || '',
      ogImage: ogImage || featuredImage,
      ogTitle: ogTitle || title,
      ogDescription: ogDescription || excerpt,
      featuredImage: featuredImage || '',
      featuredImageAlt: featuredImageAlt || title,
      status: status || 'draft',
      scheduledPublishAt: scheduledPublishAt || null,
      isFeatured: isFeatured || false,
      isSticky: isSticky || false,
      allowComments: allowComments !== undefined ? allowComments : true,
      showInSitemap: showInSitemap !== undefined ? showInSitemap : true,
      faqs: faqs || [],
      tableOfContents: tableOfContents || [],
      relatedPosts: relatedPosts || []
    });

    // ✅ Update category post counts
    if (categories && categories.length > 0) {
      await BlogCategory.updateMany(
        { _id: { $in: categories } },
        { $inc: { postCount: 1 } }
      );
    }

    // ✅ Update tag post counts
    if (tags && tags.length > 0) {
      await BlogTag.updateMany(
        { _id: { $in: tags } },
        { $inc: { postCount: 1 } }
      );
    }

    // ✅ Update author post count
    await BlogAuthor.findByIdAndUpdate(author._id, {
      $inc: { postCount: 1 }
    });

    res.status(201).json({
      success: true,
      message: 'Blog post created successfully',
      data: post
    });
  } catch (error) {
    console.error('❌ Create post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create blog post',
      error: error.message
    });
  }
};

// ============ GET ALL POSTS (Admin) ============
const getAllPosts = async (req, res) => {
  try {
    const { status, category, tag, author, search, page = 1, limit = 20 } = req.query;

    let query = {};

    if (status) query.status = status;
    if (category) query.categories = category;
    if (tag) query.tags = tag;
    if (author) query.author = author;

    if (search) {
      query.$text = { $search: search };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const posts = await BlogPost.find(query)
      .populate('categories', 'name slug')
      .populate('tags', 'name slug')
      .populate('author', 'userId bio avatar')
      .populate('relatedPosts', 'title slug')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await BlogPost.countDocuments(query);

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
    console.error('❌ Get posts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get blog posts',
      error: error.message
    });
  }
};

// ============ GET SINGLE POST ============
const getPostById = async (req, res) => {
  try {
    const { id } = req.params;

    const post = await BlogPost.findById(id)
      .populate('categories', 'name slug description color')
      .populate('tags', 'name slug')
      .populate('author', 'userId bio avatar socialLinks')
      .populate('relatedPosts', 'title slug featuredImage excerpt')
      .lean();

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Blog post not found'
      });
    }

    res.json({
      success: true,
      data: post
    });
  } catch (error) {
    console.error('❌ Get post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get blog post',
      error: error.message
    });
  }
};

// ============ UPDATE POST ============
const updatePost = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const post = await BlogPost.findById(id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Blog post not found'
      });
    }

    // ✅ Check if slug should be updated
    if (updates.title && updates.title !== post.title) {
      updates.slug = generateSlug(updates.title);
    }

    const updatedPost = await BlogPost.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Blog post updated successfully',
      data: updatedPost
    });
  } catch (error) {
    console.error('❌ Update post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update blog post',
      error: error.message
    });
  }
};

// ============ DELETE POST ============
const deletePost = async (req, res) => {
  try {
    const { id } = req.params;

    const post = await BlogPost.findById(id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Blog post not found'
      });
    }

    await post.deleteOne();

    res.json({
      success: true,
      message: 'Blog post deleted successfully'
    });
  } catch (error) {
    console.error('❌ Delete post error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete blog post',
      error: error.message
    });
  }
};

// ============ UPLOAD IMAGE ============
const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image uploaded'
      });
    }

    const imageUrl = `/uploads/blog/${req.file.filename}`;

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        url: imageUrl,
        filename: req.file.filename,
        size: req.file.size
      }
    });
  } catch (error) {
    console.error('❌ Upload image error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload image',
      error: error.message
    });
  }
};

// ============ CREATE CATEGORY ============
const createCategory = async (req, res) => {
  try {
    const { name, description, color } = req.body;

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const category = await BlogCategory.create({
      name,
      slug,
      description: description || '',
      color: color || '#3b82f6'
    });

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: category
    });
  } catch (error) {
    console.error('❌ Create category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create category',
      error: error.message
    });
  }
};

// ============ GET ALL CATEGORIES ============
const getAllCategories = async (req, res) => {
  try {
    const categories = await BlogCategory.find({ isActive: true })
      .sort({ name: 1 })
      .lean();

    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error('❌ Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get categories',
      error: error.message
    });
  }
};

// ============ CREATE TAG ============
const createTag = async (req, res) => {
  try {
    const { name } = req.body;

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const tag = await BlogTag.create({
      name,
      slug
    });

    res.status(201).json({
      success: true,
      message: 'Tag created successfully',
      data: tag
    });
  } catch (error) {
    console.error('❌ Create tag error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create tag',
      error: error.message
    });
  }
};

// ============ GET ALL TAGS ============
const getAllTags = async (req, res) => {
  try {
    const tags = await BlogTag.find({ isActive: true })
      .sort({ name: 1 })
      .lean();

    res.json({
      success: true,
      data: tags
    });
  } catch (error) {
    console.error('❌ Get tags error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get tags',
      error: error.message
    });
  }
};

// ============ INCREASE VIEW COUNT ============
const increaseViewCount = async (req, res) => {
  try {
    const { id } = req.params;

    await BlogPost.findByIdAndUpdate(id, {
      $inc: { viewCount: 1 }
    });

    res.json({
      success: true,
      message: 'View count increased'
    });
  } catch (error) {
    console.error('❌ View count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update view count',
      error: error.message
    });
  }
};

module.exports = {
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
};