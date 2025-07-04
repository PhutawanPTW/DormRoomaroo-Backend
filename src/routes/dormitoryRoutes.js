// src/routes/dormitoryRoutes.js
const express = require('express');
const router = express.Router();
const dormitoryController = require('../controllers/dormitoryController');
const { verifyFirebaseToken, verifyAdminToken } = require('../middleware/authMiddleware');

// Routes สำหรับหอพัก
router.get('/', dormitoryController.getAllDormitories); // ดึงรายการหอพักทั้งหมด (ไม่ต้อง auth)
router.get('/recommended', dormitoryController.getRecommendedDormitories);
router.get('/latest', dormitoryController.getLatestDormitories);
router.get('/:dormId', dormitoryController.getDormitoryById); // ดึงข้อมูลหอพักตาม ID (ไม่ต้อง auth)

// Comment out routes that are not implemented yet
/*
router.get('/:dormId/images', dormitoryController.getDormitoryImages);
router.get('/:dormId/room-types', dormitoryController.getRoomTypesByDormId);

// Routes สำหรับจัดการประเภทห้อง (ต้องผ่านการ authenticate)
router.post('/:dormId/room-types', verifyFirebaseToken, dormitoryController.createRoomType);
router.put('/room-types/:roomTypeId', verifyFirebaseToken, dormitoryController.updateRoomType);
router.delete('/room-types/:roomTypeId', verifyFirebaseToken, dormitoryController.deleteRoomType);

// Routes สำหรับแอดมิน
router.get('/admin/dormitories', verifyAdminToken, dormitoryController.getAllDormitoriesAdmin);
router.get('/admin/dormitories/:dormId', verifyAdminToken, dormitoryController.getDormitoryDetailsByAdmin);
router.put('/admin/dormitories/:dormId', verifyAdminToken, dormitoryController.updateDormitoryByAdmin);
router.put('/admin/dormitories/:dormId/approve', verifyAdminToken, dormitoryController.approveDormitory);
router.put('/admin/dormitories/:dormId/reject', verifyAdminToken, dormitoryController.rejectDormitory);
router.delete('/admin/dormitories/:dormId', verifyAdminToken, dormitoryController.deleteDormitoryByAdmin);
*/

// Routes ที่ต้อง authentication
router.post('/request-membership', verifyFirebaseToken, dormitoryController.requestMembership); // สมัครเป็นสมาชิก
router.get('/my/requests', verifyFirebaseToken, dormitoryController.getUserMembershipRequests); // ดูคำขอของตัวเอง
router.put('/select', verifyFirebaseToken, dormitoryController.selectCurrentDormitory); // เลือกหอพักปัจจุบัน

// Routes สำหรับสิ่งอำนวยความสะดวก
router.get('/amenities/all', dormitoryController.getAllAmenities); // ดึงรายการสิ่งอำนวยความสะดวกทั้งหมด

module.exports = router;