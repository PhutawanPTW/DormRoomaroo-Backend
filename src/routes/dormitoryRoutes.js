// src/routes/dormitoryRoutes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");

// ===== Controllers =====
const dormitoryController = require("../controllers/dormitoryController");
const addDormitoryController = require("../controllers/AddDormitoryController");
const adminDormitoryController = require("../controllers/adminDormitoryController");
const editDormitoryController = require("../controllers/editDormitoryController");
const deleteDormitoryController = require("../controllers/deleteDormitoryController"); // ✅ import มาใช้ตรงนี้

// ===== Middleware =====
const {
  verifyFirebaseToken,
  verifyAdminToken,
} = require("../middleware/authMiddleware");

// ===== Multer Config =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit per file
    files: 10, // Maximum 10 files
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"), false);
    }
  },
});

// ===== ZONE ROUTES =====
router.get("/zones", dormitoryController.getAllZones);

// ===== PUBLIC DORMITORY ROUTES =====
router.get("/user/:userId", dormitoryController.getDormitoriesByUserId); // ดึงรายการหอพักทั้งหมดของ userId (จะ deprecated)
router.get("/owner", verifyFirebaseToken, dormitoryController.getOwnerDormitories); // ดึงรายการหอของเจ้าของจาก token
router.get("/", adminDormitoryController.getAllDormitories); // ดึงรายการหอพักทั้งหมด

// ===== MAP ROUTES =====
router.get("/map/all", dormitoryController.getAllDormitoriesForMap); // ดึงหอพักทั้งหมดสำหรับแผนที่
router.get("/map/popup/:dormId", dormitoryController.getDormitoryForMapPopup); // ดึงข้อมูลหอพักสำหรับป๊อปอัพ

router.get("/recommended", dormitoryController.getRecommendedDormitories);
router.get("/latest", dormitoryController.getLatestDormitories);
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
router.post(
  "/submit",
  verifyFirebaseToken,
  upload.array("images", 10),
  addDormitoryController.submitDormitory
);
router.get(
  "/my/submissions",
  verifyFirebaseToken,
  addDormitoryController.getMySubmissions
);

// ===== IMAGE & ROOM TYPE ROUTES =====
router.get("/:dormId/images", dormitoryController.getDormitoryImages);
router.post(
  "/:dormId/images",
  verifyFirebaseToken,
  upload.array("images", 10),
  dormitoryController.uploadDormitoryImages
);
router.delete(
  "/:dormId/images/:imageId",
  verifyFirebaseToken,
  dormitoryController.deleteDormitoryImage
);
router.put(
  "/:dormId/images/:imageId/primary",
  verifyFirebaseToken,
  dormitoryController.setPrimaryImage
);
router.get("/:dormId/room-types", dormitoryController.getRoomTypesByDormId);
router.post(
  "/:dormId/room-types",
  verifyFirebaseToken,
  dormitoryController.createRoomType
);
// router.post(
//   "/:dormId/room-types/bulk",
//   verifyFirebaseToken,
//   dormitoryController.createRoomTypesBulk
// );
router.put(
  "/room-types/:roomTypeId",
  verifyFirebaseToken,
  editDormitoryController.updateRoomType
);
router.delete(
  "/room-types/:roomTypeId",
  verifyFirebaseToken,
  deleteDormitoryController.deleteRoomType
); // ✅ ใช้ controller ที่ถูกต้อง

// ===== AMENITIES ROUTES =====
router.get("/:dormId/amenities", dormitoryController.getDormitoryAmenities);
router.post(
  "/:dormId/amenities",
  verifyFirebaseToken,
  dormitoryController.addDormitoryAmenities
);

module.exports = router;
