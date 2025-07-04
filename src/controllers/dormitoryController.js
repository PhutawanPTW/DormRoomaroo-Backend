// src/controllers/dormitoryController.js
const pool = require('../db');

// Helper SQL fragment for selectingภาพหลักของหอพัก
const MAIN_IMAGE_SUBQUERY = `(
  SELECT image_url FROM dormitory_images
  WHERE dorm_id = d.dorm_id
  ORDER BY is_primary DESC, upload_date DESC, image_id ASC
  LIMIT 1
) AS main_image_url`;

// ดึงรายการหอพักทั้งหมด หรือภายในโซนที่ระบุ
exports.getAllDormitories = async (req, res) => {
    try {
        const { zoneId } = req.query;

        let baseQuery = `
            SELECT 
                d.dorm_id,
                d.dorm_name,
                d.address,
                d.dorm_description,
                d.latitude,
                d.longitude,
                d.bed_type,
                d.rental_type,
                d.electricity_type,
                d.electricity_rate,
                d.water_type,
                d.water_rate,
                d.monthly_price,
                d.daily_price,
                d.approval_status,
                z.zone_name,
                c.manager_name,
                c.primary_phone,
                c.secondary_phone,
                c.line_id,
                c.email as contact_email,
                ${MAIN_IMAGE_SUBQUERY}
            FROM dormitories d
            LEFT JOIN zones z ON d.zone_id = z.zone_id
            LEFT JOIN contact_info c ON d.contact_id = c.contact_id
            WHERE d.approval_status = 'อนุมัติแล้ว'`;

        const values = [];
        if (zoneId) {
            values.push(zoneId);
            baseQuery += ` AND d.zone_id = $${values.length}`;
        }

        baseQuery += ' ORDER BY d.dorm_name';

        const result = await pool.query(baseQuery, values);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching dormitories:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

// ดึงรายการโซนทั้งหมด
exports.getAllZones = async (req, res) => {
    try {
        const query = 'SELECT zone_id, zone_name FROM zones ORDER BY zone_name';
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching zones:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

// ดึงข้อมูลหอพักตาม ID
exports.getDormitoryById = async (req, res) => {
    try {
        const { dormId } = req.params;
        
        // 1. ดึงข้อมูลพื้นฐานของหอพัก
        const dormQuery = `
            SELECT 
                d.*,
                z.zone_name,
                c.manager_name,
                c.primary_phone,
                c.secondary_phone,
                c.line_id,
                c.email as contact_email
            FROM dormitories d
            LEFT JOIN zones z ON d.zone_id = z.zone_id
            LEFT JOIN contact_info c ON d.contact_id = c.contact_id
            WHERE d.dorm_id = $1
        `;
        
        const dormResult = await pool.query(dormQuery, [dormId]);
        
        if (dormResult.rows.length === 0) {
            return res.status(404).json({ message: 'Dormitory not found' });
        }

        const dormitory = dormResult.rows[0];

        // 2. ดึงรูปภาพทั้งหมดของหอพัก
        const imagesQuery = `
            SELECT image_id, image_url, image_type, is_primary
            FROM dormitory_images
            WHERE dorm_id = $1
            ORDER BY is_primary DESC, upload_date DESC
        `;
        const imagesResult = await pool.query(imagesQuery, [dormId]);
        
        // 3. ดึงสิ่งอำนวยความสะดวกของหอพัก
        const amenitiesQuery = `
            SELECT 
                a.amenity_id,
                a.amenity_name,
                da.is_available
            FROM dormitory_amenities da
            JOIN amenities a ON da.amenity_id = a.amenity_id
            WHERE da.dorm_id = $1
        `;
        const amenitiesResult = await pool.query(amenitiesQuery, [dormId]);

        // 4. ดึงรีวิวของหอพัก
        // ฟีเจอร์รีวิวยังไม่ได้ถูกพัฒนา จะใช้อาร์เรย์ว่างแทน
        const reviews = [];
        
        // 5. คำนวณคะแนนเฉลี่ย
        const ratingQuery = `
            SELECT 
                COUNT(*) as review_count,
                ROUND(AVG(rating)::numeric, 1) as average_rating
            FROM reviews
            WHERE dorm_id = $1
        `;
        const ratingResult = await pool.query(ratingQuery, [dormId]);
        
        // รวมข้อมูลทั้งหมด
        const response = {
            ...dormitory,
            images: imagesResult.rows,
            amenities: amenitiesResult.rows,
            reviews: reviews,
            rating_summary: ratingResult.rows[0]
        };
        
        res.json(response);
    } catch (error) {
        console.error('Error fetching dormitory details:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

// สมัครเป็นสมาชิกหอพัก
exports.requestMembership = async (req, res) => {
    try {
        const { dormId } = req.body;
        const firebase_uid = req.user.uid;
        
        if (!dormId) {
            return res.status(400).json({ message: 'Dormitory ID is required' });
        }
        
        // ค้นหา user ใน DB เพื่อเอา primary key (id)
        const userResult = await pool.query('SELECT id, user_id FROM users WHERE firebase_uid = $1', [firebase_uid]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'User not found in database' });
        }
        const rowUser = userResult.rows[0];
        const userId = rowUser.id !== null && rowUser.id !== undefined ? rowUser.id : rowUser.user_id;
        
        console.log('==== Debug fetched user ====');
        console.log(rowUser);
        
        // ตรวจสอบว่าเคยสมัครแล้วหรือไม่
        const existingRequest = await pool.query(
            'SELECT * FROM member_requests WHERE user_id = $1 AND dorm_id = $2',
            [userId, dormId]
        );
        
        if (existingRequest.rows.length > 0) {
            return res.status(409).json({ message: 'คุณได้ส่งคำขอสมัครหอพักนี้แล้ว' });
        }
        
        // สร้างคำขอใหม่
        const insertQuery = `
            INSERT INTO member_requests (user_id, dorm_id, request_date, status)
            VALUES ($1, $2, CURRENT_TIMESTAMP, 'รอพิจารณา')
            RETURNING *
        `;
        
        const result = await pool.query(insertQuery, [userId, dormId]);
        
        res.status(201).json({
            message: 'ส่งคำขอสมัครเป็นสมาชิกเรียบร้อยแล้ว',
            request: result.rows[0]
        });
    } catch (error) {
        console.error('Error creating membership request:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

// ดึงรายการคำขอของผู้ใช้
exports.getUserMembershipRequests = async (req, res) => {
    try {
        const firebase_uid = req.user.uid;
        
        const userResult = await pool.query('SELECT id, user_id FROM users WHERE firebase_uid = $1', [firebase_uid]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'User not found in database' });
        }
        const row2 = userResult.rows[0];
        const userId = row2.id !== null && row2.id !== undefined ? row2.id : row2.user_id;
        
        const query = `
            SELECT 
                mr.*,
                d.dorm_name,
                d.address,
                d.monthly_price
            FROM member_requests mr
            JOIN dormitories d ON mr.dorm_id = d.dorm_id
            WHERE mr.user_id = $1
            ORDER BY mr.request_date DESC
        `;
        
        const result = await pool.query(query, [userId]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching user membership requests:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

// เลือกหอพักที่อยู่ปัจจุบัน (สำหรับ member ที่ได้รับอนุมัติแล้ว)
exports.selectCurrentDormitory = async (req, res) => {
    try {
        const { dormId } = req.body;
        const firebase_uid = req.user.uid;
        
        if (!dormId) {
            return res.status(400).json({ message: 'Dormitory ID is required' });
        }
        
        // อัพเดท residence_dorm_id ในตาราง users
        const updateQuery = `
            UPDATE users 
            SET residence_dorm_id = $1, updated_at = CURRENT_TIMESTAMP
            WHERE firebase_uid = $2
            RETURNING *
        `;
        
        const result = await pool.query(updateQuery, [dormId, firebase_uid]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        res.json({
            message: 'เลือกหอพักเรียบร้อยแล้ว',
            user: result.rows[0]
        });
    } catch (error) {
        console.error('Error selecting dormitory:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

// ดึงหอพักแนะนำ (สุ่ม 8 แถว)
exports.getRecommendedDormitories = async (req, res) => {
  try {
    const { limit } = req.query; // optional
    let query = `
      SELECT d.*, z.zone_name, ${MAIN_IMAGE_SUBQUERY}
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      WHERE d.approval_status = 'อนุมัติแล้ว'
      ORDER BY RANDOM()`;
    const values = [];
    if (limit) {
      values.push(parseInt(limit, 10));
      query += ` LIMIT $1`;
    }
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching recommended dormitories:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// ดึงหอพักที่อัพเดทล่าสุด (เรียงตาม updated_date DESC)
exports.getLatestDormitories = async (req, res) => {
  try {
    const { limit } = req.query;
    let query = `
      SELECT d.*, z.zone_name, ${MAIN_IMAGE_SUBQUERY}
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      WHERE d.approval_status = 'อนุมัติแล้ว'
      ORDER BY d.updated_date DESC NULLS LAST`;
    const values = [];
    if (limit) {
      values.push(parseInt(limit, 10));
      query += ` LIMIT $1`;
    }
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching latest dormitories:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// ดึงรูปทั้งหมดของหอพักตาม dorm_id
exports.getDormitoryImages = async (req, res) => {
  try {
    const { dormId } = req.params;
    const query = `SELECT image_id, image_url, image_type, upload_date, is_primary
                   FROM dormitory_images WHERE dorm_id = $1 ORDER BY is_primary DESC, upload_date DESC`;
    const result = await pool.query(query, [dormId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dormitory images:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// เพิ่มประเภทห้องพักใหม่
exports.createRoomType = async (req, res) => {
  try {
    const { dormId } = req.params;
    const { 
      room_name, 
      bed_type, 
      size_sqm, 
      monthly_price, 
      daily_price, 
      summer_price, 
      price_type, 
      description, 
      max_occupancy 
    } = req.body;
    
    if (!room_name) {
      return res.status(400).json({ message: 'ต้องระบุชื่อประเภทห้อง' });
    }

    const query = `
      INSERT INTO room_types (
        dorm_id, 
        room_name, 
        bed_type, 
        size_sqm, 
        monthly_price, 
        daily_price, 
        summer_price, 
        price_type, 
        description, 
        max_occupancy
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    
    const values = [
      dormId,
      room_name,
      bed_type,
      size_sqm,
      monthly_price,
      daily_price,
      summer_price,
      price_type || 'fixed',
      description,
      max_occupancy
    ];

    const result = await pool.query(query, values);

    // อัพเดตช่วงราคาในตาราง dormitories
    await updateDormitoryPriceRange(dormId);
    
    res.status(201).json({ 
      message: 'เพิ่มประเภทห้องสำเร็จ',
      roomType: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating room type:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// แก้ไขข้อมูลประเภทห้อง
exports.updateRoomType = async (req, res) => {
  try {
    const { roomTypeId } = req.params;
    const { 
      room_name, 
      bed_type, 
      size_sqm, 
      monthly_price, 
      daily_price, 
      summer_price, 
      price_type, 
      description, 
      max_occupancy 
    } = req.body;

    // อ่านค่า dorm_id เพื่อใช้อัพเดตช่วงราคาภายหลัง
    const dormQuery = "SELECT dorm_id FROM room_types WHERE room_type_id = $1";
    const dormResult = await pool.query(dormQuery, [roomTypeId]);
    
    if (dormResult.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลประเภทห้อง' });
    }
    
    const dormId = dormResult.rows[0].dorm_id;
    
    const updateFields = [];
    const values = [];
    let paramCount = 1;
    
    if (room_name !== undefined) {
      updateFields.push(`room_name = $${paramCount++}`);
      values.push(room_name);
    }
    
    if (bed_type !== undefined) {
      updateFields.push(`bed_type = $${paramCount++}`);
      values.push(bed_type);
    }
    
    if (size_sqm !== undefined) {
      updateFields.push(`size_sqm = $${paramCount++}`);
      values.push(size_sqm);
    }
    
    if (monthly_price !== undefined) {
      updateFields.push(`monthly_price = $${paramCount++}`);
      values.push(monthly_price);
    }
    
    if (daily_price !== undefined) {
      updateFields.push(`daily_price = $${paramCount++}`);
      values.push(daily_price);
    }
    
    if (summer_price !== undefined) {
      updateFields.push(`summer_price = $${paramCount++}`);
      values.push(summer_price);
    }
    
    if (price_type !== undefined) {
      updateFields.push(`price_type = $${paramCount++}`);
      values.push(price_type);
    }
    
    if (description !== undefined) {
      updateFields.push(`description = $${paramCount++}`);
      values.push(description);
    }
    
    if (max_occupancy !== undefined) {
      updateFields.push(`max_occupancy = $${paramCount++}`);
      values.push(max_occupancy);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ message: 'ไม่มีข้อมูลสำหรับอัพเดต' });
    }
    
    const query = `
      UPDATE room_types 
      SET ${updateFields.join(', ')}
      WHERE room_type_id = $${paramCount}
      RETURNING *
    `;
    
    values.push(roomTypeId);
    
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลประเภทห้อง' });
    }

    // อัพเดตช่วงราคาในตาราง dormitories
    await updateDormitoryPriceRange(dormId);
    
    res.json({ 
      message: 'อัพเดตข้อมูลประเภทห้องสำเร็จ',
      roomType: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating room type:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// ลบประเภทห้อง
exports.deleteRoomType = async (req, res) => {
  try {
    const { roomTypeId } = req.params;

    // อ่านค่า dorm_id เพื่อใช้อัพเดตช่วงราคาภายหลัง
    const dormQuery = "SELECT dorm_id FROM room_types WHERE room_type_id = $1";
    const dormResult = await pool.query(dormQuery, [roomTypeId]);
    
    if (dormResult.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลประเภทห้อง' });
    }
    
    const dormId = dormResult.rows[0].dorm_id;
    
    const query = "DELETE FROM room_types WHERE room_type_id = $1 RETURNING *";
    const result = await pool.query(query, [roomTypeId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลประเภทห้อง' });
    }

    // อัพเดตช่วงราคาในตาราง dormitories
    await updateDormitoryPriceRange(dormId);
    
    res.json({ 
      message: 'ลบข้อมูลประเภทห้องสำเร็จ',
      roomType: result.rows[0]
    });
  } catch (error) {
    console.error('Error deleting room type:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// ฟังก์ชันช่วยอัพเดตช่วงราคาของหอพัก
async function updateDormitoryPriceRange(dormId) {
  try {
    // หาราคาต่ำสุดและสูงสุดของประเภทห้องในหอพัก
    const priceRangeQuery = `
      SELECT 
        ROUND(MIN(monthly_price))::integer as min_price,
        ROUND(MAX(monthly_price))::integer as max_price
      FROM room_types
      WHERE dorm_id = $1 AND monthly_price IS NOT NULL
    `;
    
    const priceRangeResult = await pool.query(priceRangeQuery, [dormId]);
    const { min_price, max_price } = priceRangeResult.rows[0];
    
    // อัพเดตราคาในตาราง dormitories
    const updateQuery = `
      UPDATE dormitories
      SET min_price = $1,
          max_price = $2,
          updated_date = CURRENT_TIMESTAMP
      WHERE dorm_id = $3
    `;
    
    await pool.query(updateQuery, [min_price, max_price, dormId]);
    
    return true;
  } catch (error) {
    console.error('Error updating dormitory price range:', error);
    throw error;
  }
}

// ============== ADMIN ENDPOINTS ==============

// ดึงรายการหอพักทั้งหมดสำหรับแอดมิน (รวมถึงหอพักที่ยังไม่ได้อนุมัติ)
exports.getAllDormitoriesAdmin = async (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT 
        d.*,
        z.zone_name,
        c.manager_name,
        c.primary_phone,
        c.secondary_phone,
        c.line_id,
        c.email as contact_email,
        ${MAIN_IMAGE_SUBQUERY}
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      LEFT JOIN contact_info c ON d.contact_id = c.contact_id
    `;

    const values = [];
    if (status) {
      values.push(status);
      query += ` WHERE d.approval_status = $1`;
    }

    query += ' ORDER BY d.updated_date DESC NULLS LAST';

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dormitories for admin:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// อนุมัติหอพัก
exports.approveDormitory = async (req, res) => {
  try {
    const { dormId } = req.params;
    
    const updateQuery = `
      UPDATE dormitories
      SET approval_status = 'อนุมัติแล้ว', updated_date = CURRENT_TIMESTAMP
      WHERE dorm_id = $1
      RETURNING *
    `;
    
    const result = await pool.query(updateQuery, [dormId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลหอพัก' });
    }
    
    res.json({ 
      message: 'อนุมัติหอพักเรียบร้อยแล้ว',
      dormitory: result.rows[0]
    });
  } catch (error) {
    console.error('Error approving dormitory:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// ปฏิเสธหอพัก
exports.rejectDormitory = async (req, res) => {
  try {
    const { dormId } = req.params;
    const { rejectionReason } = req.body;
    
    if (!rejectionReason) {
      return res.status(400).json({ message: 'กรุณาระบุเหตุผลในการปฏิเสธ' });
    }
    
    const updateQuery = `
      UPDATE dormitories
      SET approval_status = 'ไม่อนุมัติ', 
          rejection_reason = $2,
          updated_date = CURRENT_TIMESTAMP
      WHERE dorm_id = $1
      RETURNING *
    `;
    
    const result = await pool.query(updateQuery, [dormId, rejectionReason]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลหอพัก' });
    }
    
    res.json({ 
      message: 'ปฏิเสธหอพักเรียบร้อยแล้ว',
      dormitory: result.rows[0]
    });
  } catch (error) {
    console.error('Error rejecting dormitory:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// แก้ไขข้อมูลหอพักโดยแอดมิน
exports.updateDormitoryByAdmin = async (req, res) => {
  try {
    const { dormId } = req.params;
    const updateData = req.body;
    
    // ตรวจสอบว่ามีข้อมูลที่ต้องการอัพเดต
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: 'ไม่มีข้อมูลสำหรับอัพเดต' });
    }
    
    // สร้างคำสั่ง SQL สำหรับอัพเดต
    const updateFields = [];
    const values = [];
    let paramCount = 1;
    
    for (const [key, value] of Object.entries(updateData)) {
      // แปลงชื่อฟิลด์จาก camelCase เป็น snake_case สำหรับ DB
      const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      updateFields.push(`${dbField} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }
    
    // เพิ่ม updated_date
    updateFields.push(`updated_date = CURRENT_TIMESTAMP`);
    
    const query = `
      UPDATE dormitories
      SET ${updateFields.join(', ')}
      WHERE dorm_id = $${paramCount}
      RETURNING *
    `;
    
    values.push(dormId);
    
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลหอพัก' });
    }
    
    res.json({ 
      message: 'อัพเดตข้อมูลหอพักเรียบร้อยแล้ว',
      dormitory: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating dormitory by admin:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// ลบหอพักโดยแอดมิน
exports.deleteDormitoryByAdmin = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId } = req.params;
    
    await client.query('BEGIN');
    
    // 1. ลบรูปภาพที่เกี่ยวข้อง
    await client.query('DELETE FROM dormitory_images WHERE dorm_id = $1', [dormId]);
    
    // 2. ลบประเภทห้องที่เกี่ยวข้อง
    await client.query('DELETE FROM room_types WHERE dorm_id = $1', [dormId]);
    
    // 3. ลบข้อมูลหอพัก (ถ้ามี contact_info ที่เกี่ยวข้อง)
    const contactInfoResult = await client.query(
      'SELECT contact_id FROM dormitories WHERE dorm_id = $1',
      [dormId]
    );
    
    // 4. ลบหอพัก
    const result = await client.query(
      'DELETE FROM dormitories WHERE dorm_id = $1 RETURNING *',
      [dormId]
    );
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'ไม่พบข้อมูลหอพัก' });
    }
    
    // 5. ลบข้อมูลการติดต่อที่เกี่ยวข้อง (ถ้ามี)
    if (contactInfoResult.rows.length > 0 && contactInfoResult.rows[0].contact_id) {
      await client.query(
        'DELETE FROM contact_info WHERE contact_id = $1',
        [contactInfoResult.rows[0].contact_id]
      );
    }
    
    await client.query('COMMIT');
    
    res.json({ 
      message: 'ลบข้อมูลหอพักเรียบร้อยแล้ว',
      dormitory: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting dormitory by admin:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  } finally {
    client.release();
  }
};

// ดูรายละเอียดหอพักโดยแอดมิน
exports.getDormitoryDetailsByAdmin = async (req, res) => {
  try {
    const { dormId } = req.params;
    
    const query = `
      SELECT 
        d.*,
        z.zone_name,
        c.manager_name,
        c.primary_phone,
        c.secondary_phone,
        c.line_id,
        c.email as contact_email,
        (SELECT json_agg(rt.*) FROM room_types rt WHERE rt.dorm_id = d.dorm_id) as room_types,
        (SELECT json_agg(
          json_build_object(
            'image_id', di.image_id,
            'image_url', di.image_url,
            'image_type', di.image_type,
            'is_primary', di.is_primary
          )
        ) FROM dormitory_images di WHERE di.dorm_id = d.dorm_id) as images
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      LEFT JOIN contact_info c ON d.contact_id = c.contact_id
      WHERE d.dorm_id = $1
    `;
    
    const result = await pool.query(query, [dormId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลหอพัก' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching dormitory details for admin:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// ดึงรายการสิ่งอำนวยความสะดวกทั้งหมด
exports.getAllAmenities = async (req, res) => {
  try {
    const query = 'SELECT amenity_id, amenity_name FROM amenities ORDER BY amenity_id';
    const result = await pool.query(query);
    
    // แปลง amenity_name เป็น name เพื่อให้ตรงกับ frontend interface
    const amenities = result.rows.map(row => ({
      amenity_id: row.amenity_id,
      name: row.amenity_name
    }));
    
    res.json(amenities);
  } catch (error) {
    console.error('Error fetching amenities:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};