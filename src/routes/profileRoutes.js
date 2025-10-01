// src/routes/profileRoutes.js
const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { verifyFirebaseToken } = require('../middleware/authMiddleware');
const { uploadProfileImage } = require('../middleware/uploadMiddleware');

// ===== PROFILE ROUTES =====

// ดึงข้อมูลโปรไฟล์ผู้ใช้
router.get('/', verifyFirebaseToken, profileController.getUserProfile);

// อัพเดตข้อมูลโปรไฟล์
router.put('/', verifyFirebaseToken, profileController.updateUserProfile);

// อัพโหลดรูปโปรไฟล์
router.post('/upload-image', verifyFirebaseToken, uploadProfileImage.single('image'), profileController.uploadProfileImage);

// เปลี่ยนรหัสผ่าน (สำหรับ Email/Password users เท่านั้น)
router.put('/change-password', verifyFirebaseToken, profileController.changePassword);

// เปลี่ยนหอพัก (สำหรับ member เท่านั้น)
router.put('/change-dormitory', verifyFirebaseToken, profileController.changeDormitory);

module.exports = router;
