const multer = require('multer');

// เราจะใช้ MemoryStorage เท่านั้น เพื่อให้ไฟล์อยู่ใน buffer (req.file.buffer)
// สำหรับการอัปโหลดไปยัง Firebase Storage โดยตรง
const storage = multer.memoryStorage();

// ฟิลเตอร์ไฟล์ ให้รับเฉพาะไฟล์รูปภาพ
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image')) {
    cb(null, true);
  } else {
    // ปฏิเสธไฟล์ที่ไม่ใช่รูปภาพ
    cb(new Error('กรุณาอัปโหลดเฉพาะไฟล์รูปภาพ'), false);
  }
};

// สร้าง multer instance พร้อม configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 1024 * 1024 * 10 } // จำกัดขนาดไฟล์ไม่เกิน 10MB
});

module.exports = upload;
