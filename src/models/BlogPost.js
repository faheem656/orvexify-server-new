// src/models/BlogPost.js — Fixed (Remove duplicate indexes)

const mongoose = require('mongoose');

const blogPostSchema = new mongoose.Schema({
  // ============ BASIC ============
  title: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,  // ✅ Sirf yahan unique index
    lowercase: true,
    trim: true
    // ❌ index: true hatao (duplicate)
  },
    featuredImagePublicId: { // ✅ Add this
    type: String,
    default: "",
  },
  excerpt: {
    type: String,
    required: true,
    maxlength: 200
  },
  content: {
    type: String,
    required: true
  },
  
  // ============ SEO ============
  metaTitle: {
    type: String,
    default: null
  },
  metaDescription: {
    type: String,
    default: null,
    maxlength: 160
  },
  metaKeywords: {
    type: [String],
    default: []
  },
  canonicalUrl: {
    type: String,
    default: null
  },
  ogImage: {
    type: String,
    default: null
  },
  ogTitle: {
    type: String,
    default: null
  },
  ogDescription: {
    type: String,
    default: null
  },
  
  // ============ IMAGES ============
  featuredImage: {
    type: String,
    default: null
  },
  featuredImageAlt: {
    type: String,
    default: null
  },
  images: {
    type: [String],
    default: []
  },
  
  // ============ CATEGORIES & TAGS ============
  categories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BlogCategory'
  }],
  tags: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BlogTag'
  }],
  
  // ============ AUTHOR ============
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BlogAuthor',
    required: true
  },
  
  // ============ STATUS ============
  status: {
    type: String,
    enum: ['draft', 'published', 'scheduled', 'archived'],
    default: 'draft'
  },
  isPublished: {
    type: Boolean,
    default: false
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  isSticky: {
    type: Boolean,
    default: false
  },
  
  // ============ SCHEDULE ============
  scheduledPublishAt: {
    type: Date,
    default: null
  },
  publishedAt: {
    type: Date,
    default: null
  },
  
  // ============ STATS ============
  viewCount: {
    type: Number,
    default: 0
  },
  readTime: {
    type: Number,
    default: 0
  },
  
  // ============ FAQ SCHEMA ============
  faqs: [{
    question: { type: String, required: true },
    answer: { type: String, required: true },
    position: { type: Number, default: 0 }
  }],
  
  // ============ TABLE OF CONTENTS ============
  tableOfContents: [{
    id: { type: String, required: true },
    text: { type: String, required: true },
    level: { type: Number, default: 2 },
    position: { type: Number, default: 0 }
  }],
  
  // ============ RELATED POSTS ============
  relatedPosts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BlogPost'
  }],
  
  // ============ SETTINGS ============
  allowComments: {
    type: Boolean,
    default: true
  },
  showInSitemap: {
    type: Boolean,
    default: true
  },
  password: {
    type: String,
    default: null
  },
  
  // ============ TIMESTAMPS ============
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// ============ INDEXES (Sirf yahan ek baar) ============
blogPostSchema.index({ slug: 1 });              // ✅ Unique index
blogPostSchema.index({ status: 1, publishedAt: -1 });
blogPostSchema.index({ categories: 1, status: 1 });
blogPostSchema.index({ tags: 1, status: 1 });
blogPostSchema.index({ author: 1, status: 1 });
blogPostSchema.index({ createdAt: -1 });
blogPostSchema.index({ isFeatured: 1, status: 1 });

// ============ PRE-SAVE HOOK ============
blogPostSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // ✅ Auto-calculate read time
  if (this.content) {
    const wordsPerMinute = 200;
    const wordCount = this.content.replace(/<[^>]*>/g, '').split(/\s+/).length;
    this.readTime = Math.max(1, Math.ceil(wordCount / wordsPerMinute));
  }
  
  // ✅ Auto-set publishedAt
  if (this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
    this.isPublished = true;
  }
  
  next();
});

// ============ VIRTUAL ============
blogPostSchema.virtual('url').get(function() {
  return `/blog/${this.slug}`;
});

blogPostSchema.set('toJSON', { virtuals: true });
blogPostSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('BlogPost', blogPostSchema);  