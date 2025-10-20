const express = require('express');
const router = express.Router();
const adminDormitoryController = require('../controllers/adminDormitoryController');
const { verifyFirebaseToken, requireAdmin } = require('../middleware/authMiddleware');

// ===== ADMIN ROUTES =====

// ดูรายการหอพักทั้งหมด
router.get('/all', verifyFirebaseToken, requireAdmin, adminDormitoryController.getAllDormitories);

// ดูรายการหอพักที่รอการอนุมัติ
router.get('/pending', verifyFirebaseToken, requireAdmin, adminDormitoryController.getPendingDormitories);

// ดูรายละเอียดหอพักแต่ละตัว (สำหรับแอดมิน)
router.get('/:dormId', verifyFirebaseToken, requireAdmin, adminDormitoryController.getDormitoryDetailsByAdmin);

// ดูสมาชิกในหอพัก
router.get('/:dormId/members', verifyFirebaseToken, requireAdmin, adminDormitoryController.getDormitoryMembers);

// ดูสถิติหอพัก
router.get('/:dormId/stats', verifyFirebaseToken, requireAdmin, adminDormitoryController.getDormitoryStats);

// อนุมัติ/ปฏิเสธหอพัก
router.put('/:dormId/approval', verifyFirebaseToken, requireAdmin, adminDormitoryController.updateDormitoryApproval);

// แก้ไขหอพักโดยแอดมิน
router.put('/:dormId', verifyFirebaseToken, requireAdmin, adminDormitoryController.updateDormitoryByAdmin);

// จัดการสถานะหอพัก (เปิด/ปิด)
router.put('/:dormId/status', verifyFirebaseToken, requireAdmin, adminDormitoryController.updateDormitoryStatus);

// ตรวจสอบสมาชิกของหอพักก่อนลบ
router.get('/:dormId/check-members', verifyFirebaseToken, requireAdmin, adminDormitoryController.checkDormitoryMembers);

// ลบหอพัก
router.delete('/:dormId', verifyFirebaseToken, requireAdmin, adminDormitoryController.deleteDormitory);


module.exports = router; 