// src/routes/editDormitoryRoutes.js
const express = require('express');
const router = express.Router();

// Controllers
const dormitoryController = require('../controllers/dormitoryController');
const editDormitoryController = require('../controllers/editDormitoryController');
const deleteDormitoryController = require('../controllers/deleteDormitoryController');

// Middleware
const { verifyFirebaseToken } = require('../middleware/authMiddleware');
const { uploadDormitoryImages } = require('../middleware/uploadMiddleware');

// ===== BASIC DORM EDIT =====
router.get('/:dormId', verifyFirebaseToken, editDormitoryController.getDormitoryDetails);
router.put('/:dormId', verifyFirebaseToken, editDormitoryController.updateDormitory);
router.patch('/:dormId', verifyFirebaseToken, editDormitoryController.updateDormitory);

// ===== IMAGES =====
router.get('/:dormId/images', verifyFirebaseToken, dormitoryController.getDormitoryImages);
router.post('/:dormId/images', verifyFirebaseToken, uploadDormitoryImages.array('images', 20), dormitoryController.uploadDormitoryImages);
router.delete('/:dormId/images/:imageId', verifyFirebaseToken, dormitoryController.deleteDormitoryImage);
router.put('/:dormId/images/:imageId/primary', verifyFirebaseToken, dormitoryController.setPrimaryImage);

// ===== ROOM TYPES =====
router.get('/:dormId/room-types', dormitoryController.getRoomTypesByDormId); // Public access for viewing room types
router.post('/:dormId/room-types', verifyFirebaseToken, dormitoryController.createRoomType);
// router.post('/:dormId/room-types/bulk', verifyFirebaseToken, dormitoryController.createRoomTypesBulk);
router.put('/room-types/:roomTypeId', verifyFirebaseToken, editDormitoryController.updateRoomType);
router.delete('/room-types/:roomTypeId', verifyFirebaseToken, deleteDormitoryController.deleteRoomType);

// ===== AMENITIES =====
router.get('/:dormId/amenities', verifyFirebaseToken, dormitoryController.getDormitoryAmenities);
router.post('/:dormId/amenities', verifyFirebaseToken, dormitoryController.addDormitoryAmenities);
router.patch('/:dormId/amenities', verifyFirebaseToken, editDormitoryController.updateDormitoryAmenities);

module.exports = router;


