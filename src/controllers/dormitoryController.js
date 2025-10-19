// src/controllers/dormitoryController.js
const pool = require("../db");
const { updateDormitoryPriceRange } = require('./editDormitoryController');
const storageService = require("../services/storageService");

// Master data สำหรับ amenity names
const AMENITY_NAMES = {
  1: "แอร์",
  2: "พัดลม", 
  3: "TV",
  4: "ตู้เย็น",
  5: "เตียงนอน",
  6: "WIFI",
  7: "ตู้เสื้อผ้า",
  8: "โต๊ะทำงาน",
  9: "ไมโครเวฟ",
  10: "เครื่องทำน้ำอุ่น",
  11: "ซิงค์ล้างจาน",
  12: "โต๊ะเครื่องแป้ง",
  13: "กล้องวงจรปิด",
  14: "รปภ.",
  15: "ลิฟต์",
  16: "ที่จอดรถ",
  17: "ฟิตเนส",
  18: "Lobby",
  19: "ตู้น้ำหยอดเหรียญ",
  20: "สระว่ายน้ำ",
  21: "ที่วางพัสดุ",
  22: "อนุญาตให้เลี้ยงสัตว์",
  23: "คีย์การ์ด",
  24: "เครื่องซักผ้า"
};

// ฟังก์ชันดึงชื่อ amenity จาก ID
const getAmenityNameById = (amenityId) => {
  return AMENITY_NAMES[amenityId] || 'ไม่ระบุ';
};

// Helper SQL fragment for selectingภาพหลักของหอพัก
const MAIN_IMAGE_SUBQUERY = `(
  SELECT image_url FROM dormitory_images
  WHERE dorm_id = d.dorm_id
  ORDER BY is_primary DESC, upload_date DESC, image_id ASC
  LIMIT 1
) AS main_image_url`;

// ค้นหาชื่อหอพักแบบบางส่วน (สำหรับ autocomplete/instant search)
// GET /api/dormitories/search?q=คำค้น&limit=10
exports.searchDormNames = async (req, res) => {
  try {
    const rawQuery = (req.query.q || "").toString().trim();
    const limitParam = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 50)
      : 10; // default 10, max 50

    if (rawQuery.length === 0) {
      return res.json([]);
    }

    const sql = `
      SELECT dorm_id, dorm_name
      FROM dormitories
      WHERE approval_status = 'อนุมัติ'
        AND dorm_name ILIKE $1
      ORDER BY dorm_name
      LIMIT $2
    `;

    const values = [
      `%${rawQuery}%`,
      limit
    ];

    const result = await pool.query(sql, values);

    // รูปแบบตอบกลับแบบเบา ๆ สำหรับ autocomplete
    const items = result.rows.map(r => ({
      id: r.dorm_id,
      name: r.dorm_name
    }));

    res.json(items);
  } catch (error) {
    console.error('Error searching dorm names:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการค้นหาชื่อหอพัก', error: error.message });
  }
};

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
        ) AS main_image_url,
        (
          SELECT COUNT(*)::int FROM users u WHERE u.residence_dorm_id = d.dorm_id
        ) AS member_count
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
      latitude: dormitory.latitude ? Number(dormitory.latitude) : null,
      longitude: dormitory.longitude ? Number(dormitory.longitude) : null,
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
         SET end_date = NOW(), is_current = false, status = 'ย้ายออก'
         WHERE user_id = $1 AND dorm_id = $2 AND is_current = true`,
        [userId, oldDormId]
      );
    }

    await client.query(
      `INSERT INTO stay_history (user_id, dorm_id, start_date, end_date, is_current, status)
       VALUES ($1, $2, NOW(), NULL, true, 'กำลังอยู่')`,
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
      SELECT 
        d.*, 
        z.zone_name, 
        ${MAIN_IMAGE_SUBQUERY},
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
      SELECT 
        d.*, 
        z.zone_name, 
        ${MAIN_IMAGE_SUBQUERY},
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
      SELECT 
        d.*, 
        z.zone_name, 
        ${MAIN_IMAGE_SUBQUERY},
        COALESCE((SELECT ROUND(AVG(r.rating)::numeric,1) FROM reviews r WHERE r.dorm_id = d.dorm_id), 0) AS avg_rating,
        COALESCE((SELECT COUNT(*) FROM reviews r WHERE r.dorm_id = d.dorm_id), 0) AS review_count
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

// กรองหอพักตามประเภทการเช่า (รายวัน/รายเดือน) จากการมี room_types ที่มีราคาแต่ละแบบ
// GET /api/dormitories/filter/rent-type?daily=true&monthly=true&limit=20&offset=0
exports.filterByRentType = async (req, res) => {
  try {
    const daily = String(req.query.daily || '').toLowerCase() === 'true';
    const monthly = String(req.query.monthly || '').toLowerCase() === 'true';
    const limitParam = parseInt(req.query.limit, 10);
    const offsetParam = parseInt(req.query.offset, 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 50;
    const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;

    // ถ้าไม่ได้ส่ง daily หรือ monthly มาเลย ให้คืนว่างเพื่อป้องกันผลลัพธ์ใหญ่เกินไป
    if (!daily && !monthly) {
      return res.json([]);
    }

    const whereParts = ["d.approval_status = 'อนุมัติ'"];
    const values = [];

    // เงื่อนไขมีห้องแบบรายวัน
    if (daily) {
      whereParts.push(`EXISTS (
        SELECT 1 FROM room_types rt
        WHERE rt.dorm_id = d.dorm_id AND rt.daily_price IS NOT NULL
      )`);
    }

    // เงื่อนไขมีห้องแบบรายเดือน
    if (monthly) {
      whereParts.push(`EXISTS (
        SELECT 1 FROM room_types rt2
        WHERE rt2.dorm_id = d.dorm_id AND rt2.monthly_price IS NOT NULL
      )`);
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const sql = `
      SELECT 
        d.dorm_id,
        d.dorm_name,
        d.address,
        d.min_price,
        d.max_price,
        z.zone_name,
        ${MAIN_IMAGE_SUBQUERY},
        -- flags for frontend if needed
        EXISTS (
          SELECT 1 FROM room_types rtd
          WHERE rtd.dorm_id = d.dorm_id AND rtd.daily_price IS NOT NULL
        ) AS has_daily,
        EXISTS (
          SELECT 1 FROM room_types rtm
          WHERE rtm.dorm_id = d.dorm_id AND rtm.monthly_price IS NOT NULL
        ) AS has_monthly
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      ${whereClause}
      ORDER BY d.dorm_name
      LIMIT ${limit} OFFSET ${offset}
    `;

    const result = await pool.query(sql, values);
    res.json(result.rows);
  } catch (error) {
    console.error('Error filtering dormitories by rent type:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการกรองหอพักตามประเภทการเช่า', error: error.message });
  }
};

// กรองหอพักตามคะแนนดาวรีวิว (เลือกหลายค่า)
// stars: รายการดาวที่เลือก ค่าคะแนนเฉลี่ยปัดใกล้สุด (ROUND) เท่ากับรายการนั้น
//   ตัวอย่าง stars=5,4 จะรวมเฉพาะหอที่ avg ดาวปัดเป็น 5 หรือ 4
// GET /api/dormitories/filter/rating?stars=5,4
exports.filterByRating = async (req, res) => {
  try {
    const starsParam = (req.query.stars || '').toString().trim();
    const limitParam = parseInt(req.query.limit, 10);
    const offsetParam = parseInt(req.query.offset, 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 50;
    const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;

    const whereParts = ["d.approval_status = 'อนุมัติ'"];

    // เงื่อนไขคะแนน
    let havingClause = '';
    let params = [];
    let p = 1;

    if (starsParam) {
      // แปลงรายการดาวเป็นตัวเลขที่ถูกต้องในช่วง 1..5
      const starList = starsParam
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => Number.isFinite(n) && n >= 1 && n <= 5);

      if (starList.length === 0) {
        return res.json([]);
      }

      // ใช้ ROUND(AVG(r.rating)) ให้ใกล้เคียง UX ที่ติ๊กดาวเต็มจำนวน
      const placeholders = starList.map(() => `$${p++}`).join(',');
      params = params.concat(starList);
      havingClause = `HAVING ROUND(AVG(r.rating)) IN (${placeholders})`;
    } else {
      // หากไม่ส่ง stars ให้คืนว่าง
      return res.json([]);
    }

    const sql = `
      SELECT 
        d.dorm_id,
        d.dorm_name,
        d.address,
        z.zone_name,
        ${MAIN_IMAGE_SUBQUERY},
        ROUND(COALESCE(AVG(r.rating), 0)::numeric, 1) AS avg_rating,
        COUNT(r.review_id) AS review_count
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      LEFT JOIN reviews r ON r.dorm_id = d.dorm_id
      WHERE ${whereParts.join(' AND ')}
      GROUP BY d.dorm_id, z.zone_name
      ${havingClause}
      ORDER BY avg_rating DESC, review_count DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error filtering dormitories by rating:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการกรองหอพักตามคะแนนดาว', error: error.message });
  }
};

// กรองหอพักตามช่วงราคา (ใช้ช่วงราคา min_price/max_price ของตาราง dormitories)
// เงื่อนไขซ้อนช่วง (overlap): d.max_price >= min AND d.min_price <= max
// รองรับกรณีส่งมาแค่ min หรือ max อย่างใดอย่างหนึ่ง
// GET /api/dormitories/filter/price?min=2000&max=5000
exports.filterByPriceRange = async (req, res) => {
  try {
    const minParam = req.query.min !== undefined ? parseInt(req.query.min, 10) : undefined;
    const maxParam = req.query.max !== undefined ? parseInt(req.query.max, 10) : undefined;
    const limitParam = parseInt(req.query.limit, 10);
    const offsetParam = parseInt(req.query.offset, 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 50;
    const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;

    const whereParts = ["d.approval_status = 'อนุมัติ'"];

    if (Number.isFinite(minParam)) {
      // มีช่วงบนของหอ (max_price) ต้องไม่น้อยกว่าขอบล่างที่ผู้ใช้กำหนด
      whereParts.push(`COALESCE(d.max_price, 2147483647) >= ${minParam}`);
    }

    if (Number.isFinite(maxParam)) {
      // มีช่วงล่างของหอ (min_price) ต้องไม่มากกว่าขอบบนที่ผู้ใช้กำหนด
      whereParts.push(`COALESCE(d.min_price, 0) <= ${maxParam}`);
    }

    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const sql = `
      SELECT 
        d.dorm_id,
        d.dorm_name,
        d.address,
        d.min_price,
        d.max_price,
        z.zone_name,
        ${MAIN_IMAGE_SUBQUERY},
        COALESCE((SELECT ROUND(AVG(r.rating)::numeric,1) FROM reviews r WHERE r.dorm_id = d.dorm_id), 0) AS avg_rating,
        COALESCE((SELECT COUNT(*) FROM reviews r WHERE r.dorm_id = d.dorm_id), 0) AS review_count
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      ${whereClause}
      ORDER BY COALESCE(d.min_price, 2147483647) ASC, d.dorm_name
      LIMIT ${limit} OFFSET ${offset}
    `;

    const result = await pool.query(sql);
    res.json(result.rows);
  } catch (error) {
    console.error('Error filtering dormitories by price range:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการกรองตามช่วงราคา', error: error.message });
  }
};

// กรองหอพักตามสิ่งอำนวยความสะดวก
// GET /api/dormitories/filter/amenities?ids=1,6,13&match=all&location=ภายใน&onlyAvailable=true&limit=20&offset=0
exports.filterByAmenities = async (req, res) => {
  try {
    const idsParam = (req.query.ids || '').toString();
    const ids = idsParam
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n));

    const match = (req.query.match || 'any').toString().toLowerCase(); // 'any' | 'all'
    const location = (req.query.location || 'any').toString(); // 'ภายใน' | 'ภายนอก' | 'common' | 'any'
    const onlyAvailable = String(req.query.onlyAvailable || 'true').toLowerCase() === 'true';
    const limitParam = parseInt(req.query.limit, 10);
    const offsetParam = parseInt(req.query.offset, 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 50;
    const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;

    if (ids.length === 0) {
      return res.json([]);
    }

    // สร้างเงื่อนไขสำหรับตาราง dormitory_amenities (กำหนดลำดับพารามิเตอร์แบบไดนามิก)
    const conds = ['da.dorm_id = d.dorm_id'];
    const values = [];
    let p = 1;
    conds.push(`da.amenity_id = ANY($${p++}::int[])`);
    values.push(ids);

    if (onlyAvailable) {
      conds.push('da.is_available = true');
    }
    if (location !== 'any') {
      conds.push(`da.location_type = $${p++}`);
      values.push(location);
    }

    // HAVING สำหรับ any/all พร้อมกำหนดพารามิเตอร์ตามลำดับ
    let having = 'HAVING COUNT(DISTINCT da.amenity_id) >= 1';
    if (match === 'all') {
      having = `HAVING COUNT(DISTINCT da.amenity_id) = $${p++}`;
      values.push(ids.length);
    }

    const whereApproval = "d.approval_status = 'อนุมัติ'";

    const sql = `
      SELECT 
        d.dorm_id,
        d.dorm_name,
        d.address,
        z.zone_name,
        ${MAIN_IMAGE_SUBQUERY},
        COALESCE((SELECT ROUND(AVG(r.rating)::numeric,1) FROM reviews r WHERE r.dorm_id = d.dorm_id), 0) AS avg_rating,
        COALESCE((SELECT COUNT(*) FROM reviews r WHERE r.dorm_id = d.dorm_id), 0) AS review_count,
        ARRAY_AGG(DISTINCT da.amenity_id) AS matched_amenity_ids,
        COUNT(DISTINCT da.amenity_id) AS matched_count
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      JOIN dormitory_amenities da ON ${conds.join(' AND ')}
      WHERE ${whereApproval}
      GROUP BY d.dorm_id, z.zone_name
      ${having}
      ORDER BY matched_count DESC, d.dorm_name
      LIMIT ${limit} OFFSET ${offset}
    `;

    const result = await pool.query(sql, values);
    res.json(result.rows);
  } catch (error) {
    console.error('Error filtering dormitories by amenities:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการกรองตามสิ่งอำนวยความสะดวก', error: error.message });
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

    const name = (req.body.name ?? req.body.room_name ?? '').toString().trim();
    // << สำคัญ: รองรับ bedType จากหน้าบ้าน >>
    const bed_type = req.body.bed_type ?? req.body.bedType ?? null;
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
    const daily_price = toNumberOrNull(req.body.daily_price);
    const summer_price = toNumberOrNull(req.body.summer_price);
    const term_price = toNumberOrNull(req.body.term_price);

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

      const bed_type = it.bed_type ?? it.bedType ?? null; // << รองรับ bedType >>
      // removed price_type

      const monthly_price = toNumberOrNull(it.monthly_price);
      const daily_price = toNumberOrNull(it.daily_price);
      const summer_price = toNumberOrNull(it.summer_price);
      const term_price = toNumberOrNull(it.term_price);

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
    const { amenities } = req.body;

    if (!Array.isArray(amenities) || amenities.length === 0) {
      return res.status(400).json({ message: 'ต้องระบุสิ่งอำนวยความสะดวกอย่างน้อย 1 รายการ' });
    }

    await client.query('BEGIN');

    // ลบสิ่งอำนวยความสะดวกเดิมทั้งหมด
    await client.query('DELETE FROM dormitory_amenities WHERE dorm_id = $1', [dormId]);

    // เพิ่มสิ่งอำนวยความสะดวกใหม่
    const insertPromises = amenities.map(amenity => {
      const amenityId = amenity.amenity_id || amenity.id;
      const locationType = amenity.location_type || 'ภายใน';
      
      // ดึงชื่อ amenity จาก master data
      const amenityName = getAmenityNameById(amenityId);

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
        da.is_available
      FROM dormitory_amenities da
      WHERE da.dorm_id = $1
      ORDER BY da.location_type, COALESCE(da.amenity_name, 'ไม่ระบุ')
    `;

    const result = await pool.query(query, [dormId]);

    // จัดกลุ่มตาม location_type
    const groupedAmenities = {
      'ภายใน': [],
      'ภายนอก': [],
      'common': []
    };

    result.rows.forEach(row => {
      // ใช้ location_type ตรงๆ จากฐานข้อมูล (ภาษาไทย)
      let locationType = 'ภายใน'; // default เป็นภาษาไทย
      if (row.location_type === 'ภายใน') {
        locationType = 'ภายใน';
      } else if (row.location_type === 'ภายนอก') {
        locationType = 'ภายนอก';
      } else if (row.location_type === 'common') {
        locationType = 'common';
      }
      
      if (groupedAmenities[locationType]) {
        groupedAmenities[locationType].push({
          dorm_amenity_id: row.dorm_amenity_id,
          amenity_id: row.amenity_id,
          location_type: row.location_type, // ส่งกลับเป็นภาษาไทย
          amenity_name: row.amenity_name || 'ไม่ระบุ',
          is_available: row.is_available
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
//     { amenity_id: 1, is_available: true, location_type: 'ภายใน', amenity_name: null },
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

      // หาคำขอที่ต้องการอนุมัติ (ล่าสุด)
      const requestResult = await client.query(
        `SELECT request_id FROM member_requests 
         WHERE dorm_id = $1 AND user_id = $2 AND status = 'รออนุมัติ'
         ORDER BY request_date DESC LIMIT 1`,
        [dormId, userId]
      );

      if (requestResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: "ไม่พบคำขอที่รออนุมัติ" });
      }

      const requestId = requestResult.rows[0].request_id;

      // ยกเลิกคำขอรออนุมัติอื่นๆ ของผู้ใช้คนนี้ในหอนี้ (ยกเว้นคำขอที่เลือก)
      await client.query(
        "UPDATE member_requests SET status = 'ยกเลิก' WHERE dorm_id = $1 AND user_id = $2 AND status = 'รออนุมัติ' AND request_id != $3",
        [dormId, userId, requestId]
      );

      // อนุมัติคำขอที่เลือก
      await client.query(
        "UPDATE member_requests SET status = 'อนุมัติ', approved_date = NOW() WHERE request_id = $1",
        [requestId]
      );

      await client.query(
        "UPDATE users SET residence_dorm_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [dormId, userId]
      );

      // ปิด stay ปัจจุบัน (ถ้ามี)
      await client.query(
        `UPDATE stay_history
         SET end_date = NOW(), is_current = false, status = 'ย้ายออก'
         WHERE user_id = $1 AND is_current = true`,
        [userId]
      );

      // เปิด stay ใหม่สำหรับหอนี้
      await client.query(
        `INSERT INTO stay_history (user_id, dorm_id, start_date, end_date, is_current, status)
         VALUES ($1, $2, NOW(), NULL, true, 'กำลังอยู่')`,
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

    // ใช้ transaction เพื่อความปลอดภัย
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // อัพเดตสถานะคำขอเป็น 'ปฏิเสธ' พร้อม response_note
      await client.query(
        "UPDATE member_requests SET status = 'ปฏิเสธ', response_note = $1 WHERE dorm_id = $2 AND user_id = $3",
        [response_note || null, dormId, userId]
      );

      // ตรวจสอบว่าผู้ใช้มีหอพักปัจจุบันหรือไม่
      const userResult = await client.query(
        "SELECT residence_dorm_id FROM users WHERE id = $1",
        [userId]
      );

      const currentDormId = userResult.rows[0]?.residence_dorm_id;

      // ถ้าผู้ใช้ไม่มีหอพักปัจจุบัน (residence_dorm_id = NULL)
      // ตรวจสอบว่าเป็นการย้ายหอหรือสมัครใหม่
      if (!currentDormId) {
        // หาคำขอที่ถูกยกเลิกล่าสุด (อาจเป็นการย้ายหอ)
        const lastCanceledResult = await client.query(
          `SELECT dorm_id FROM member_requests 
           WHERE user_id = $1 AND status = 'ยกเลิก' 
           ORDER BY request_date DESC LIMIT 1`,
          [userId]
        );

        // หาคำขอที่อนุมัติล่าสุด (หอเก่าที่ยังไม่ถูกยกเลิก)
        const lastApprovedResult = await client.query(
          `SELECT dorm_id FROM member_requests 
           WHERE user_id = $1 AND status = 'อนุมัติ' 
           ORDER BY approved_date DESC LIMIT 1`,
          [userId]
        );

        // ถ้ามีคำขอที่ถูกยกเลิกล่าสุด และมีคำขอที่อนุมัติ
        // และคำขอที่ยกเลิกใหม่กว่าคำขอที่อนุมัติ = การย้ายหอ
        if (lastCanceledResult.rows.length > 0 && lastApprovedResult.rows.length > 0) {
          const lastCanceledDate = lastCanceledResult.rows[0].request_date;
          const lastApprovedDate = lastApprovedResult.rows[0].approved_date;

          // ถ้าคำขอที่ยกเลิกใหม่กว่าคำขอที่อนุมัติ = การย้ายหอ
          // ไม่ต้องกลับไปหอเก่า เพราะเขาเลือกย้ายออกไปแล้ว
          if (lastCanceledDate > lastApprovedDate) {
            // ไม่ทำอะไร - ให้ residence_dorm_id = NULL (ไม่มีหอพัก)
          } else {
            // คำขอที่อนุมัติใหม่กว่า = สมัครใหม่
            // กลับไปหอพักเก่าที่เคยอนุมัติแล้ว
            const lastApprovedDormId = lastApprovedResult.rows[0].dorm_id;

            await client.query(
              "UPDATE users SET residence_dorm_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
              [lastApprovedDormId, userId]
            );

            await client.query(
              `INSERT INTO stay_history (user_id, dorm_id, start_date, end_date, is_current, status)
               VALUES ($1, $2, NOW(), NULL, true, 'กำลังอยู่')`,
              [userId, lastApprovedDormId]
            );
          }
        } else if (lastApprovedResult.rows.length > 0) {
          // ไม่มีคำขอที่ยกเลิก = สมัครใหม่
          // กลับไปหอพักเก่าที่เคยอนุมัติแล้ว
          const lastApprovedDormId = lastApprovedResult.rows[0].dorm_id;

          await client.query(
            "UPDATE users SET residence_dorm_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
            [lastApprovedDormId, userId]
          );

          await client.query(
            `INSERT INTO stay_history (user_id, dorm_id, start_date, end_date, is_current, status)
             VALUES ($1, $2, NOW(), NULL, true, 'กำลังอยู่')`,
            [userId, lastApprovedDormId]
          );
        }
        // ถ้าไม่พบหอพักเก่าที่เคยอนุมัติ (สมาชิกใหม่)
        // ให้ปล่อยให้ residence_dorm_id = NULL (ไม่มีหอพัก)
      }

      await client.query('COMMIT');
      client.release();
    } catch (e) {
      await client.query('ROLLBACK');
      client.release();
      throw e;
    }

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

    // ใช้ transaction เพื่อความปลอดภัย
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // อัพเดต residence_dorm_id ของผู้ใช้เป็น null
      await client.query(
        "UPDATE users SET residence_dorm_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND residence_dorm_id = $2",
        [userId, dormId]
      );

      // ปิด stay ปัจจุบัน
      await client.query(
        `UPDATE stay_history
         SET end_date = NOW(), is_current = false, status = 'ยกเลิก'
         WHERE user_id = $1 AND dorm_id = $2 AND is_current = true`,
        [userId, dormId]
      );

      // อัพเดตสถานะคำขอเป็น 'ยกเลิก' (ไม่ใช่ 'รออนุมัติ' เพื่อไม่ให้ชน constraint)
      await client.query(
        "UPDATE member_requests SET status = 'ยกเลิก' WHERE dorm_id = $1 AND user_id = $2 AND status = 'อนุมัติ'",
        [dormId, userId]
      );

      await client.query('COMMIT');
      client.release();
    } catch (e) {
      await client.query('ROLLBACK');
      client.release();
      throw e;
    }

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

    // ป้องกันข้อมูลซ้ำโดยใช้ Map แต่เก็บประวัติทั้งหมด
    const tenantMap = new Map();

    allRequestsResult.rows.forEach(tenant => {
      // ใช้ request_id เป็น key เพื่อเก็บประวัติทั้งหมด
      const key = `${tenant.id}-${tenant.residence_dorm_id}-${tenant.request_date}`;
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
        status: tenant.request_status || 'ไม่ทราบสถานะ',
        response_note: tenant.response_note || null,
        time_ago: getTimeAgo(tenant.request_date)
      });
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






// ===== COMPARISON ENDPOINT =====

// เปรียบเทียบหอพักหลายแห่งพร้อมกัน
exports.compareDormitories = async (req, res) => {
  try {
    const { ids } = req.query;

    if (!ids) {
      return res.status(400).json({ message: 'ต้องระบุ dormitory IDs (ตัวอย่าง: ?ids=1,2,3)' });
    }

    const dormIds = ids.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

    if (dormIds.length === 0) {
      return res.status(400).json({ message: 'ไม่พบ dormitory ID ที่ถูกต้อง' });
    }

    if (dormIds.length > 5) {
      return res.status(400).json({ message: 'สามารถเปรียบเทียบได้สูงสุด 5 หอพักเท่านั้น' });
    }

    // ดึงข้อมูลหลักของหอพัก
    const query = `
      SELECT 
        d.dorm_id,
        d.dorm_name,
        d.address,
        d.dorm_description,
        d.min_price,
        d.max_price,
        d.latitude,
        d.longitude,
        d.electricity_type,
        d.electricity_rate,
        d.water_type,
        d.water_rate,
        z.zone_name,
        z.zone_id,
        -- รูปภาพหลัก
        (
          SELECT image_url 
          FROM dormitory_images 
          WHERE dorm_id = d.dorm_id 
          ORDER BY is_primary DESC, upload_date DESC 
          LIMIT 1
        ) AS main_image_url,
        -- คะแนนรีวิว
        COALESCE(ROUND(AVG(r.rating)::numeric, 1), 0) AS avg_rating,
        COUNT(DISTINCT r.review_id) AS review_count,
        -- จำนวนผู้พัก
        (SELECT COUNT(*) FROM users WHERE residence_dorm_id = d.dorm_id) AS resident_count
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      LEFT JOIN reviews r ON r.dorm_id = d.dorm_id
      WHERE d.dorm_id = ANY($1) AND d.approval_status = 'อนุมัติ'
      GROUP BY d.dorm_id, z.zone_name, z.zone_id
      ORDER BY array_position($1, d.dorm_id)
    `;

    const result = await pool.query(query, [dormIds]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบหอพักที่ระบุ หรือหอพักยังไม่ได้รับการอนุมัติ' });
    }

    // ดึงข้อมูล room types
    const roomTypesQuery = `
      SELECT 
        dorm_id,
        room_type_id,
        room_name,
        bed_type,
        monthly_price,
        daily_price,
        summer_price,
        term_price
      FROM room_types
      WHERE dorm_id = ANY($1)
      ORDER BY dorm_id, COALESCE(monthly_price, 999999)
    `;
    const roomTypesResult = await pool.query(roomTypesQuery, [dormIds]);

    // ดึงข้อมูล amenities
    const amenitiesQuery = `
      SELECT 
        da.dorm_id,
        da.amenity_id,
        da.amenity_name,
        da.location_type
      FROM dormitory_amenities da
      WHERE da.dorm_id = ANY($1) AND da.is_available = true
      ORDER BY da.dorm_id, da.location_type
    `;
    const amenitiesResult = await pool.query(amenitiesQuery, [dormIds]);

    // จัดกลุ่มข้อมูล
    const dormitories = result.rows.map(dorm => {
      const roomTypes = roomTypesResult.rows.filter(rt => rt.dorm_id === dorm.dorm_id);
      const amenities = amenitiesResult.rows
        .filter(a => a.dorm_id === dorm.dorm_id)
        .map(a => ({
          id: a.amenity_id,
          name: a.amenity_name || 'ไม่ระบุ',
          location: a.location_type
        }));

      return {
        id: dorm.dorm_id,
        name: dorm.dorm_name,
        address: dorm.address,
        description: dorm.dorm_description,
        zone: {
          id: dorm.zone_id,
          name: dorm.zone_name
        },
        price_range: {
          min: dorm.min_price || 0,
          max: dorm.max_price || 0
        },
        utilities: {
          electricity: {
            type: dorm.electricity_type || 'คิดตามหน่วย',
            rate: dorm.electricity_rate || 0
          },
          water: {
            type: dorm.water_type || 'คิดตามหน่วย',
            rate: dorm.water_rate || 0
          }
        },
        location: {
          lat: parseFloat(dorm.latitude) || 0,
          lng: parseFloat(dorm.longitude) || 0
        },
        image_url: dorm.main_image_url,
        rating: {
          average: parseFloat(dorm.avg_rating) || 0,
          count: parseInt(dorm.review_count) || 0
        },
        resident_count: parseInt(dorm.resident_count) || 0,
        room_types: roomTypes,
        amenities: amenities
      };
    });

    res.json({
      success: true,
      count: dormitories.length,
      dormitories,
      comparison_date: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error comparing dormitories:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการเปรียบเทียบหอพัก',
      error: error.message
    });
  }
};


// เปรียบเทียบหอพักหลายแห่ง (สูงสุด 5 หอพัก)
exports.compareDormitories = async (req, res) => {
  try {
    const { ids } = req.query;

    // ตรวจสอบว่ามี query parameter ids หรือไม่
    if (!ids) {
      return res.status(400).json({ 
        message: "ต้องระบุ dormitory IDs (ตัวอย่าง: ?ids=1,2,3)" 
      });
    }

    // แปลง string เป็น array ของ integers
    const dormIds = ids.split(',')
      .map(id => parseInt(id.trim(), 10))
      .filter(id => !isNaN(id) && id > 0);

    // ตรวจสอบว่ามี ID ที่ถูกต้องหรือไม่
    if (dormIds.length === 0) {
      return res.status(400).json({ 
        message: "ไม่พบ dormitory ID ที่ถูกต้อง" 
      });
    }

    // จำกัดไม่เกิน 5 หอพัก
    if (dormIds.length > 5) {
      return res.status(400).json({ 
        message: "สามารถเปรียบเทียบได้สูงสุด 5 หอพักเท่านั้น" 
      });
    }

    // ดึงข้อมูลหอพักพื้นฐาน
    const dormQuery = `
      SELECT 
        d.dorm_id as id,
        d.dorm_name as name,
        d.address,
        d.dorm_description as description,
        d.latitude as lat,
        d.longitude as lng,
        d.min_price,
        d.max_price,
        d.electricity_rate,
        d.electricity_type,
        d.water_rate,
        d.water_type,
        z.zone_id,
        z.zone_name,
        (
          SELECT image_url FROM dormitory_images 
          WHERE dorm_id = d.dorm_id 
          ORDER BY is_primary DESC, upload_date DESC, image_id ASC 
          LIMIT 1
        ) AS image_url,
        (
          SELECT COUNT(*)::int FROM users u WHERE u.residence_dorm_id = d.dorm_id
        ) AS resident_count
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      WHERE d.dorm_id = ANY($1::int[]) AND d.approval_status = 'อนุมัติ'
    `;

    const dormResult = await pool.query(dormQuery, [dormIds]);

    if (dormResult.rows.length === 0) {
      return res.status(404).json({ 
        message: "ไม่พบหอพักที่ระบุ หรือหอพักยังไม่ได้รับการอนุมัติ" 
      });
    }

    // ดึงข้อมูลคะแนนรีวิว
    const ratingQuery = `
      SELECT 
        dorm_id,
        COUNT(*) as review_count,
        ROUND(AVG(rating)::numeric, 1) as average_rating
      FROM reviews
      WHERE dorm_id = ANY($1::int[])
      GROUP BY dorm_id
    `;
    const ratingResult = await pool.query(ratingQuery, [dormIds]);
    const ratingMap = {};
    ratingResult.rows.forEach(row => {
      ratingMap[row.dorm_id] = {
        average: parseFloat(row.average_rating) || 0,
        count: parseInt(row.review_count, 10) || 0
      };
    });

    // ดึงข้อมูลประเภทห้อง
    const roomTypesQuery = `
      SELECT 
        room_type_id,
        dorm_id,
        room_name,
        bed_type,
        monthly_price,
        daily_price,
        summer_price,
        term_price
      FROM room_types
      WHERE dorm_id = ANY($1::int[])
      ORDER BY dorm_id, COALESCE(monthly_price, 2147483647), room_type_id
    `;
    const roomTypesResult = await pool.query(roomTypesQuery, [dormIds]);
    const roomTypesMap = {};
    roomTypesResult.rows.forEach(row => {
      if (!roomTypesMap[row.dorm_id]) {
        roomTypesMap[row.dorm_id] = [];
      }
      roomTypesMap[row.dorm_id].push(row);
    });

    // ดึงข้อมูลสิ่งอำนวยความสะดวก (ใช้เฉพาะ dormitory_amenities)
    const amenitiesQuery = `
      SELECT 
        da.dorm_id,
        da.amenity_id as id,
        COALESCE(da.amenity_name, 'ไม่ระบุ') as name,
        da.location_type as location
      FROM dormitory_amenities da
      WHERE da.dorm_id = ANY($1::int[]) AND da.is_available = true
      ORDER BY da.dorm_id, da.location_type, COALESCE(da.amenity_name, 'ไม่ระบุ')
    `;
    const amenitiesResult = await pool.query(amenitiesQuery, [dormIds]);
    const amenitiesMap = {};
    amenitiesResult.rows.forEach(row => {
      if (!amenitiesMap[row.dorm_id]) {
        amenitiesMap[row.dorm_id] = [];
      }
      amenitiesMap[row.dorm_id].push({
        id: row.id,
        name: row.name,
        location: row.location
      });
    });

    // รวมข้อมูลทั้งหมด
    const dormitories = dormResult.rows.map(dorm => ({
      id: dorm.id,
      name: dorm.name,
      address: dorm.address,
      description: dorm.description,
      zone: {
        id: dorm.zone_id,
        name: dorm.zone_name
      },
      price_range: {
        min: dorm.min_price || 0,
        max: dorm.max_price || 0
      },
      utilities: {
        electricity: {
          type: dorm.electricity_type || 'ไม่ระบุ',
          rate: dorm.electricity_rate || 0
        },
        water: {
          type: dorm.water_type || 'ไม่ระบุ',
          rate: dorm.water_rate || 0
        }
      },
      location: {
        lat: dorm.lat,
        lng: dorm.lng
      },
      image_url: dorm.image_url,
      rating: ratingMap[dorm.id] || { average: 0, count: 0 },
      resident_count: dorm.resident_count || 0,
      room_types: roomTypesMap[dorm.id] || [],
      amenities: amenitiesMap[dorm.id] || []
    }));

    res.json({
      success: true,
      count: dormitories.length,
      dormitories,
      comparison_date: new Date().toISOString()
    });

  } catch (error) {
    console.error("Error comparing dormitories:", error);
    res.status(500).json({ 
      success: false,
      message: "เกิดข้อผิดพลาดในการเปรียบเทียบหอพัก", 
      error: error.message 
    });
  }
};
