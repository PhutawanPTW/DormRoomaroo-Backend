const express = require('express');
const router = express.Router();
const addDormitoryController = require('../controllers/AddDormitoryController');
const { verifyFirebaseToken } = require('../middleware/authMiddleware');

// ============== Routes หลักสำหรับเพิ่มข้อมูลหอพัก ==============

// เพิ่มข้อมูลหอพัก (เริ่มจากข้อมูลพื้นฐาน)
router.post('/', verifyFirebaseToken, addDormitoryController.addDormitory);

// ดึงข้อมูลหอพัก
router.get('/:dormId', verifyFirebaseToken, addDormitoryController.getDormitory);

// อัพเดตข้อมูลหอพัก
router.put('/:dormId', verifyFirebaseToken, addDormitoryController.updateDormitory);

// ดูรายการหอพักที่ตัวเองส่งไป
router.get('/my/list', verifyFirebaseToken, addDormitoryController.getMyDormitories);

// ============== Routes เดิม (คอมเม้นไว้ก่อน) ==============

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