const express = require('express');
const router = express.Router();
const deleteDormitoryController = require('../controllers/deleteDormitoryController');
const { verifyFirebaseToken } = require('../middleware/authMiddleware');

// ตรวจสอบสมาชิกของหอพักก่อนลบ
// router.get('/:dormId/check-members', verifyFirebaseToken, deleteDormitoryController.checkDormitoryMembers);

// ลบหอพัก
router.delete('/:dormId', verifyFirebaseToken, deleteDormitoryController.deleteDormitory);

module.exports = router; 