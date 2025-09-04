const express = require('express');
const router = express.Router();
const dormitoryController = require('../controllers/dormitoryController');

// ดึงรายการโซนทั้งหมด (ไม่ต้อง auth)
router.get('/', dormitoryController.getAllZones);

module.exports = router; 