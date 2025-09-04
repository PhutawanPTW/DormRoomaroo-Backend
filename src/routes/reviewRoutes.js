// src/routes/reviewRoutes.js
const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { verifyFirebaseToken } = require('../middleware/authMiddleware');

// ===== REVIEW ROUTES =====

// ดึงรีวิวทั้งหมดของหอพัก (public)
router.get('/dormitory/:dormId', reviewController.getDormitoryReviews);

// ตรวจสอบว่าผู้ใช้สามารถรีวิวได้หรือไม่
router.get('/dormitory/:dormId/eligibility', verifyFirebaseToken, reviewController.checkReviewEligibility);

// สร้างรีวิวใหม่ (ต้องเป็นสมาชิกของหอพัก)
router.post('/dormitory/:dormId', verifyFirebaseToken, reviewController.createReview);

// อัพเดตรีวิว (เจ้าของรีวิวเท่านั้น)
router.put('/:reviewId', verifyFirebaseToken, reviewController.updateReview);

// ลบรีวิว (เจ้าของรีวิวเท่านั้น)
router.delete('/:reviewId', verifyFirebaseToken, reviewController.deleteReview);

module.exports = router;
