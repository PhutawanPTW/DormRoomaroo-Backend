// src/routes/editDormitoryRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');

// Controllers
const dormitoryController = require('../controllers/dormitoryController');
const editDormitoryController = require('../controllers/editDormitoryController');
const deleteDormitoryController = require('../controllers/deleteDormitoryController');

// Middleware
const { verifyFirebaseToken } = require('../middleware/authMiddleware');

// Multer setup for images
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed!'), false);
  },
});

// ===== BASIC DORM EDIT =====
router.put('/:dormId', verifyFirebaseToken, editDormitoryController.updateDormitory);

// ===== IMAGES =====
router.get('/:dormId/images', verifyFirebaseToken, dormitoryController.getDormitoryImages);
router.post('/:dormId/images', verifyFirebaseToken, upload.array('images', 10), dormitoryController.uploadDormitoryImages);
router.delete('/:dormId/images/:imageId', verifyFirebaseToken, dormitoryController.deleteDormitoryImage);
router.put('/:dormId/images/:imageId/primary', verifyFirebaseToken, dormitoryController.setPrimaryImage);

// ===== ROOM TYPES =====
router.get('/:dormId/room-types', verifyFirebaseToken, dormitoryController.getRoomTypesByDormId);
router.post('/:dormId/room-types', verifyFirebaseToken, dormitoryController.createRoomType);
// router.post('/:dormId/room-types/bulk', verifyFirebaseToken, dormitoryController.createRoomTypesBulk);
router.put('/room-types/:roomTypeId', verifyFirebaseToken, editDormitoryController.updateRoomType);
router.delete('/room-types/:roomTypeId', verifyFirebaseToken, deleteDormitoryController.deleteRoomType);

// ===== AMENITIES =====
router.get('/:dormId/amenities', verifyFirebaseToken, dormitoryController.getDormitoryAmenities);
router.post('/:dormId/amenities', verifyFirebaseToken, dormitoryController.addDormitoryAmenities);

module.exports = router;


