// src/routes/stayRoutes.js
const express = require('express');
const router = express.Router();
const stayController = require('../controllers/stayController');
const { verifyFirebaseToken } = require('../middleware/authMiddleware');

// ===== STAY HISTORY ROUTES =====

// ดึงประวัติการเข้าพักของผู้ใช้
router.get('/user/history', verifyFirebaseToken, stayController.getUserStayHistory);

// สร้างประวัติการเข้าพักใหม่
router.post('/user/stay', verifyFirebaseToken, stayController.createStayRecord);

// อัพเดตประวัติการเข้าพัก
router.put('/user/stay/:stayId', verifyFirebaseToken, stayController.updateStayRecord);

// ดึงประวัติการเข้าพักของหอพัก (สำหรับเจ้าของหอพัก)
router.get('/dormitory/:dormId/history', verifyFirebaseToken, stayController.getDormitoryStayHistory);

module.exports = router;
