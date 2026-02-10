const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyFirebaseToken } = require('../middleware/authMiddleware');
const { uploadProfileImage } = require('../middleware/uploadMiddleware');

// Route สำหรับ Google Sign-In (ส่ง ID Token มาให้ Backend Verify)
router.post('/google-login', verifyFirebaseToken, authController.googleLogin);

// Route สำหรับการลงทะเบียนผู้ใช้ใหม่ (Email/Password)
// 1. Frontend สร้างผู้ใช้ใน Firebase Auth และได้รับ ID Token
// 2. Frontend ส่ง ID Token มาที่นี่พร้อมกับข้อมูลโปรไฟล์
// Middleware 'verifyFirebaseToken' จะตรวจสอบ Token และแนบ 'req.user'
// Middleware 'upload.single' จะจัดการรูปภาพ ถ้ามี
router.post(
  '/register', 
  verifyFirebaseToken, 
  uploadProfileImage.single('profileImage'), 
  authController.registerWithEmail
);

// Route สำหรับดึงข้อมูลโปรไฟล์ผู้ใช้ปัจจุบัน (ต้องมี Token)
router.get('/me', verifyFirebaseToken, authController.fetchCurrentUserProfile);

// Route สำหรับอัปเดตข้อมูลโปรไฟล์ (ต้องมี Token)
router.put('/me', verifyFirebaseToken, authController.completeUserProfile);

// Route สำหรับตรวจสอบความถูกต้องของ token
router.get('/verify-token', verifyFirebaseToken, authController.verifyToken);

// Route สำหรับดึงข้อมูลผู้ใช้ทั้งหมด (ต้องมี Token)
router.get('/users', authController.getAllUsers);

// Route สำหรับการเข้าสู่ระบบแอดมิน (Firebase)
router.post('/admin-login', verifyFirebaseToken, authController.adminLogin);

// Forgot password flow (no token required)
router.post('/forgot-password', authController.forgotPassword);

module.exports = router;