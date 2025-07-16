// src/controllers/dormitoryController.js
const pool = require('../db');

// Helper SQL fragment for selectingภาพหลักของหอพัก
const MAIN_IMAGE_SUBQUERY = `(
  SELECT image_url FROM dormitory_images
  WHERE dorm_id = d.dorm_id
  ORDER BY is_primary DESC, upload_date DESC, image_id ASC
  LIMIT 1
) AS main_image_url`;

// ดึงรายการหอพักทั้งหมดของ userId
exports.getDormitoriesByUserId = async (req, res) => {
  try {
    const { userId } = req.params;
    const query = `
      SELECT 
        d.dorm_id,
        d.dorm_name,
        d.address,
        d.dorm_description,
        d.latitude,
        d.longitude,
        d.monthly_price,
        d.daily_price,
        d.approval_status,
        d.created_date,
        d.updated_date,
        z.zone_name,
        (SELECT image_url FROM dormitory_images 
         WHERE dorm_id = d.dorm_id 
         ORDER BY is_primary DESC, upload_date DESC, image_id ASC 
         LIMIT 1) AS main_image_url
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      WHERE d.owner_id = $1
      ORDER BY d.created_date DESC
    `;
    const result = await pool.query(query, [userId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dormitories by user ID:', error);
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
// (ย้ายไปไฟล์ใหม่ adminDormitoryController.js)
// exports.getAllDormitoriesAdmin = ...
// exports.approveDormitory = ...
// exports.rejectDormitory = ...
// exports.updateDormitoryByAdmin = ...
// exports.deleteDormitoryByAdmin = ...
// exports.getDormitoryDetailsByAdmin = ...

// ดึงรายการหอพักทั้งหมดของ userId
exports.getDormitoriesByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    const query = `
          SELECT 
              d.*,
              z.zone_name,
              c.manager_name,
              c.primary_phone,
              c.secondary_phone,
              c.line_id,
              c.email as contact_email,
              (SELECT image_url FROM dormitory_images WHERE dorm_id = d.dorm_id LIMIT 1) as main_image_url
          FROM dormitories d
          LEFT JOIN zones z ON d.zone_id = z.zone_id
          LEFT JOIN contact_info c ON d.contact_id = c.contact_id
          WHERE d.owner_id = $1
          ORDER BY d.created_date DESC
      `;

    const result = await pool.query(query, [userId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dormitories by user ID:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// ดึงรายการหอพักทั้งหมดที่ได้รับการอนุมัติ
exports.getAllDormitories = async (req, res) => {
  try {
    const { zone_id, min_price, max_price, limit, offset } = req.query;

    let query = `
      SELECT 
        d.*,
        z.zone_name,
        ${MAIN_IMAGE_SUBQUERY}
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      WHERE d.approval_status = 'อนุมัติแล้ว'
    `;

    const values = [];
    let paramCount = 1;

    // เพิ่มเงื่อนไขการค้นหา
    if (zone_id) {
      query += ` AND d.zone_id = $${paramCount}`;
      values.push(zone_id);
      paramCount++;
    }

    if (min_price) {
      query += ` AND d.min_price >= $${paramCount}`;
      values.push(min_price);
      paramCount++;
    }

    if (max_price) {
      query += ` AND d.max_price <= $${paramCount}`;
      values.push(max_price);
      paramCount++;
    }

    query += ` ORDER BY d.updated_date DESC NULLS LAST`;

    // เพิ่ม pagination
    if (limit) {
      query += ` LIMIT $${paramCount}`;
      values.push(parseInt(limit, 10));
      paramCount++;
    }

    if (offset) {
      query += ` OFFSET $${paramCount}`;
      values.push(parseInt(offset, 10));
      paramCount++;
    }

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching all dormitories:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// ดึงตัวเลือกประเภทห้อง
exports.getRoomTypeOptions = async (req, res) => {
  try {
    const bedTypes = [
      'เตียงเดี่ยว',
      'เตียงคู่',
      'เตียงสองชั้น',
      'ที่นอนพื้น',
      'ไม่มีเตียง'
    ];

    const priceTypes = [
      'fixed',
      'negotiable',
      'seasonal'
    ];

    res.json({
      bedTypes,
      priceTypes
    });
  } catch (error) {
    console.error('Error fetching room type options:', error);
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