# 🎯 Amenities System Migration - สรุป

## ✅ สิ่งที่ทำเสร็จแล้ว:

### 1. **สร้างตาราง amenities**
- ไฟล์: `src/script/createAmenitiesTable.sql`
- มี 24 amenities มาตรฐาน (ID 1-24)
- Auto-increment เริ่มจาก 25 สำหรับ custom amenities

### 2. **สร้าง Migration Script**
- ไฟล์: `src/script/migrateAmenities.js`
- รัน: `node src/script/migrateAmenities.js`

### 3. **อัพเดท Backend Logic**
- ✅ `src/controllers/dormitoryController.js`
  - ลบ hardcode `AMENITY_NAMES`
  - อัพเดท `addDormitoryAmenities()` รองรับ custom amenities
  - อัพเดท `getAllAmenities()` ดึงจากฐานข้อมูล
  - เปลี่ยน `getAmenityNameById()` เป็น async function

- ✅ `src/controllers/editDormitoryController.js`
  - ลบ hardcode `AMENITY_NAMES`
  - เปลี่ยน `getAmenityNameById()` เป็น async function

### 4. **สร้างเอกสาร**
- ไฟล์: `src/script/AMENITIES_README.md`
- มีคู่มือการใช้งานครบถ้วน

---

## 🚀 วิธีใช้งาน:

### ขั้นตอนที่ 1: รัน Migration
```bash
node src/script/migrateAmenities.js
```

### ขั้นตอนที่ 2: Restart Server
```bash
npm start
```

### ขั้นตอนที่ 3: ทดสอบ API

#### ดึงรายการ amenities:
```bash
curl http://localhost:3000/api/dormitories/amenities/all
```

#### เพิ่ม amenities (standard):
```bash
curl -X POST http://localhost:3000/api/dormitories/1/amenities \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "amenities": [
      {"amenity_id": 1, "location_type": "ภายใน"},
      {"amenity_id": 6, "location_type": "ภายใน"}
    ]
  }'
```

#### เพิ่ม amenities (custom):
```bash
curl -X POST http://localhost:3000/api/dormitories/1/amenities \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "amenities": [
      {"amenity_id": 1, "location_type": "ภายใน"},
      {"custom_name": "เครื่องฟอกอากาศ", "location_type": "ภายใน"}
    ]
  }'
```

---

## 📋 API Changes:

### GET /api/dormitories/amenities/all
**เดิม:** ส่ง hardcode array
```json
[
  {"amenity_id": 1, "name": "แอร์"},
  {"amenity_id": 2, "name": "TV"}
]
```

**ใหม่:** ดึงจากฐานข้อมูล + รองรับ custom
```json
{
  "total": 25,
  "amenities": [
    {
      "amenity_id": 1,
      "name": "แอร์",
      "amenity_type": "standard",
      "category": "ในห้อง",
      "is_active": true
    },
    {
      "amenity_id": 25,
      "name": "เครื่องฟอกอากาศ",
      "amenity_type": "custom",
      "category": "อื่นๆ",
      "is_active": true
    }
  ]
}
```

### POST /api/dormitories/:dormId/amenities
**เดิม:** รับแค่ amenity_id
```json
{
  "amenities": [
    {"amenity_id": 1, "location_type": "ภายใน"}
  ]
}
```

**ใหม่:** รองรับ custom_name
```json
{
  "amenities": [
    {"amenity_id": 1, "location_type": "ภายใน"},
    {"custom_name": "เครื่องฟอกอากาศ", "location_type": "ภายใน"}
  ]
}
```

---

## 🎯 ตัวอย่างการทำงาน:

### Scenario 1: หอพัก A เพิ่ม "เครื่องฟอกอากาศ" (ครั้งแรก)
```
Input: custom_name = "เครื่องฟอกอากาศ"
→ เช็คในฐานข้อมูล: ไม่มี
→ สร้างใหม่: amenity_id = 25
→ เพิ่มเข้า dormitory_amenities: (dorm_id=1, amenity_id=25)
```

### Scenario 2: หอพัก B เพิ่ม "เครื่องฟอกอากาศ" (ใช้ ID เดิม)
```
Input: custom_name = "เครื่องฟอกอากาศ"
→ เช็คในฐานข้อมูล: มีแล้ว (amenity_id = 25)
→ ใช้ ID เดิม: amenity_id = 25
→ เพิ่มเข้า dormitory_amenities: (dorm_id=5, amenity_id=25)
```

### Scenario 3: หอพัก C เพิ่ม "ตู้นิรภัย" (ครั้งแรก)
```
Input: custom_name = "ตู้นิรภัย"
→ เช็คในฐานข้อมูล: ไม่มี
→ สร้างใหม่: amenity_id = 26
→ เพิ่มเข้า dormitory_amenities: (dorm_id=10, amenity_id=26)
```

---

## 📊 ตาราง amenities หน้าตาสุดท้าย:

| amenity_id | amenity_name | amenity_type | created_by |
|------------|--------------|--------------|------------|
| 1 | แอร์ | standard | NULL |
| 2 | พัดลม | standard | NULL |
| ... | ... | ... | ... |
| 24 | เครื่องซักผ้า | standard | NULL |
| 25 | เครื่องฟอกอากาศ | custom | 2 |
| 26 | ตู้นิรภัย | custom | 3 |
| 27 | หมอนข้าง | custom | 5 |

---

## ⚠️ Breaking Changes:

### Frontend ต้องอัพเดท:

1. **Response format เปลี่ยน:**
   ```typescript
   // เดิม
   amenities: Array<{amenity_id: number, name: string}>
   
   // ใหม่
   {
     total: number,
     amenities: Array<{
       amenity_id: number,
       name: string,
       amenity_type: 'standard' | 'custom',
       category: string,
       is_active: boolean
     }>
   }
   ```

2. **รองรับ custom amenities:**
   ```typescript
   // เพิ่ม field สำหรับ custom
   interface AmenityInput {
     amenity_id?: number;      // สำหรับ standard
     custom_name?: string;      // สำหรับ custom
     location_type: string;
   }
   ```

---

## 🔍 การตรวจสอบ:

### ตรวจสอบว่า migration สำเร็จ:
```sql
-- ดูจำนวน amenities
SELECT COUNT(*) FROM amenities;
-- ควรได้ 24 (หรือมากกว่าถ้ามี custom)

-- ดู amenities ทั้งหมด
SELECT * FROM amenities ORDER BY amenity_id;

-- ตรวจสอบ foreign key
SELECT * FROM dormitory_amenities 
WHERE amenity_id NOT IN (SELECT amenity_id FROM amenities);
-- ควรได้ 0 rows
```

---

## 📞 Troubleshooting:

### ปัญหา: Migration ล้มเหลว
```bash
# ลบตารางและรันใหม่
psql -d your_database -c "DROP TABLE IF EXISTS amenities CASCADE;"
node src/script/migrateAmenities.js
```

### ปัญหา: Foreign key constraint error
```sql
-- ตรวจสอบ amenity_id ที่ไม่มีในตาราง amenities
SELECT DISTINCT amenity_id 
FROM dormitory_amenities 
WHERE amenity_id NOT IN (SELECT amenity_id FROM amenities);

-- แก้ไข: เพิ่ม amenity ที่หายไป
INSERT INTO amenities (amenity_id, amenity_name, amenity_type)
VALUES (?, 'ชื่อ amenity', 'custom');
```

---

## ✅ Checklist:

- [ ] รัน migration script
- [ ] Restart server
- [ ] ทดสอบ GET /api/dormitories/amenities/all
- [ ] ทดสอบ POST /api/dormitories/:dormId/amenities (standard)
- [ ] ทดสอบ POST /api/dormitories/:dormId/amenities (custom)
- [ ] อัพเดท Frontend code
- [ ] ทดสอบ end-to-end

---

## 🎉 เสร็จสิ้น!

ระบบ amenities ใหม่พร้อมใช้งานแล้ว! 🚀
