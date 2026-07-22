const BlogPost = require("../models/BlogPost");
const BlogCategory = require("../models/BlogCategory");
const BlogTag = require("../models/BlogTag");
const BlogAuthor = require("../models/BlogAuthor");
const User = require("../models/User");
const { cloudinary } = require("../config/cloudinary");

// ============================================
// ============ HELPER FUNCTIONS ============
// ============================================

const generateSlug = (title) => {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") +
    "-" +
    Date.now().toString(36)
  );
};

// ✅ IMPROVED: Extract public ID from Cloudinary URL
const extractPublicId = (url) => {
  if (!url) return null;

  console.log("📌 Extracting publicId from:", url);

  // Method 1: Standard Cloudinary URL
  // https://res.cloudinary.com/cloud-name/image/upload/v1234567890/folder/image.jpg
  let match = url.match(/\/upload\/(?:v\d+\/)?(.+?)\./);
  if (match) {
    console.log("📌 Extracted publicId (Method 1):", match[1]);
    return match[1];
  }

  // Method 2: If URL has folder structure
  // https://res.cloudinary.com/cloud-name/image/upload/folder/image.jpg
  match = url.match(/\/upload\/(.+?)\./);
  if (match) {
    console.log("📌 Extracted publicId (Method 2):", match[1]);
    return match[1];
  }

  // Method 3: If only publicId is passed (not full URL)
  if (!url.includes("/")) {
    console.log("📌 Using publicId as is:", url);
    return url;
  }

  console.log("❌ Could not extract publicId");
  return null;
};

// ✅ Delete image from Cloudinary
const deleteImageFromCloudinary = async (publicId) => {
  try {
    if (!publicId) return { success: false, message: "No publicId provided" };
    
    console.log("📌 Deleting from Cloudinary:", publicId);
    
    const result = await cloudinary.uploader.destroy(publicId, {
      invalidate: true
    });
    
    if (result.result === "ok") {
      return { success: true, message: "Image deleted successfully" };
    } else if (result.result === "not found") {
      return { success: false, message: "Image not found or already deleted" };
    } else {
      return { success: false, message: "Failed to delete image", details: result };
    }
  } catch (error) {
    console.error("❌ Cloudinary delete error:", error);
    return { success: false, message: error.message };
  }
};


// ============================================
// ============ BLOG POSTS ============
// ============================================

// CREATE POST
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
      relatedPosts,
    } = req.body;

    // Get or create author
    let author = await BlogAuthor.findOne({ userId: req.user._id });
    if (!author) {
      author = await BlogAuthor.create({
        userId: req.user._id,
        bio: req.user.bio || "",
        avatar: req.user.avatar || "",
        socialLinks: {
          twitter: req.user.twitter || "",
          linkedin: req.user.linkedin || "",
          github: req.user.github || "",
          website: req.user.website || "",
          facebook: req.user.facebook || "",
          instagram: req.user.instagram || "",
        },
      });
    }

    const slug = generateSlug(title);

    const post = await BlogPost.create({
      title,
      slug,
      content,
      excerpt,
      categories: categories || [],
      tags: tags || [],
      author: author._id,
      metaTitle: metaTitle || title,
      metaDescription: metaDescription || excerpt?.substring(0, 160) || "",
      metaKeywords: metaKeywords || [],
      canonicalUrl: canonicalUrl || "",
      ogImage: ogImage || featuredImage,
      ogTitle: ogTitle || title,
      ogDescription: ogDescription || excerpt,
      featuredImage: featuredImage || "",
      featuredImageAlt: featuredImageAlt || title,
      status: status || "draft",
      scheduledPublishAt: scheduledPublishAt || null,
      isFeatured: isFeatured || false,
      isSticky: isSticky || false,
      allowComments: allowComments !== undefined ? allowComments : true,
      showInSitemap: showInSitemap !== undefined ? showInSitemap : true,
      faqs: faqs || [],
      tableOfContents: tableOfContents || [],
      relatedPosts: relatedPosts || [],
    });

    // Update category post counts
    if (categories && categories.length > 0) {
      await BlogCategory.updateMany(
        { _id: { $in: categories } },
        { $inc: { postCount: 1 } },
      );
    }

    // Update tag post counts
    if (tags && tags.length > 0) {
      await BlogTag.updateMany(
        { _id: { $in: tags } },
        { $inc: { postCount: 1 } },
      );
    }

    await BlogAuthor.findByIdAndUpdate(author._id, {
      $inc: { postCount: 1 },
    });

    res.status(201).json({
      success: true,
      message: "Blog post created successfully",
      data: post,
    });
  } catch (error) {
    console.error("❌ Create post error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create blog post",
      error: error.message,
    });
  }
};

// GET ALL POSTS
const getAllPosts = async (req, res) => {
  try {
    const {
      status,
      category,
      tag,
      author,
      search,
      page = 1,
      limit = 20,
    } = req.query;

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
      .populate("categories", "name slug")
      .populate("tags", "name slug")
      .populate({
        path: "author",
        populate: {
          path: "userId",
          model: "User",
          select: "fullName email",
        },
      })
      .populate("relatedPosts", "title slug")
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
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("❌ Get posts error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get blog posts",
      error: error.message,
    });
  }
};

// GET SINGLE POST
const getPostById = async (req, res) => {
  try {
    const { id } = req.params;

    const post = await BlogPost.findById(id)
      .populate("categories", "name slug description color")
      .populate("tags", "name slug")
      .populate({
        path: "author",
        populate: {
          path: "userId",
          model: "User",
          select: "fullName email avatar",
        },
      })
      .populate("relatedPosts", "title slug featuredImage excerpt")
      .lean();

    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Blog post not found",
      });
    }

    res.json({
      success: true,
      data: post,
    });
  } catch (error) {
    console.error("❌ Get post error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get blog post",
      error: error.message,
    });
  }
};

// UPDATE POST
const updatePost = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const post = await BlogPost.findById(id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Blog post not found",
      });
    }

    if (updates.title && updates.title !== post.title) {
      updates.slug = generateSlug(updates.title);
    }

    const updatedPost = await BlogPost.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true },
    );

    res.json({
      success: true,
      message: "Blog post updated successfully",
      data: updatedPost,
    });
  } catch (error) {
    console.error("❌ Update post error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update blog post",
      error: error.message,
    });
  }
};


// ✅ FIXED: DELETE POST with Cloudinary image deletion
const deletePost = async (req, res) => {
  try {
    const { id } = req.params;

    const post = await BlogPost.findById(id);
    if (!post) {
      return res.status(404).json({
        success: false,
        message: "Blog post not found",
      });
    }

    console.log("📌 Deleting post:", post.title);
    console.log("📌 Featured Image:", post.featuredImage);

    // ✅ 1. Delete featured image from Cloudinary if exists
    if (post.featuredImage) {
      const publicId = extractPublicId(post.featuredImage);
      
      if (publicId) {
        console.log("📌 Deleting featured image from Cloudinary...");
        await deleteImageFromCloudinary(publicId);
      }
    }

    // ✅ 2. Delete images from content (if any)
    if (post.content) {
      // Find all Cloudinary image URLs in content
      const cloudinaryUrls = post.content.match(/https?:\/\/res\.cloudinary\.com\/[^\s"']+\.(?:jpg|jpeg|png|gif|webp)/g) || [];
      
      console.log(`📌 Found ${cloudinaryUrls.length} images in content`);
      
      for (const url of cloudinaryUrls) {
        const publicId = extractPublicId(url);
        if (publicId) {
          console.log(`📌 Deleting content image: ${publicId}`);
          await deleteImageFromCloudinary(publicId);
        }
      }
    }

    // ✅ 3. Remove post from categories and tags
    await BlogCategory.updateMany(
      { _id: { $in: post.categories } },
      { $inc: { postCount: -1 } }
    );

    await BlogTag.updateMany(
      { _id: { $in: post.tags } },
      { $inc: { postCount: -1 } }
    );

    // ✅ 4. Delete post from database
    await post.deleteOne();

    console.log("✅ Post deleted successfully:", post.title);

    res.json({
      success: true,
      message: "Blog post deleted successfully",
      data: {
        deleted: true,
        postId: id,
        title: post.title,
      }
    });
  } catch (error) {
    console.error("❌ Delete post error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete blog post",
      error: error.message,
    });
  }
};

// ============================================
// ============ IMAGE UPLOAD ============
// ============================================

// ✅ Upload Image - Cloudinary
const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No image uploaded",
      });
    }

    // Cloudinary returns URL in req.file.path
    const imageUrl = req.file.path;
    
    // ✅ Extract public ID from Cloudinary URL
    const extractedPublicId = extractPublicId(imageUrl);

    console.log("✅ Image uploaded to Cloudinary:", imageUrl);
    console.log("✅ Public ID:", extractedPublicId);

    res.json({
      success: true,
      message: "Image uploaded successfully",
      data: {
        url: imageUrl,
        publicId: extractedPublicId || req.file.filename,
        size: req.file.size,
        format: req.file.mimetype,
      },
    });
  } catch (error) {
    console.error("❌ Upload image error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload image",
      error: error.message,
    });
  }
};

// ✅ FIXED: Delete Image from Cloudinary
const deleteImage = async (req, res) => {
  try {
    let { publicId } = req.params;

    console.log("📌 Received publicId from params:", publicId);

    if (!publicId) {
      return res.status(400).json({
        success: false,
        message: "Public ID is required",
      });
    }

    // ✅ Clean the public ID
    let cleanPublicId = publicId;
    
    // If it's a full URL, extract the public ID
    if (publicId.includes('cloudinary') || publicId.includes('res.cloudinary.com')) {
      const extracted = extractPublicId(publicId);
      if (extracted) {
        cleanPublicId = extracted;
      }
    }
    
    // Remove any query parameters
    cleanPublicId = cleanPublicId.split('?')[0];
    
    console.log("📌 Cleaned publicId for deletion:", cleanPublicId);

    // ✅ Delete from Cloudinary
    const result = await cloudinary.uploader.destroy(cleanPublicId, {
      invalidate: true // Invalidate CDN cache
    });

    console.log("📌 Cloudinary delete result:", result);

    if (result.result === "ok") {
      res.json({
        success: true,
        message: "Image deleted successfully",
      });
    } else if (result.result === "not found") {
      res.status(404).json({
        success: false,
        message: "Image not found or already deleted",
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to delete image",
        details: result,
      });
    }
  } catch (error) {
    console.error("❌ Delete image error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete image",
      error: error.message,
    });
  }
};


// ============================================
// ============ BLOG CATEGORIES ============
// ============================================

// CREATE CATEGORY
const createCategory = async (req, res) => {
  try {
    const { name, description, color } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Category name is required",
      });
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    const category = await BlogCategory.create({
      name: name.trim(),
      slug,
      description: description || "",
      color: color || "#3b82f6",
    });

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: category,
    });
  } catch (error) {
    console.error("❌ Create category error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create category",
      error: error.message,
    });
  }
};

// GET ALL CATEGORIES
const getAllCategories = async (req, res) => {
  try {
    const { isActive } = req.query;
    let query = {};
    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    const categories = await BlogCategory.find(query).sort({ name: 1 }).lean();

    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error("❌ Get categories error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get categories",
      error: error.message,
    });
  }
};

// GET CATEGORY BY ID
const getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await BlogCategory.findById(id).lean();
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    res.json({
      success: true,
      data: category,
    });
  } catch (error) {
    console.error("❌ Get category error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get category",
      error: error.message,
    });
  }
};

// UPDATE CATEGORY
const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, color, isActive } = req.body;

    const category = await BlogCategory.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const updates = {};
    if (name && name.trim()) {
      updates.name = name.trim();
      updates.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }
    if (description !== undefined) updates.description = description;
    if (color) updates.color = color;
    if (typeof isActive === "boolean") updates.isActive = isActive;

    const updatedCategory = await BlogCategory.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      message: "Category updated successfully",
      data: updatedCategory,
    });
  } catch (error) {
    console.error("❌ Update category error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update category",
      error: error.message,
    });
  }
};

// DELETE CATEGORY
const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await BlogCategory.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Remove category from all posts
    await BlogPost.updateMany(
      { categories: id },
      { $pull: { categories: id } },
    );

    await category.deleteOne();

    res.json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    console.error("❌ Delete category error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete category",
      error: error.message,
    });
  }
};

// ============================================
// ============ BLOG TAGS ============
// ============================================

// CREATE TAG
const createTag = async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Tag name is required",
      });
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    const tag = await BlogTag.create({
      name: name.trim(),
      slug,
    });

    res.status(201).json({
      success: true,
      message: "Tag created successfully",
      data: tag,
    });
  } catch (error) {
    console.error("❌ Create tag error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create tag",
      error: error.message,
    });
  }
};

// GET ALL TAGS
const getAllTags = async (req, res) => {
  try {
    const { isActive } = req.query;
    let query = {};
    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    const tags = await BlogTag.find(query).sort({ name: 1 }).lean();

    res.json({
      success: true,
      data: tags,
    });
  } catch (error) {
    console.error("❌ Get tags error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get tags",
      error: error.message,
    });
  }
};

// GET TAG BY ID
const getTagById = async (req, res) => {
  try {
    const { id } = req.params;

    const tag = await BlogTag.findById(id).lean();
    if (!tag) {
      return res.status(404).json({
        success: false,
        message: "Tag not found",
      });
    }

    res.json({
      success: true,
      data: tag,
    });
  } catch (error) {
    console.error("❌ Get tag error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get tag",
      error: error.message,
    });
  }
};

// UPDATE TAG
const updateTag = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, isActive } = req.body;

    const tag = await BlogTag.findById(id);
    if (!tag) {
      return res.status(404).json({
        success: false,
        message: "Tag not found",
      });
    }

    const updates = {};
    if (name && name.trim()) {
      updates.name = name.trim();
      updates.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    }
    if (typeof isActive === "boolean") updates.isActive = isActive;

    const updatedTag = await BlogTag.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      message: "Tag updated successfully",
      data: updatedTag,
    });
  } catch (error) {
    console.error("❌ Update tag error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update tag",
      error: error.message,
    });
  }
};

// DELETE TAG
const deleteTag = async (req, res) => {
  try {
    const { id } = req.params;

    const tag = await BlogTag.findById(id);
    if (!tag) {
      return res.status(404).json({
        success: false,
        message: "Tag not found",
      });
    }

    // Remove tag from all posts
    await BlogPost.updateMany({ tags: id }, { $pull: { tags: id } });

    await tag.deleteOne();

    res.json({
      success: true,
      message: "Tag deleted successfully",
    });
  } catch (error) {
    console.error("❌ Delete tag error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete tag",
      error: error.message,
    });
  }
};

// ============================================
// ============ BLOG AUTHORS ============
// ============================================

const getAuthors = async (req, res) => {
  try {
    const authors = await BlogAuthor.find({ isActive: true })
      .populate("userId", "fullName email avatar")
      .sort({ postCount: -1 })
      .lean();

    res.json({
      success: true,
      data: authors,
    });
  } catch (error) {
    console.error("❌ Get authors error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get authors",
      error: error.message,
    });
  }
};

// ============================================
// ============ INCREASE VIEW COUNT ============
// ============================================

const increaseViewCount = async (req, res) => {
  try {
    const { id } = req.params;

    await BlogPost.findByIdAndUpdate(id, {
      $inc: { viewCount: 1 },
    });

    res.json({
      success: true,
      message: "View count increased",
    });
  } catch (error) {
    console.error("❌ View count error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update view count",
      error: error.message,
    });
  }
};

// ============================================
// ============ EXPORT ============
// ============================================

module.exports = {
  // Posts
  createPost,
  getAllPosts,
  getPostById,
  updatePost,
  deletePost,
  uploadImage,
  deleteImage,
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
};
