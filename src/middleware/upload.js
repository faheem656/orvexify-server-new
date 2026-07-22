const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ✅ Upload to ROOT/uploads/blog/ (NOT src/uploads/blog/)
const uploadDir = path.join(process.cwd(), 'uploads', 'blog');

console.log('📁 Upload directory:', uploadDir);

// ✅ Create directory if not exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('✅ Created upload directory:', uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPG, PNG, WEBP and GIF are allowed.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

const uploadSingle = upload.single('image');
const uploadMultiple = upload.array('images', 10);

module.exports = { 
  upload, 
  uploadSingle, 
  uploadMultiple 
};