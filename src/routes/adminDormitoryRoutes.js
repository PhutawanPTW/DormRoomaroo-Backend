const express = require('express');
const router = express.Router();
const adminDormitoryController = require('../controllers/adminDormitoryController');
const { verifyAdminToken } = require('../middleware/authMiddleware');

// ===== ADMIN ROUTES =====
router.get('/all', verifyAdminToken, adminDormitoryController.getAllDormitories);
// router.get('/:dormId', verifyAdminToken, adminDormitoryController.getDormitoryDetailsByAdmin);
// router.get('/:dormId/check-members', verifyAdminToken, adminDormitoryController.checkDormitoryMembers); // เพิ่มเส้นใหม่
router.put('/:dormId/approval', verifyAdminToken, adminDormitoryController.updateDormitoryApproval);
// router.put('/:dormId/reject', verifyAdminToken, adminDormitoryController.rejectDormitory);
// router.put('/:dormId', verifyAdminToken, adminDormitoryController.updateDormitoryByAdmin);
router.delete('/:dormId', verifyAdminToken, adminDormitoryController.deleteDormitory);


module.exports = router; 