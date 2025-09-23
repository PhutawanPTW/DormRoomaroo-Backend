const express = require('express');
const router = express.Router();
const adminDormitoryController = require('../controllers/adminDormitoryController');
const { verifyFirebaseToken, requireAdmin } = require('../middleware/authMiddleware');

// ===== ADMIN ROUTES =====
router.get('/all', verifyFirebaseToken, requireAdmin, adminDormitoryController.getAllDormitories);
// router.get('/:dormId', verifyFirebaseToken, requireAdmin, adminDormitoryController.getDormitoryDetailsByAdmin);
// router.get('/:dormId/check-members', verifyFirebaseToken, requireAdmin, adminDormitoryController.checkDormitoryMembers); // เพิ่มเส้นใหม่
router.put('/:dormId/approval', verifyFirebaseToken, requireAdmin, adminDormitoryController.updateDormitoryApproval);
// router.put('/:dormId/reject', verifyFirebaseToken, requireAdmin, adminDormitoryController.rejectDormitory);
// router.put('/:dormId', verifyFirebaseToken, requireAdmin, adminDormitoryController.updateDormitoryByAdmin);
router.delete('/:dormId', verifyFirebaseToken, requireAdmin, adminDormitoryController.deleteDormitory);


module.exports = router; 