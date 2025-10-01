const multer = require('multer');

// Multer config สำหรับอัปโหลดรูปภาพหอพัก
const uploadDormitoryImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed!'), false);
  },
});

// Multer config สำหรับอัปโหลดรูปโปรไฟล์
const uploadProfileImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }, // 2MB, 1 ไฟล์
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed!'), false);
  },
});

module.exports = {
  uploadDormitoryImages,
  uploadProfileImage
};