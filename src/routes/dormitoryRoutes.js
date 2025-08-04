// src/routes/dormitoryRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const dormitoryController = require('../controllers/dormitoryController');
const addDormitoryController = require('../controllers/AddDormitoryController');
const { verifyFirebaseToken, verifyAdminToken } = require('../middleware/authMiddleware');

// Configure multer for image uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit per file
        files: 10 // Maximum 10 files
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// ===== ZONE ROUTES =====
router.get('/zones', dormitoryController.getAllZones);

// ===== PUBLIC DORMITORY ROUTES =====
router.get('/user/:userId', dormitoryController.getDormitoriesByUserId); // ดึงรายการหอพักทั้งหมดของ userId
router.get('/', dormitoryController.getAllDormitories); // ดึงรายการหอพักทั้งหมด
router.get('/recommended', dormitoryController.getRecommendedDormitories);
router.get('/latest', dormitoryController.getLatestDormitories);
router.get('/amenities/all', dormitoryController.getAllAmenities); // ดึงรายการสิ่งอำนวยความสะดวกทั้งหมด
router.get('/room-types/options', dormitoryController.getRoomTypeOptions); // ดึงตัวเลือกประเภทห้อง
router.get('/:dormId', dormitoryController.getDormitoryById); // ดึงข้อมูลหอพักตาม ID

// ===== AUTHENTICATED ROUTES =====
router.post('/request-membership', verifyFirebaseToken, dormitoryController.requestMembership);
router.get('/my/requests', verifyFirebaseToken, dormitoryController.getUserMembershipRequests);
router.put('/select', verifyFirebaseToken, dormitoryController.selectCurrentDormitory);

// ===== OWNER ROUTES =====
router.post('/submit', 
    verifyFirebaseToken, 
    upload.array('images', 10), 
    addDormitoryController.submitDormitory
);
router.get('/my/submissions', verifyFirebaseToken, addDormitoryController.getMySubmissions);

// ===== IMAGE & ROOM TYPE ROUTES =====
router.get('/:dormId/images', dormitoryController.getDormitoryImages);
router.get('/:dormId/room-types', dormitoryController.getRoomTypesByDormId); // เพิ่มเส้นใหม่
router.post('/:dormId/room-types', verifyFirebaseToken, dormitoryController.createRoomType);
router.put('/room-types/:roomTypeId', verifyFirebaseToken, dormitoryController.updateRoomType);
router.delete('/room-types/:roomTypeId', verifyFirebaseToken, dormitoryController.deleteRoomType);

module.exports = router;