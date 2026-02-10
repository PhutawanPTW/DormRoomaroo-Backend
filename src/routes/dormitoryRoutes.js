// src/routes/dormitoryRoutes.js
const express = require("express");
const router = express.Router();

// ===== Controllers =====
const dormitoryController = require("../controllers/dormitoryController");
const addDormitoryController = require("../controllers/AddDormitoryController");
const adminDormitoryController = require("../controllers/adminDormitoryController");
const editDormitoryController = require("../controllers/editDormitoryController");
const deleteDormitoryController = require("../controllers/deleteDormitoryController"); // ✅ import มาใช้ตรงนี้

// ===== Middleware =====
const {
  verifyFirebaseToken,
} = require("../middleware/authMiddleware");

// ===== ZONE ROUTES =====
router.get("/zones", dormitoryController.getAllZones);

// ===== PUBLIC DORMITORY ROUTES =====
router.get("/user/:userId", dormitoryController.getDormitoriesByUserId); // ดึงรายการหอพักทั้งหมดของ userId (จะ deprecated)
router.get("/owner", verifyFirebaseToken, dormitoryController.getOwnerDormitories); // ดึงรายการหอของเจ้าของจาก token
router.get("/", dormitoryController.getAllApprovedDormitories); // ดึงรายการหอพักทั้งหมดที่อนุมัติแล้ว (public)
// ค้นหาชื่อหอพัก (autocomplete)
router.get("/search", dormitoryController.searchDormNames);
// กรองหอพัก (รองรับทั้งเดี่ยวและรวมกัน)
router.get("/filter", dormitoryController.advancedFilter);

// ===== MAP ROUTES =====
router.get("/map/all", dormitoryController.getAllDormitoriesForMap); // ดึงหอพักทั้งหมดสำหรับแผนที่
router.get("/map/popup/:dormId", dormitoryController.getDormitoryForMapPopup); // ดึงข้อมูลหอพักสำหรับป๊อปอัพ

// ===== COMPARISON ROUTE =====
router.get("/compare", dormitoryController.compareDormitories); // เปรียบเทียบหอพักหลายแห่ง (สูงสุด 5 หอพัก)

router.get("/recommended", dormitoryController.getRecommendedDormitories);
router.get("/latest", dormitoryController.getLatestDormitories);
router.get("/rating-filter", dormitoryController.filterByRating); // กรองตามคะแนนดาวแบบ Shopee
router.get("/amenities/all", dormitoryController.getAllAmenities); // ดึงรายการสิ่งอำนวยความสะดวกทั้งหมด
router.get("/room-types/options", dormitoryController.getRoomTypeOptions); // ดึงตัวเลือกประเภทห้อง
router.get("/:dormId", dormitoryController.getDormitoryById); // ดึงข้อมูลหอพักตาม ID

// ===== AUTHENTICATED ROUTES =====
router.post(
  "/request-membership",
  verifyFirebaseToken,
  dormitoryController.requestMembership
);
router.get(
  "/my/requests",
  verifyFirebaseToken,
  dormitoryController.getUserMembershipRequests
);
router.put(
  "/select",
  verifyFirebaseToken,
  dormitoryController.selectCurrentDormitory
);

// ===== MEMBER COUNT ROUTES =====
router.get(
  "/:dormId/member-count",
  dormitoryController.getDormitoryMemberCount
);

// ===== TENANT ROUTES =====
router.get("/owner/tenants", verifyFirebaseToken, dormitoryController.getAllOwnerTenants);
router.put("/:dormId/tenants/:userId/approve", verifyFirebaseToken, dormitoryController.approveTenant);
router.put("/:dormId/tenants/:userId/reject", verifyFirebaseToken, dormitoryController.rejectTenant);
router.put("/:dormId/tenants/:userId/cancel", verifyFirebaseToken, dormitoryController.cancelTenantApproval);

// ===== OWNER ROUTES =====
// เส้น /submit และ /my/submissions ย้ายไปใช้ addDormitoryRoutes.js แล้ว

// Edit endpoints moved under /api/edit-dormitory in editDormitoryRoutes.js
 
module.exports = router;
