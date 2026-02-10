-- ===================================
-- สร้างตาราง amenities
-- ===================================

CREATE TABLE IF NOT EXISTS amenities (
  amenity_id SERIAL PRIMARY KEY,
  amenity_name VARCHAR(100) NOT NULL UNIQUE,
  amenity_type VARCHAR(20) DEFAULT 'standard' CHECK (amenity_type IN ('standard', 'custom')),
  category VARCHAR(50),
  is_active BOOLEAN DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===================================
-- Insert amenities มาตรฐาน 24 อัน
-- ===================================

INSERT INTO amenities (amenity_id, amenity_name, amenity_type, category) VALUES
  (1, 'แอร์', 'standard', 'ในห้อง'),
  (2, 'พัดลม', 'standard', 'ในห้อง'),
  (3, 'TV', 'standard', 'ในห้อง'),
  (4, 'ตู้เย็น', 'standard', 'ในห้อง'),
  (5, 'เตียงนอน', 'standard', 'ในห้อง'),
  (6, 'WIFI', 'standard', 'ในห้อง'),
  (7, 'ตู้เสื้อผ้า', 'standard', 'ในห้อง'),
  (8, 'โต๊ะทำงาน', 'standard', 'ในห้อง'),
  (9, 'ไมโครเวฟ', 'standard', 'ในห้อง'),
  (10, 'เครื่องทำน้ำอุ่น', 'standard', 'ในห้อง'),
  (11, 'ซิงค์ล้างจาน', 'standard', 'ในห้อง'),
  (12, 'โต๊ะเครื่องแป้ง', 'standard', 'ในห้อง'),
  (13, 'กล้องวงจรปิด', 'standard', 'ส่วนกลาง'),
  (14, 'รปภ.', 'standard', 'ส่วนกลาง'),
  (15, 'ลิฟต์', 'standard', 'ส่วนกลาง'),
  (16, 'ที่จอดรถ', 'standard', 'ส่วนกลาง'),
  (17, 'ฟิตเนส', 'standard', 'ส่วนกลาง'),
  (18, 'Lobby', 'standard', 'ส่วนกลาง'),
  (19, 'ตู้น้ำหยอดเหรียญ', 'standard', 'ส่วนกลาง'),
  (20, 'สระว่ายน้ำ', 'standard', 'ส่วนกลาง'),
  (21, 'ที่วางพัสดุ', 'standard', 'ส่วนกลาง'),
  (22, 'อนุญาตให้เลี้ยงสัตว์', 'standard', 'กฎระเบียบ'),
  (23, 'คีย์การ์ด', 'standard', 'ส่วนกลาง'),
  (24, 'เครื่องซักผ้า', 'standard', 'ส่วนกลาง')
ON CONFLICT (amenity_id) DO NOTHING;

-- ===================================
-- Reset sequence เริ่มจาก 25
-- ===================================

SELECT setval('amenities_amenity_id_seq', 24, true);

-- ===================================
-- สร้าง index สำหรับ performance
-- ===================================

CREATE INDEX IF NOT EXISTS idx_amenities_name ON amenities(amenity_name);
CREATE INDEX IF NOT EXISTS idx_amenities_type ON amenities(amenity_type);
CREATE INDEX IF NOT EXISTS idx_amenities_active ON amenities(is_active);

-- ===================================
-- อัพเดท dormitory_amenities ให้มี FK
-- ===================================

-- ลบ constraint เก่า (ถ้ามี)
ALTER TABLE dormitory_amenities 
DROP CONSTRAINT IF EXISTS fk_dormitory_amenities_amenity;

-- เพิ่ม FK ใหม่
ALTER TABLE dormitory_amenities 
ADD CONSTRAINT fk_dormitory_amenities_amenity 
FOREIGN KEY (amenity_id) 
REFERENCES amenities(amenity_id) 
ON DELETE CASCADE;

-- ===================================
-- Migrate ข้อมูลเก่า (ถ้ามี amenity_name ใน dormitory_amenities)
-- ===================================

-- อัพเดท amenity_name ให้ตรงกับตาราง amenities
UPDATE dormitory_amenities da
SET amenity_name = a.amenity_name
FROM amenities a
WHERE da.amenity_id = a.amenity_id
  AND (da.amenity_name IS NULL OR da.amenity_name = '');

COMMENT ON TABLE amenities IS 'Master table for all amenities (standard + custom)';
COMMENT ON COLUMN amenities.amenity_type IS 'standard = predefined, custom = user-created';
COMMENT ON COLUMN amenities.created_by IS 'User ID who created this custom amenity (NULL for standard)';
