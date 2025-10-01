// src/controllers/dormitoryController.js
const pool = require("../db");
const { updateDormitoryPriceRange } = require('./editDormitoryController');
const storageService = require("../services/storageService");

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

    // ดึงรายการหอพักของ owner
    const dormsQuery = `
      SELECT 
        d.dorm_id,
        d.dorm_name,
        d.address,
        d.dorm_description,
        d.latitude,
        d.longitude,
        d.min_price,
        d.max_price,
        d.approval_status,
        d.created_date,
        d.updated_date,
        z.zone_name,
        (
          SELECT image_url FROM dormitory_images 
          WHERE dorm_id = d.dorm_id 
          ORDER BY is_primary DESC, upload_date DESC, image_id ASC 
          LIMIT 1
        ) AS main_image_url
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      WHERE d.owner_id = $1
      ORDER BY d.created_date DESC
    `;

    const dormsResult = await pool.query(dormsQuery, [userId]);
    const dorms = dormsResult.rows;

    // เตรียมสมาชิกและจำนวนสมาชิก (นับจาก users.residence_dorm_id)
    const dormIds = dorms.map((d) => d.dorm_id);
    let membersByDorm = {};

    if (dormIds.length > 0) {
      const membersQuery = `
        SELECT 
          u.id,
          u.username,
          u.display_name,
          u.email,
          u.phone_number,
          u.residence_dorm_id
        FROM users u
        WHERE u.residence_dorm_id = ANY($1::int[])
      `;
      const membersResult = await pool.query(membersQuery, [dormIds]);

      membersByDorm = dormIds.reduce((acc, dormId) => {
        acc[dormId] = membersResult.rows
          .filter((m) => m.residence_dorm_id === dormId)
          .map((m) => ({
            id: m.id,
            username: m.username,
            display_name: m.display_name,
            email: m.email,
            phone_number: m.phone_number,
            residence_dorm_id: m.residence_dorm_id,
          }));
        return acc;
      }, {});
    }

    // รวมข้อมูล member_count และ members เสมอ (อย่างน้อย member_count = 0, members = [])
    const response = dorms.map((d) => ({
      ...d,
      member_count: (membersByDorm[d.dorm_id] || []).length,
      members: membersByDorm[d.dorm_id] || [],
    }));

    res.json(response);
  } catch (error) {
    console.error(
      "Error fetching dormitories by user ID (with members):",
      error
    );
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};

// ดึงรายการหอของเจ้าของ (อ่านจาก Firebase token) พร้อมช่วงราคา min/max จากตาราง dormitories
exports.getOwnerDormitories = async (req, res) => {
  try {
    const firebase_uid = req.user.uid;

    // หา primary key ของผู้ใช้จาก firebase_uid
    const userResult = await pool.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const ownerId = userResult.rows[0].id;

    const query = `
      SELECT
        d.dorm_id,
        d.dorm_name,
        d.address,
        d.min_price,
        d.max_price,
        d.approval_status,
        to_char(COALESCE(d.updated_date, d.created_date), 'YYYY-MM-DD') AS updated_date,
        z.zone_name,
        (
          SELECT image_url FROM dormitory_images
          WHERE dorm_id = d.dorm_id
          ORDER BY is_primary DESC, upload_date DESC, image_id ASC
          LIMIT 1
        ) AS main_image_url
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      WHERE d.owner_id = $1
      ORDER BY d.created_date DESC
    `;

    const result = await pool.query(query, [ownerId]);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching owner dormitories:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

// ดึงรายการโซนทั้งหมด
exports.getAllZones = async (req, res) => {
  try {
    const query = "SELECT zone_id, zone_name FROM zones ORDER BY zone_name";
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching zones:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};

// ดึงข้อมูลหอพักตาม ID
exports.getDormitoryById = async (req, res) => {
  try {
    const { dormId } = req.params;

    // 1. ดึงข้อมูลพื้นฐานของหอพักพร้อมข้อมูล owner
    const dormQuery = `
      SELECT 
        d.*,
        z.zone_name,
        u.display_name as owner_name,
        u.email as owner_email,
        u.phone_number as owner_phone,
        u.username as owner_username,
        u.secondary_phone as owner_secondary_phone,
        u.line_id as owner_line_id,
        u.manager_name as owner_manager_name,
        u.photo_url as owner_photo_url
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      LEFT JOIN users u ON d.owner_id = u.id
      WHERE d.dorm_id = $1
    `;

    const dormResult = await pool.query(dormQuery, [dormId]);

    if (dormResult.rows.length === 0) {
      return res.status(404).json({ message: "Dormitory not found" });
    }

    const dormitory = dormResult.rows[0];
    
    // Debug: ตรวจสอบข้อมูล owner
    console.log(`[getDormitoryById] Dormitory ${dormId} owner data:`, {
      owner_id: dormitory.owner_id,
      owner_name: dormitory.owner_name,
      owner_email: dormitory.owner_email,
      owner_phone: dormitory.owner_phone,
      owner_photo_url: dormitory.owner_photo_url
    });

    // 2. ดึงรูปภาพทั้งหมดของหอพัก
    const imagesQuery = `
            SELECT image_id, image_url, is_primary
            FROM dormitory_images
            WHERE dorm_id = $1
            ORDER BY is_primary DESC, upload_date DESC
        `;
    const imagesResult = await pool.query(imagesQuery, [dormId]);

    // 3. ดึงสิ่งอำนวยความสะดวกของหอพัก
    const amenitiesQuery = `
            SELECT 
                da.amenity_id,
                da.amenity_name,
                da.location_type,
                da.is_available
            FROM dormitory_amenities da
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
      rating_summary: ratingResult.rows[0],
    };

    // Debug: ตรวจสอบ response object
    console.log(`[getDormitoryById] Response object keys:`, Object.keys(response));
    console.log(`[getDormitoryById] owner_photo_url in response:`, response.owner_photo_url);

    res.json(response);
  } catch (error) {
    console.error("Error fetching dormitory details:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};

// สมัครเป็นสมาชิกหอพัก
exports.requestMembership = async (req, res) => {
  try {
    const { dormId } = req.body;
    const firebase_uid = req.user.uid;

    if (!dormId) {
      return res.status(400).json({ message: "Dormitory ID is required" });
    }

    // ค้นหา user ใน DB เพื่อเอา primary key (id)
    const userResult = await pool.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found in database" });
    }
    const rowUser = userResult.rows[0];
    const userId = rowUser.id;

    console.log("==== Debug fetched user ====");
    console.log(rowUser);

    // ตรวจสอบว่าเคยสมัครแล้วหรือไม่
    const existingRequest = await pool.query(
      "SELECT * FROM member_requests WHERE user_id = $1 AND dorm_id = $2",
      [userId, dormId]
    );

    if (existingRequest.rows.length > 0) {
      return res
        .status(409)
        .json({ message: "คุณได้ส่งคำขอสมัครหอพักนี้แล้ว" });
    }

    // สร้างคำขอใหม่
    const insertQuery = `
            INSERT INTO member_requests (user_id, dorm_id, request_date, status)
            VALUES ($1, $2, CURRENT_TIMESTAMP, 'รออนุมัติ')
            RETURNING *
        `;

    const result = await pool.query(insertQuery, [userId, dormId]);

    res.status(201).json({
      message: "ส่งคำขอสมัครเป็นสมาชิกเรียบร้อยแล้ว",
      request: result.rows[0],
    });
  } catch (error) {
    console.error("Error creating membership request:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};

// ดึงรายการคำขอของผู้ใช้
exports.getUserMembershipRequests = async (req, res) => {
  try {
    const firebase_uid = req.user.uid;

    const userResult = await pool.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found in database" });
    }
    const row2 = userResult.rows[0];
    const userId = row2.id;

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
    console.error("Error fetching user membership requests:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};

// เลือกหอพักที่อยู่ปัจจุบัน (สำหรับ member ที่ได้รับอนุมัติแล้ว)
exports.selectCurrentDormitory = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId } = req.body;
    const firebase_uid = req.user.uid;

    if (!dormId) {
      return res.status(400).json({ message: "Dormitory ID is required" });
    }

    await client.query('BEGIN');

    // ดึงข้อมูลผู้ใช้ปัจจุบัน
    const userResult = await client.query(
      "SELECT id, residence_dorm_id FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "User not found" });
    }

    const userId = userResult.rows[0].id;
    const oldDormId = userResult.rows[0].residence_dorm_id;

    // ถ้ามีหอพักเก่า ให้ยกเลิกคำขอในหอพักเก่า
    if (oldDormId && oldDormId !== dormId) {
      await client.query(
        "UPDATE member_requests SET status = 'ยกเลิก' WHERE user_id = $1 AND dorm_id = $2",
        [userId, oldDormId]
      );
      console.log(`User ${userId} moved from dorm ${oldDormId} to dorm ${dormId}, cancelled old requests`);
    }

    // อัพเดท residence_dorm_id ในตาราง users
    const updateQuery = `
            UPDATE users 
            SET residence_dorm_id = $1, updated_at = CURRENT_TIMESTAMP
            WHERE firebase_uid = $2
            RETURNING *
        `;

    const result = await client.query(updateQuery, [dormId, firebase_uid]);

    // อัพเดต stay_history: ปิดแถวเดิม แล้วเปิดแถวใหม่ภายใน transaction เดียวกัน
    if (oldDormId) {
      await client.query(
        `UPDATE stay_history
         SET end_date = NOW(), is_current = false, status = 'moved_out'
         WHERE user_id = $1 AND dorm_id = $2 AND is_current = true`,
        [userId, oldDormId]
      );
    }

    await client.query(
      `INSERT INTO stay_history (user_id, dorm_id, start_date, end_date, is_current, status)
       VALUES ($1, $2, NOW(), NULL, true, 'active')`,
      [userId, dormId]
    );

    await client.query('COMMIT');

    res.json({
      message: "เลือกหอพักเรียบร้อยแล้ว",
      user: result.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error selecting dormitory:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  } finally {
    client.release();
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
      WHERE d.approval_status = 'อนุมัติ'
      ORDER BY RANDOM()`;
    const values = [];
    if (limit) {
      values.push(parseInt(limit, 10));
      query += ` LIMIT $1`;
    }
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching recommended dormitories:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
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
      WHERE d.approval_status = 'อนุมัติ'
      ORDER BY d.updated_date DESC NULLS LAST`;
    const values = [];
    if (limit) {
      values.push(parseInt(limit, 10));
      query += ` LIMIT $1`;
    }
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching latest dormitories:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};

// ดึงหอพักทั้งหมดที่อนุมัติแล้ว (สำหรับ public)
exports.getAllApprovedDormitories = async (req, res) => {
  try {
    const query = `
      SELECT d.*, z.zone_name, ${MAIN_IMAGE_SUBQUERY}
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      WHERE d.approval_status = 'อนุมัติ'
      ORDER BY d.created_date DESC
    `;
    
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching all approved dormitories:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลหอพักทั้งหมด" });
  }
};

// ดึงรูปทั้งหมดของหอพักตาม dorm_id
exports.getDormitoryImages = async (req, res) => {
  try {
    const { dormId } = req.params;
    const query = `SELECT image_id, image_url, upload_date, is_primary
                   FROM dormitory_images WHERE dorm_id = $1 ORDER BY is_primary DESC, upload_date DESC`;
    const result = await pool.query(query, [dormId]);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching dormitory images:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};

// อัปโหลดรูปภาพหอพักเพิ่มเติม
exports.uploadDormitoryImages = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId } = req.params;
    const firebase_uid = req.user.uid;

    // ตรวจสอบสิทธิ์ผู้ใช้ (เฉพาะเจ้าของหอพักที่สามารถอัปโหลดได้)
    const userResult = await client.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const userId = userResult.rows[0].id;

    // ตรวจสอบว่าหอพักนี้เป็นของผู้ใช้หรือไม่
    const dormResult = await client.query(
      "SELECT dorm_id, dorm_name FROM dormitories WHERE dorm_id = $1 AND owner_id = $2",
      [dormId, userId]
    );

    if (dormResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพักหรือไม่มีสิทธิ์อัปโหลด" });
    }

    const dormName = dormResult.rows[0].dorm_name;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "ไม่พบไฟล์รูปภาพ" });
    }

    await client.query("BEGIN");

    const uploadedImages = [];

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      // อัปโหลดไป Firebase Storage ในโฟลเดอร์ Dorm_Gallery/{ชื่อหอพัก}
      const imageUrl = await storageService.uploadDormitoryImage(file, dormName);
      
      // รูปแรกเป็น primary (ภาพหลักของหอพัก)
      const isPrimary = i === 0;
      
      // บันทึกลงฐานข้อมูล
      const imageResult = await client.query(
        `INSERT INTO dormitory_images (dorm_id, image_url, is_primary, upload_date)
         VALUES ($1, $2, $3, NOW())
         RETURNING image_id, image_url, is_primary, upload_date`,
        [dormId, imageUrl, isPrimary]
      );

      uploadedImages.push(imageResult.rows[0]);
    }

    await client.query("COMMIT");

    res.status(201).json({
      message: "อัปโหลดรูปภาพหอพักสำเร็จ",
      uploadedCount: uploadedImages.length,
      images: uploadedImages
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error uploading dormitory images:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปโหลดรูปภาพ", error: error.message });
  } finally {
    client.release();
  }
};

// ดึงรายการ room types ของหอพัก
exports.getRoomTypesByDormId = async (req, res) => {
  try {
    const { dormId } = req.params;
    
    const query = `
      SELECT 
        room_type_id,
        room_name,
        bed_type,
        monthly_price,
        daily_price,
        summer_price,
        term_price
      FROM room_types 
      WHERE dorm_id = $1
      ORDER BY COALESCE(monthly_price, 2147483647), room_type_id
    `;
    
    const result = await pool.query(query, [dormId]);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching room types by dorm ID:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};

// เพิ่มประเภทห้องพักใหม่
exports.createRoomType = async (req, res) => {
  try {
    const { dormId } = req.params;

    const name        = (req.body.name ?? req.body.room_name ?? '').toString().trim();
    // << สำคัญ: รองรับ bedType จากหน้าบ้าน >>
    const bed_type    = req.body.bed_type ?? req.body.bedType ?? null;
    // removed price_type: no longer stored in DB

    const toNumberOrNull = (v) => {
      if (v === undefined || v === null) return null;
      if (typeof v === 'string') {
        const t = v.trim();
        if (t === '' || t === 'ติดต่อสอบถาม') return null;
        const n = Number(t.replace(/[,\s]/g, ''));
        return Number.isFinite(n) ? n : null;
      }
      return Number.isFinite(Number(v)) ? Number(v) : null;
    };

    const monthly_price = toNumberOrNull(req.body.monthly_price);
    const daily_price   = toNumberOrNull(req.body.daily_price);
    const summer_price  = toNumberOrNull(req.body.summer_price);
    const term_price    = toNumberOrNull(req.body.term_price);

    if (!name) {
      return res.status(400).json({ message: 'ต้องระบุชื่อประเภทห้อง' });
    }

    const query = `
      INSERT INTO room_types (
        dorm_id, room_name, bed_type,
        monthly_price, daily_price, summer_price,
        term_price
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `;

    const values = [
      dormId, name, bed_type,
      monthly_price, daily_price, summer_price,
      term_price
    ];

    const result = await pool.query(query, values);

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


// เพิ่มประเภทห้องพักหลายรายการแบบ bulk (แก้เวอร์ชันให้ชัดเจนว่าอัปเดตช่วงราคาเฉพาะ monthly)
exports.createRoomTypesBulk = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId } = req.params;
    console.log('[createRoomTypesBulk] req.body:', JSON.stringify(req.body, null, 2));
    console.log('[createRoomTypesBulk] dormId:', dormId);
    const items = Array.isArray(req.body) ? req.body : req.body?.items;

    console.log('[createRoomTypesBulk] items:', items);
    console.log('[createRoomTypesBulk] items.length:', items?.length);

    if (!Array.isArray(items) || items.length === 0) {
      console.log('[createRoomTypesBulk] Invalid items array');
      return res.status(400).json({ message: 'ต้องระบุรายการประเภทห้องอย่างน้อย 1 รายการ' });
    }

    const toNumberOrNull = (v) => {
      if (v === undefined || v === null) return null;
      if (typeof v === 'string') {
        const t = v.trim();
        if (t === '' || t === 'ติดต่อสอบถาม') return null;
        const n = Number(t.replace(/[\,\s]/g, ''));
        return Number.isFinite(n) ? n : null;
      }
      return Number.isFinite(Number(v)) ? Number(v) : null;
    };

    const insertSql = `
      INSERT INTO room_types (
        dorm_id, room_name, bed_type,
        monthly_price, daily_price, summer_price,
        term_price
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (dorm_id, room_name) DO UPDATE SET
        bed_type       = EXCLUDED.bed_type,
        monthly_price  = EXCLUDED.monthly_price,
        daily_price    = EXCLUDED.daily_price,
        summer_price   = EXCLUDED.summer_price,
        term_price     = EXCLUDED.term_price
      RETURNING *
    `;

    const results = [];
    const errors = [];

    await client.query('BEGIN');

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx] || {};
      const name = (it.name ?? it.room_name ?? '').toString().trim();
      if (!name) {
        errors.push({ index: idx, message: 'ขาดชื่อประเภทห้อง (name)' });
        continue;
      }

      const bed_type     = it.bed_type ?? it.bedType ?? null; // << รองรับ bedType >>
      // removed price_type

      const monthly_price = toNumberOrNull(it.monthly_price);
      const daily_price   = toNumberOrNull(it.daily_price);
      const summer_price  = toNumberOrNull(it.summer_price);
      const term_price    = toNumberOrNull(it.term_price);

      try {
        const r = await client.query(insertSql, [
          dormId, name, bed_type,
          monthly_price, daily_price, summer_price,
          term_price
        ]);
        results.push(r.rows[0]);
      } catch (e) {
        console.error('Error inserting room type (bulk):', e);
        errors.push({ index: idx, message: e.message });
      }
    }

    await updateDormitoryPriceRange(dormId);
    await client.query('COMMIT');

    return res.status(201).json({
      message: 'บันทึกประเภทห้องสำเร็จแบบกลุ่ม',
      inserted_or_updated: results.length,
      errors,
      items: results
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating room types (bulk):', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  } finally {
    client.release();
  }
};

// เพิ่มสิ่งอำนวยความสะดวกให้หอพัก
exports.addDormitoryAmenities = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId } = req.params;
    const { amenities } = req.body; // [{ amenity_id: 1, location_type: 'indoor' }, ...]

    if (!Array.isArray(amenities) || amenities.length === 0) {
      return res.status(400).json({ message: 'ต้องระบุสิ่งอำนวยความสะดวกอย่างน้อย 1 รายการ' });
    }

    await client.query('BEGIN');

    // ลบสิ่งอำนวยความสะดวกเดิมทั้งหมด
    await client.query('DELETE FROM dormitory_amenities WHERE dorm_id = $1', [dormId]);

    // เพิ่มสิ่งอำนวยความสะดวกใหม่
    const insertPromises = amenities.map(amenity => {
      const amenityId = amenity.amenity_id || amenity.id;
      const locationType = amenity.location_type || 'indoor';
      const amenityName = amenity.amenity_name || null;
      
      return client.query(
        `INSERT INTO dormitory_amenities (dorm_id, amenity_id, location_type, amenity_name, is_available) 
         VALUES ($1, $2, $3, $4, $5)`,
        [dormId, amenityId, locationType, amenityName, true]
      );
    });

    await Promise.all(insertPromises);
    await client.query('COMMIT');

    res.status(201).json({
      message: 'เพิ่มสิ่งอำนวยความสะดวกสำเร็จ',
      addedCount: amenities.length
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error adding dormitory amenities:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเพิ่มสิ่งอำนวยความสะดวก', error: error.message });
  } finally {
    client.release();
  }
};

// ดึงสิ่งอำนวยความสะดวกของหอพักแยกตาม location_type
exports.getDormitoryAmenities = async (req, res) => {
  try {
    const { dormId } = req.params;

    const query = `
      SELECT 
        da.dorm_amenity_id,
        da.amenity_id, 
        da.location_type,
        da.amenity_name,
        da.is_available,
        a.amenity_name as standard_amenity_name
      FROM dormitory_amenities da
      LEFT JOIN amenities a ON da.amenity_id = a.amenity_id
      WHERE da.dorm_id = $1
      ORDER BY da.location_type, COALESCE(da.amenity_name, a.amenity_name)
    `;

    const result = await pool.query(query, [dormId]);

    // จัดกลุ่มตาม location_type
    const groupedAmenities = {
      indoor: [],
      outdoor: [],
      common: []
    };

    result.rows.forEach(row => {
      const locationType = row.location_type || 'indoor';
      if (groupedAmenities[locationType]) {
        groupedAmenities[locationType].push({
          dorm_amenity_id: row.dorm_amenity_id,
          amenity_id: row.amenity_id,
          location_type: row.location_type,
          amenity_name: row.amenity_name,
          is_available: row.is_available,
          standard_amenity_name: row.standard_amenity_name
        });
      }
    });

    res.json({
      dorm_id: dormId,
      amenities: groupedAmenities
    });

  } catch (error) {
    console.error('Error fetching dormitory amenities:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูลสิ่งอำนวยความสะดวก', error: error.message });
  }
};

// อัปเดตสิ่งอำนวยความสะดวกแบบบางส่วน (partial update)
// รองรับการ upsert ตาม (dorm_id, amenity_id) และตั้งค่า is_available/location_type/amenity_name ตามที่ส่งมา
// รูปแบบ payload:
// {
//   amenities: [
//     { amenity_id: 1, is_available: true, location_type: 'indoor', amenity_name: null },
//     { amenity_id: 7, is_available: false }
//   ]
// }
// moved to editDormitoryController.updateDormitoryAmenities

// ============== ADMIN ENDPOINTS ==============
// (ย้ายไปไฟล์ใหม่ adminDormitoryController.js)
// exports.getAllDormitoriesAdmin = ...
// exports.approveDormitory = ...
// exports.rejectDormitory = ...
// exports.updateDormitoryByAdmin = ...
// exports.deleteDormitoryByAdmin = ...
// exports.getDormitoryDetailsByAdmin = ...

// ดึงตัวเลือกประเภทห้อง
exports.getRoomTypeOptions = async (req, res) => {
  try {
    const bedTypes = [
      "เตียงเดี่ยว",
      "เตียงคู่",
      "เตียงสองชั้น",
      "ที่นอนพื้น",
      "ไม่มีเตียง",
    ];

    const priceTypes = ["fixed", "negotiable", "seasonal"];

    res.json({
      bedTypes,
      priceTypes,
    });
  } catch (error) {
    console.error("Error fetching room type options:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};

// ดึงรายการสิ่งอำนวยความสะดวกทั้งหมด
exports.getAllAmenities = async (req, res) => {
  try {
    // ส่งรายการสิ่งอำนวยความสะดวกมาตรฐานแทน
    const amenities = [
      { amenity_id: 1, name: "แอร์" },
      { amenity_id: 2, name: "TV" },
      { amenity_id: 3, name: "เตียงนอน" },
      { amenity_id: 4, name: "ตู้เสื้อผ้า" },
      { amenity_id: 5, name: "ไมโครเวฟ" },
      { amenity_id: 6, name: "ซิงค์ล้างจาน" },
      { amenity_id: 7, name: "พัดลม" },
      { amenity_id: 8, name: "ตู้เย็น" },
      { amenity_id: 9, name: "WIFI" },
      { amenity_id: 10, name: "โต๊ะทำงาน" },
      { amenity_id: 11, name: "เครื่องทำน้ำอุ่น" },
      { amenity_id: 12, name: "โต๊ะเครื่องแป้ง" },
      { amenity_id: 13, name: "กล้องวงจรปิด" },
      { amenity_id: 14, name: "ลิฟต์" },
      { amenity_id: 15, name: "ฟิตเนส" },
      { amenity_id: 16, name: "ตู้น้ำหยอดเหรียญ" },
      { amenity_id: 17, name: "ที่วางพัสดุ" },
      { amenity_id: 18, name: "คีย์การ์ด" },
      { amenity_id: 19, name: "รปภ." },
      { amenity_id: 20, name: "ที่จอดรถ" },
      { amenity_id: 21, name: "Lobby" },
      { amenity_id: 22, name: "สระว่ายน้ำ" },
      { amenity_id: 23, name: "อนุญาตให้เลี้ยงสัตว์" },
      { amenity_id: 24, name: "เครื่องซักผ้า" }
    ];

    res.json(amenities);
  } catch (error) {
    console.error("Error fetching amenities:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};

// ดึงจำนวนสมาชิกในแต่ละหอพัก
exports.getDormitoryMemberCount = async (req, res) => {
  try {
    const { dormId } = req.params;

    // ตรวจสอบว่าหอพักมีอยู่หรือไม่
    const dormCheck = await pool.query(
      "SELECT dorm_id, dorm_name FROM dormitories WHERE dorm_id = $1",
      [dormId]
    );

    if (dormCheck.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
    }

    // ดึงจำนวนสมาชิกที่อยู่จริงในหอพัก
    const memberCountQuery = `
      SELECT COUNT(*) as member_count
      FROM users 
      WHERE residence_dorm_id = $1
    `;

    const memberCountResult = await pool.query(memberCountQuery, [dormId]);
    const memberCount = parseInt(memberCountResult.rows[0].member_count);

    // ดึงจำนวนคำขอที่รอการอนุมัติ
    const pendingRequestQuery = `
      SELECT COUNT(*) as pending_count
      FROM member_requests 
              WHERE dorm_id = $1 AND status = 'รออนุมัติ'
    `;

    const pendingRequestResult = await pool.query(pendingRequestQuery, [
      dormId,
    ]);
    const pendingCount = parseInt(pendingRequestResult.rows[0].pending_count);

    res.json({
      dorm_id: parseInt(dormId),
      dorm_name: dormCheck.rows[0].dorm_name,
      member_count: memberCount,
      pending_request_count: pendingCount,
      total_related_users: memberCount + pendingCount,
    });
  } catch (error) {
    console.error("Error fetching dormitory member count:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};

// ดึงรายการผู้เช่าของหอพัก
exports.getDormitoryTenants = async (req, res) => {
  try {
    const { dormId } = req.params;
    const { uid } = req.user; // จาก middleware auth

    // ตรวจสอบว่าหอพักมีอยู่และเป็นเจ้าของหรือไม่
    const dormCheck = await pool.query(
      "SELECT dorm_id, dorm_name, owner_id FROM dormitories WHERE dorm_id = $1",
      [dormId]
    );

    if (dormCheck.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
    }

    // ตรวจสอบว่าเป็นเจ้าของหอพักหรือไม่
    const ownerCheck = await pool.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [uid]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const userId = ownerCheck.rows[0].id;
    if (dormCheck.rows[0].owner_id !== userId) {
      return res.status(403).json({ message: "ไม่มีสิทธิ์เข้าถึงข้อมูลหอพักนี้" });
    }

    // ดึงรายการผู้เช่าที่อยู่จริงในหอพัก
    const tenantsQuery = `
      SELECT 
        u.id,
        u.username,
        u.display_name,
        u.email,
        u.phone_number,
        u.profile_image_url,
        u.created_at,
        'ยืนยันแล้ว' as status
      FROM users u
      WHERE u.residence_dorm_id = $1
      ORDER BY u.created_at DESC
    `;

    const tenantsResult = await pool.query(tenantsQuery, [dormId]);

    // ดึงรายการคำขอที่รอการอนุมัติ
    const pendingRequestsQuery = `
      SELECT 
        u.id,
        u.username,
        u.display_name,
        u.email,
        u.phone_number,
        u.profile_image_url,
        mr.request_date,
        'รออนุมัติ' as status
      FROM member_requests mr
      JOIN users u ON mr.user_id = u.id
      WHERE mr.dorm_id = $1 AND mr.status = 'รออนุมัติ'
      ORDER BY mr.request_date DESC
    `;

    const pendingRequestsResult = await pool.query(pendingRequestsQuery, [dormId]);

    // รวมข้อมูลและจัดรูปแบบ
    const tenants = [...tenantsResult.rows, ...pendingRequestsResult.rows].map(tenant => ({
      id: tenant.id,
      username: tenant.username,
      display_name: tenant.display_name,
      email: tenant.email,
      phone_number: tenant.phone_number,
      profile_image_url: tenant.profile_image_url,
      created_at: tenant.created_at,
      status: tenant.status,
      // คำนวณเวลาที่ผ่านมา
      time_ago: getTimeAgo(tenant.created_at)
    }));

    res.json({
      dorm_id: parseInt(dormId),
      dorm_name: dormCheck.rows[0].dorm_name,
      tenants: tenants,
      total_tenants: tenants.length
    });

  } catch (error) {
    console.error("Error fetching dormitory tenants:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};

// Helper function สำหรับคำนวณเวลาที่ผ่านมา
function getTimeAgo(date) {
  if (!date) return "ไม่ทราบวันที่";
  
  try {
    const now = new Date();
    const created = new Date(date);
    const diffInMs = now - created;
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInHours / 24);

    if (diffInDays > 0) {
      return `สมัครเมื่อ ${diffInDays} วันที่แล้ว`;
    } else if (diffInHours > 0) {
      return `สมัครเมื่อ ${diffInHours} ชั่วโมงที่แล้ว`;
    } else {
      const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
      return `สมัครเมื่อ ${diffInMinutes} นาทีที่แล้ว`;
    }
  } catch (error) {
    console.error("Error calculating time ago:", error);
    return "ไม่ทราบวันที่";
  }
}

// ยืนยันผู้เช่า
exports.approveTenant = async (req, res) => {
  try {
    const { dormId, userId } = req.params;
    const { uid } = req.user;

    // ตรวจสอบสิทธิ์
    const ownerCheck = await pool.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [uid]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const ownerId = ownerCheck.rows[0].id;
    
    // ตรวจสอบว่าเป็นเจ้าของหอพัก
    const dormCheck = await pool.query(
      "SELECT dorm_id FROM dormitories WHERE dorm_id = $1 AND owner_id = $2",
      [dormId, ownerId]
    );

    if (dormCheck.rows.length === 0) {
      return res.status(403).json({ message: "ไม่มีสิทธิ์เข้าถึงข้อมูลหอพักนี้" });
    }

    // ทำเป็นธุรกรรม: อนุมัติ + อัพเดต users + เขียน stay_history
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        "UPDATE member_requests SET status = 'อนุมัติ', approved_date = NOW() WHERE dorm_id = $1 AND user_id = $2",
        [dormId, userId]
      );

      await client.query(
        "UPDATE users SET residence_dorm_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [dormId, userId]
      );

      // ปิด stay ปัจจุบัน (ถ้ามี)
      await client.query(
        `UPDATE stay_history
         SET end_date = NOW(), is_current = false, status = 'moved_out'
         WHERE user_id = $1 AND is_current = true`,
        [userId]
      );

      // เปิด stay ใหม่สำหรับหอนี้
      await client.query(
        `INSERT INTO stay_history (user_id, dorm_id, start_date, end_date, is_current, status)
         VALUES ($1, $2, NOW(), NULL, true, 'active')`,
        [userId, dormId]
      );

      await client.query('COMMIT');
      client.release();
    } catch (e) {
      await client.query('ROLLBACK');
      client.release();
      throw e;
    }

    res.json({ message: "ยืนยันผู้เช่าสำเร็จ" });

  } catch (error) {
    console.error("Error approving tenant:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

// ปฏิเสธผู้เช่า
exports.rejectTenant = async (req, res) => {
  try {
    const { dormId, userId } = req.params;
    const { uid } = req.user;
    const { response_note } = req.body; // รับ response_note จาก request body

    // ตรวจสอบสิทธิ์
    const ownerCheck = await pool.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [uid]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const ownerId = ownerCheck.rows[0].id;
    
    // ตรวจสอบว่าเป็นเจ้าของหอพัก
    const dormCheck = await pool.query(
      "SELECT dorm_id FROM dormitories WHERE dorm_id = $1 AND owner_id = $2",
      [dormId, ownerId]
    );

    if (dormCheck.rows.length === 0) {
      return res.status(403).json({ message: "ไม่มีสิทธิ์เข้าถึงข้อมูลหอพักนี้" });
    }

    // อัพเดตสถานะคำขอเป็น 'ปฏิเสธ' พร้อม response_note
    await pool.query(
      "UPDATE member_requests SET status = 'ปฏิเสธ', response_note = $1 WHERE dorm_id = $2 AND user_id = $3",
      [response_note || null, dormId, userId]
    );

    res.json({ message: "ปฏิเสธผู้เช่าสำเร็จ" });

  } catch (error) {
    console.error("Error rejecting tenant:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

// ยกเลิกการยืนยันผู้เช่า
exports.cancelTenantApproval = async (req, res) => {
  try {
    const { dormId, userId } = req.params;
    const { uid } = req.user;

    // ตรวจสอบสิทธิ์
    const ownerCheck = await pool.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [uid]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const ownerId = ownerCheck.rows[0].id;
    
    // ตรวจสอบว่าเป็นเจ้าของหอพัก
    const dormCheck = await pool.query(
      "SELECT dorm_id FROM dormitories WHERE dorm_id = $1 AND owner_id = $2",
      [dormId, ownerId]
    );

    if (dormCheck.rows.length === 0) {
      return res.status(403).json({ message: "ไม่มีสิทธิ์เข้าถึงข้อมูลหอพักนี้" });
    }

    // อัพเดต residence_dorm_id ของผู้ใช้เป็น null
    await pool.query(
      "UPDATE users SET residence_dorm_id = NULL WHERE id = $1 AND residence_dorm_id = $2",
      [userId, dormId]
    );

    // อัพเดตสถานะคำขอเป็น 'รออนุมัติ' (ให้กลับมาใหม่)
    await pool.query(
      "UPDATE member_requests SET status = 'รออนุมัติ' WHERE dorm_id = $1 AND user_id = $2",
      [dormId, userId]
    );

    res.json({ message: "ยกเลิกการยืนยันผู้เช่าสำเร็จ" });

  } catch (error) {
    console.error("Error canceling tenant approval:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

// ดึงผู้เช่าของทุกหอที่เจ้าของเป็นเจ้าของ
exports.getAllOwnerTenants = async (req, res) => {
  try {
    const { uid } = req.user;

    // ตรวจสอบว่าเป็น owner
    const ownerCheck = await pool.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [uid]
    );

    if (ownerCheck.rows.length === 0) {
      return res.status(403).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const ownerId = ownerCheck.rows[0].id;

    // ดึงรายการหอพักทั้งหมดที่เจ้าของเป็นเจ้าของ
    const dormsQuery = `
      SELECT dorm_id, dorm_name 
      FROM dormitories 
      WHERE owner_id = $1
      ORDER BY dorm_name
    `;
    const dormsResult = await pool.query(dormsQuery, [ownerId]);
    const dorms = dormsResult.rows;

    if (dorms.length === 0) {
      return res.json({
        owner_id: ownerId,
        dorms: [],
        tenants: [],
        total_tenants: 0
      });
    }

    const dormIds = dorms.map(d => d.dorm_id);

        // ดึงรายการคำขอทั้งหมดจาก member_requests (ทั้งรออนุมัติ, อนุมัติ, ปฏิเสธ)
    const allRequestsQuery = `
      SELECT 
        u.id,
        u.username,
        u.display_name,
        u.email,
        u.phone_number,
        u.photo_url,
        mr.request_date,
        mr.dorm_id as residence_dorm_id,
        mr.status as request_status,
        mr.response_note,
        d.dorm_name
        FROM member_requests mr
      JOIN users u ON mr.user_id = u.id
      JOIN dormitories d ON mr.dorm_id = d.dorm_id
      WHERE mr.dorm_id = ANY($1::int[])
      ORDER BY mr.request_date DESC
    `;

    const allRequestsResult = await pool.query(allRequestsQuery, [dormIds]);

    // ป้องกันข้อมูลซ้ำโดยใช้ Map
    const tenantMap = new Map();
    
    allRequestsResult.rows.forEach(tenant => {
      const key = `${tenant.id}-${tenant.residence_dorm_id}`;
      if (!tenantMap.has(key)) {
        tenantMap.set(key, {
          id: tenant.id || null,
          username: tenant.username || '',
          display_name: tenant.display_name || '',
          email: tenant.email || '',
          phone_number: tenant.phone_number || '',
          profile_image_url: tenant.photo_url || null,
          created_at: tenant.request_date || null,
          residence_dorm_id: tenant.residence_dorm_id || null,
          dorm_name: tenant.dorm_name || '',
          status: tenant.request_status || 'ไม่ทราบสถานะ', // ใช้ status จาก member_requests
          response_note: tenant.response_note || null, // เพิ่ม response_note
          time_ago: getTimeAgo(tenant.request_date)
        });
      }
    });
    
    const tenants = Array.from(tenantMap.values());

    res.json({
      owner_id: ownerId,
      dorms: dorms,
      tenants: tenants,
      total_tenants: tenants.length
    });

  } catch (error) {
    console.error("Error fetching all owner tenants:", error);
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
};

// ลบรูปภาพหอพัก
exports.deleteDormitoryImage = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId, imageId } = req.params;
    const firebase_uid = req.user.uid;

    // ตรวจสอบสิทธิ์ผู้ใช้ (เฉพาะเจ้าของหอพักที่สามารถลบได้)
    const userResult = await client.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const userId = userResult.rows[0].id;

    // ตรวจสอบว่าหอพักนี้เป็นของผู้ใช้หรือไม่
    const dormResult = await client.query(
      "SELECT dorm_id, dorm_name FROM dormitories WHERE dorm_id = $1 AND owner_id = $2",
      [dormId, userId]
    );

    if (dormResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพักหรือไม่มีสิทธิ์ลบ" });
    }

    // ตรวจสอบว่ารูปภาพมีอยู่และเป็นของหอพักนี้หรือไม่
    const imageResult = await client.query(
      "SELECT image_id, image_url, is_primary FROM dormitory_images WHERE image_id = $1 AND dorm_id = $2",
      [imageId, dormId]
    );

    if (imageResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบรูปภาพ" });
    }

    const image = imageResult.rows[0];

    await client.query("BEGIN");

    // ลบรูปภาพจากฐานข้อมูล
    await client.query(
      "DELETE FROM dormitory_images WHERE image_id = $1",
      [imageId]
    );

    // ถ้าเป็นรูปหลัก ให้ตั้งรูปอื่นเป็นหลักแทน
    if (image.is_primary) {
      const nextPrimaryResult = await client.query(
        "SELECT image_id FROM dormitory_images WHERE dorm_id = $1 ORDER BY upload_date DESC LIMIT 1",
        [dormId]
      );

      if (nextPrimaryResult.rows.length > 0) {
        await client.query(
          "UPDATE dormitory_images SET is_primary = true WHERE image_id = $1",
          [nextPrimaryResult.rows[0].image_id]
        );
      }
    }

    await client.query("COMMIT");

    res.json({ 
      message: "ลบรูปภาพสำเร็จ",
      deleted_image_id: imageId
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error deleting dormitory image:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบรูปภาพ", error: error.message });
  } finally {
    client.release();
  }
};

// ตั้งรูปภาพเป็นหลัก
exports.setPrimaryImage = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId, imageId } = req.params;
    const firebase_uid = req.user.uid;

    // ตรวจสอบสิทธิ์ผู้ใช้ (เฉพาะเจ้าของหอพักที่สามารถแก้ไขได้)
    const userResult = await client.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const userId = userResult.rows[0].id;

    // ตรวจสอบว่าหอพักนี้เป็นของผู้ใช้หรือไม่
    const dormResult = await client.query(
      "SELECT dorm_id FROM dormitories WHERE dorm_id = $1 AND owner_id = $2",
      [dormId, userId]
    );

    if (dormResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพักหรือไม่มีสิทธิ์แก้ไข" });
    }

    // ตรวจสอบว่ารูปภาพมีอยู่และเป็นของหอพักนี้หรือไม่
    const imageResult = await client.query(
      "SELECT image_id FROM dormitory_images WHERE image_id = $1 AND dorm_id = $2",
      [imageId, dormId]
    );

    if (imageResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบรูปภาพ" });
    }

    await client.query("BEGIN");

    // ยกเลิกรูปหลักเดิมทั้งหมด
    await client.query(
      "UPDATE dormitory_images SET is_primary = false WHERE dorm_id = $1",
      [dormId]
    );

    // ตั้งรูปใหม่เป็นหลัก
    await client.query(
      "UPDATE dormitory_images SET is_primary = true WHERE image_id = $1",
      [imageId]
    );

    await client.query("COMMIT");

    res.json({
      message: "ตั้งรูปภาพเป็นหลักสำเร็จ",
      primary_image_id: imageId
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error setting primary image:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการตั้งรูปภาพเป็นหลัก", error: error.message });
  } finally {
    client.release();
  }
};

// ดึงข้อมูลหอพักทั้งหมดสำหรับแผนที่
exports.getAllDormitoriesForMap = async (req, res) => {
  try {
    const { 
      zone_id, 
      min_price, 
      max_price, 
      rating_min,
      limit = 100,
      offset = 0 
    } = req.query;

    // สร้าง WHERE clause ตาม filter ที่ส่งมา
    let whereConditions = ["d.approval_status = 'อนุมัติ'"];
    let queryParams = [];
    let paramIndex = 1;

    // Filter ตามโซน
    if (zone_id) {
      whereConditions.push(`d.zone_id = $${paramIndex++}`);
      queryParams.push(zone_id);
    }

    // Filter ตามช่วงราคา
    if (min_price) {
      whereConditions.push(`d.min_price >= $${paramIndex++}`);
      queryParams.push(min_price);
    }
    if (max_price) {
      whereConditions.push(`d.max_price <= $${paramIndex++}`);
      queryParams.push(max_price);
    }

    // Filter ตามคะแนนรีวิว
    if (rating_min) {
      whereConditions.push(`COALESCE(avg_rating, 0) >= $${paramIndex++}`);
      queryParams.push(rating_min);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Query หลักสำหรับดึงข้อมูลหอพักพร้อมข้อมูลที่จำเป็นสำหรับแผนที่
    const query = `
      SELECT 
        d.dorm_id,
        d.dorm_name,
        d.address,
        d.latitude,
        d.longitude,
        d.min_price,
        d.max_price,
        z.zone_name,
        (
          SELECT image_url 
          FROM dormitory_images 
          WHERE dorm_id = d.dorm_id 
          ORDER BY is_primary DESC, upload_date DESC 
          LIMIT 1
        ) AS main_image_url,
        COALESCE(
          (SELECT AVG(rating) FROM reviews WHERE dorm_id = d.dorm_id), 
          0
        ) AS avg_rating,
        COALESCE(
          (SELECT COUNT(*) FROM reviews WHERE dorm_id = d.dorm_id), 
          0
        ) AS review_count
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      ${whereClause}
      ORDER BY d.created_date DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    queryParams.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, queryParams);

    // แปลงข้อมูลให้เหมาะสมสำหรับแผนที่
    const dormitories = result.rows.map(dorm => ({
      id: dorm.dorm_id,
      name: dorm.dorm_name,
      address: dorm.address,
      position: {
        lat: parseFloat(dorm.latitude) || 0,
        lng: parseFloat(dorm.longitude) || 0
      },
      price_range: {
        min: dorm.min_price || 0,
        max: dorm.max_price || 0
      },
      zone: dorm.zone_name,
      image_url: dorm.main_image_url,
      rating: {
        average: parseFloat(dorm.avg_rating) || 0,
        count: parseInt(dorm.review_count) || 0
      }
    }));

    // นับจำนวนทั้งหมด (สำหรับ pagination)
    const countQuery = `
      SELECT COUNT(*) as total
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      ${whereClause}
    `;
    
    const countResult = await pool.query(countQuery, queryParams.slice(0, -2));
    const total = parseInt(countResult.rows[0].total);

    res.json({
      dormitories,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: (parseInt(offset) + parseInt(limit)) < total
      }
    });

  } catch (error) {
    console.error("Error fetching dormitories for map:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

// ดึงข้อมูลหอพักเดี่ยวสำหรับป๊อปอัพในแผนที่
exports.getDormitoryForMapPopup = async (req, res) => {
  try {
    const { dormId } = req.params;

    const query = `
      SELECT 
        d.dorm_id,
        d.dorm_name,
        d.address,
        d.dorm_description,
        d.latitude,
        d.longitude,
        d.min_price,
        d.max_price,
        z.zone_name,
        (
          SELECT image_url 
          FROM dormitory_images 
          WHERE dorm_id = d.dorm_id 
          ORDER BY is_primary DESC, upload_date DESC 
          LIMIT 1
        ) AS main_image_url,
        COALESCE(
          (SELECT AVG(rating) FROM reviews WHERE dorm_id = d.dorm_id), 
          0
        ) AS avg_rating,
        COALESCE(
          (SELECT COUNT(*) FROM reviews WHERE dorm_id = d.dorm_id), 
          0
        ) AS review_count,
        (
          SELECT COUNT(*) 
          FROM users 
          WHERE residence_dorm_id = d.dorm_id
        ) AS current_residents
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      WHERE d.dorm_id = $1 AND d.approval_status = 'อนุมัติ'
    `;

    const result = await pool.query(query, [dormId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
    }

    const dorm = result.rows[0];

    // ดึงรีวิวล่าสุด 3 รายการ
    const reviewsQuery = `
      SELECT 
        r.rating,
        r.comment,
        r.review_date,
        u.display_name
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      WHERE r.dorm_id = $1
      ORDER BY r.review_date DESC
      LIMIT 3
    `;

    const reviewsResult = await pool.query(reviewsQuery, [dormId]);

    const dormitoryData = {
      id: dorm.dorm_id,
      name: dorm.dorm_name,
      address: dorm.address,
      description: dorm.dorm_description,
      position: {
        lat: parseFloat(dorm.latitude) || 0,
        lng: parseFloat(dorm.longitude) || 0
      },
      price_range: {
        min: dorm.min_price || 0,
        max: dorm.max_price || 0
      },
      zone: dorm.zone_name,
      image_url: dorm.main_image_url,
      rating: {
        average: parseFloat(dorm.avg_rating) || 0,
        count: parseInt(dorm.review_count) || 0
      },
      current_residents: parseInt(dorm.current_residents) || 0,
      recent_reviews: reviewsResult.rows.map(review => ({
        rating: review.rating,
        comment: review.comment,
        reviewer: review.display_name,
        date: review.review_date
      }))
    };

    res.json(dormitoryData);

  } catch (error) {
    console.error("Error fetching dormitory for map popup:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};




