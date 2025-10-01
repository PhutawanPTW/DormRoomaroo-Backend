const express = require('express');
const router = express.Router();
const addDormitoryController = require('../controllers/AddDormitoryController');
const dormitoryController = require('../controllers/dormitoryController');
const { verifyFirebaseToken } = require('../middleware/authMiddleware');
const { uploadDormitoryImages } = require('../middleware/uploadMiddleware');

// ============== ADD DORMITORY ROUTES (Create-only, like leading platforms) ==============
// แนวปฏิบัติ: แยกเส้น "เพิ่ม" ออกจาก "แก้ไข" ชัดเจน

// [ADD] สร้างหอพักใหม่ (ข้อมูลพื้นฐาน + ค่าน้ำไฟ/พิกัด/คำอธิบาย)
router.post('/', verifyFirebaseToken, addDormitoryController.addDormitory);

// [ADD] ดึงข้อมูลหอพักที่เพิ่งสร้าง (ใช้ตรวจสอบ/รีวิวก่อนทำขั้นตอนต่อไป)
router.get('/:dormId', verifyFirebaseToken, addDormitoryController.getDormitory);

// [ADD] ดึงรายการหอทั้งหมดของเจ้าของที่ล็อกอิน (สำหรับ Owner Dashboard)
router.get('/owner/dormitories', verifyFirebaseToken, addDormitoryController.getMyDormitories);

// [ADD] อัปโหลดรูปภาพหอพักที่เพิ่งสร้าง (สำหรับขั้นตอนการเพิ่มหอ)
router.post('/:dormId/images', verifyFirebaseToken, uploadDormitoryImages.array('images', 20), dormitoryController.uploadDormitoryImages);

// [ADD] เพิ่มประเภทห้องให้หอพักที่เพิ่งสร้าง (สำหรับขั้นตอนการเพิ่มหอ)
router.post('/:dormId/room-types', verifyFirebaseToken, dormitoryController.createRoomType);

// [ADD] เพิ่มสิ่งอำนวยความสะดวกให้หอพักที่เพิ่งสร้าง (สำหรับขั้นตอนการเพิ่มหอ)
router.post('/:dormId/amenities', verifyFirebaseToken, dormitoryController.addDormitoryAmenities);

// ============== Legacy (คอมเมนต์เก็บไว้เพื่ออ้างอิง) ==============

/*
// เพิ่มข้อมูลหอพักแบบครบถ้วน
router.post('/submit', verifyFirebaseToken, upload.array('images', 10), addDormitoryController.submitDormitory);

// ดูรายการหอพักที่ตัวเองส่งไป
router.get('/my-submissions', verifyFirebaseToken, addDormitoryController.getMySubmissions);

// ดูรายละเอียดหอพักที่ส่งไปแล้ว
router.get('/details/:dormId', verifyFirebaseToken, addDormitoryController.getDormitoryDetails);

// แก้ไขข้อมูลหอพักที่ส่งไปแล้ว
router.put('/edit/:dormId', verifyFirebaseToken, upload.array('images', 10), addDormitoryController.editDormitory);

// ดูรายการหอพักทั้งหมด (สำหรับผู้ดูแลระบบ)
router.get('/all', verifyFirebaseToken, addDormitoryController.getAllDormitories);

// อนุมัติหรือปฏิเสธหอพัก (สำหรับผู้ดูแลระบบ)
router.put('/approval/:dormId', verifyFirebaseToken, addDormitoryController.updateDormitoryApproval);

// ลบหอพัก (สำหรับผู้ดูแลระบบ)
router.delete('/delete/:dormId', verifyFirebaseToken, addDormitoryController.deleteDormitory);

// ดึงตัวเลือกประเภทห้อง
router.get('/room-type-options', addDormitoryController.getRoomTypeOptions);
*/

module.exports = router; 