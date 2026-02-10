# 🎯 Amenities System - คู่มือการใช้งาน

## 📋 ภาพรวม

ระบบ amenities ใหม่รองรับ:
- ✅ **24 amenities มาตรฐาน** (ID 1-24)
- ✅ **Custom amenities** (ID 25+) ที่ user สร้างเอง
- ✅ **ไม่ซ้ำกัน** - amenity ชื่อเดียวกันใช้ ID เดียวกันทุกหอ

---

## 🚀 การติดตั้ง

### 1. รัน Migration Script

```bash
node src/script/migrateAmenities.js
```

สิ่งที่จะเกิดขึ้น:
- สร้างตาราง `amenities`
- Insert amenities มาตรฐาน 24 อัน
- ตั้งค่า auto-increment เริ่มจาก 25
- เพิ่ม foreign key constraint

---

## 📊 โครงสร้างตาราง

### ตาราง `amenities` (Master)

```sql
CREATE TABLE amenities (
  amenity_id SERIAL PRIMARY KEY,           -- Auto increment
  amenity_name VARCHAR(100) NOT NULL UNIQUE,
  amenity_type VARCHAR(20) DEFAULT 'standard', -- 'standard' / 'custom'
  category VARCHAR(50),                    -- 'ในห้อง', 'ส่วนกลาง', 'กฎระเบียบ', 'อื่นๆ'
  is_active BOOLEAN DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id), -- user_id ที่สร้าง (สำหรับ custom)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### ตาราง `dormitory_amenities` (ยังเหมือนเดิม)

```sql
CREATE TABLE dormitory_amenities (
  dorm_amenity_id SERIAL PRIMARY KEY,
  dorm_id INTEGER REFERENCES dormitories(dorm_id),
  amenity_id INTEGER REFERENCES amenities(amenity_id), -- FK ไปที่ amenities
  location_type VARCHAR(20),               -- 'ภายใน' / 'ภายนอก'
  amenity_name VARCHAR(100),               -- เก็บชื่อไว้ด้วย (denormalized)
  is_available BOOLEAN DEFAULT TRUE
);
```

---

## 🔧 API Endpoints

### 1. ดึงรายการ amenities ทั้งหมด

```http
GET /api/dormitories/amenities/all
GET /api/dormitories/amenities/all?type=standard
GET /api/dormitories/amenities/all?type=custom
```

**Response:**
```json
{
  "total": 24,
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

### 2. เพิ่ม amenities ให้หอพัก (รองรับ custom)

```http
POST /api/dormitories/:dormId/amenities
```

**Request Body (Standard amenities):**
```json
{
  "amenities": [
    {
      "amenity_id": 1,
      "location_type": "ภายใน"
    },
    {
      "amenity_id": 6,
      "location_type": "ภายใน"
    }
  ]
}
```

**Request Body (Custom amenities):**
```json
{
  "amenities": [
    {
      "amenity_id": 1,
      "location_type": "ภายใน"
    },
    {
      "custom_name": "เครื่องฟอกอากาศ",
      "location_type": "ภายใน"
    },
    {
      "custom_name": "ตู้นิรภัย",
      "location_type": "ภายใน"
    }
  ]
}
```

**Logic:**
- ถ้ามี `custom_name` → เช็คว่ามี amenity นี้อยู่แล้วหรือยัง
  - **มีแล้ว** → ใช้ ID เดิม
  - **ยังไม่มี** → สร้างใหม่ (auto-increment 25, 26, 27...)
- ถ้าไม่มี `custom_name` → ใช้ `amenity_id` ที่ส่งมา

---

## 📝 ตัวอย่างการใช้งาน

### Case 1: หอพัก A เพิ่ม "เครื่องฟอกอากาศ" (ครั้งแรก)

```json
POST /api/dormitories/1/amenities
{
  "amenities": [
    { "custom_name": "เครื่องฟอกอากาศ", "location_type": "ภายใน" }
  ]
}
```

**ผลลัพธ์:**
```sql
-- 1. สร้าง amenity ใหม่
INSERT INTO amenities (amenity_name, amenity_type, created_by)
VALUES ('เครื่องฟอกอากาศ', 'custom', 2)
RETURNING amenity_id; -- 25

-- 2. เพิ่มเข้า dormitory_amenities
INSERT INTO dormitory_amenities (dorm_id, amenity_id, location_type)
VALUES (1, 25, 'ภายใน');
```

### Case 2: หอพัก B ก็เพิ่ม "เครื่องฟอกอากาศ" (ใช้ ID เดิม)

```json
POST /api/dormitories/5/amenities
{
  "amenities": [
    { "custom_name": "เครื่องฟอกอากาศ", "location_type": "ภายใน" }
  ]
}
```

**ผลลัพธ์:**
```sql
-- 1. เช็คว่ามี "เครื่องฟอกอากาศ" อยู่แล้ว
SELECT amenity_id FROM amenities 
WHERE LOWER(amenity_name) = LOWER('เครื่องฟอกอากาศ');
-- ผลลัพธ์: amenity_id = 25

-- 2. ใช้ ID เดิม (ไม่สร้างใหม่)
INSERT INTO dormitory_amenities (dorm_id, amenity_id, location_type)
VALUES (5, 25, 'ภายใน');
```

---

## 🎨 Frontend Integration

### TypeScript Interface

```typescript
interface Amenity {
  amenity_id: number;
  name: string;
  amenity_type: 'standard' | 'custom';
  category?: string;
  is_active: boolean;
}

interface DormitoryAmenityInput {
  amenity_id?: number;        // สำหรับ standard amenities
  custom_name?: string;        // สำหรับ custom amenities
  location_type: 'ภายใน' | 'ภายนอก';
}
```

### ตัวอย่าง Angular Component

```typescript
// ดึงรายการ amenities
amenities: Amenity[] = [];

ngOnInit() {
  this.http.get<{total: number, amenities: Amenity[]}>('/api/dormitories/amenities/all')
    .subscribe(response => {
      this.amenities = response.amenities;
    });
}

// เพิ่ม amenities (รวม custom)
addAmenities(dormId: number, selectedAmenities: DormitoryAmenityInput[]) {
  this.http.post(`/api/dormitories/${dormId}/amenities`, {
    amenities: selectedAmenities
  }).subscribe(response => {
    console.log('Amenities added successfully');
  });
}
```

---

## ✅ ข้อดีของระบบใหม่

1. **ไม่ซ้ำกัน** - "เครื่องฟอกอากาศ" ใช้ ID เดียวกันทุกหอ
2. **Flexible** - เพิ่ม amenity ใหม่ได้โดยไม่ต้องแก้โค้ด
3. **Searchable** - ค้นหา amenity ได้ง่าย
4. **Scalable** - รองรับการเติบโตในอนาคต
5. **Centralized** - จัดการ amenity ได้จากที่เดียว

---

## 🔍 Query ที่มีประโยชน์

### ดู amenities ทั้งหมด
```sql
SELECT * FROM amenities ORDER BY amenity_id;
```

### ดู custom amenities ที่ user สร้าง
```sql
SELECT a.*, u.username 
FROM amenities a
LEFT JOIN users u ON a.created_by = u.id
WHERE a.amenity_type = 'custom'
ORDER BY a.created_at DESC;
```

### ดู amenities ที่ใช้บ่อยที่สุด
```sql
SELECT 
  a.amenity_name,
  COUNT(da.dorm_id) as usage_count
FROM amenities a
LEFT JOIN dormitory_amenities da ON a.amenity_id = da.amenity_id
GROUP BY a.amenity_id, a.amenity_name
ORDER BY usage_count DESC;
```

---

## 🚨 Migration Notes

- ✅ ข้อมูลเก่าใน `dormitory_amenities` ยังใช้งานได้ปกติ
- ✅ Foreign key constraint ถูกเพิ่มแล้ว
- ✅ Hardcode `AMENITY_NAMES` ถูกลบออกแล้ว
- ⚠️ ถ้ามี amenity_id > 24 ในข้อมูลเก่า อาจต้อง migrate ด้วยตนเอง

---

## 📞 Support

หากมีปัญหาหรือข้อสงสัย:
1. ตรวจสอบ logs: `console.log` ใน backend
2. ตรวจสอบตาราง: `SELECT * FROM amenities;`
3. ตรวจสอบ foreign key: `SELECT * FROM dormitory_amenities WHERE amenity_id NOT IN (SELECT amenity_id FROM amenities);`
