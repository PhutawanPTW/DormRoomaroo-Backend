// src/controllers/dormitoryController.js
const pool = require("../db");
const { updateDormitoryPriceRange } = require('./editDormitoryController');
const storageService = require("../services/storageService");

// ฟังก์ชันดึงชื่อ amenity จาก ID (จากฐานข้อมูล)
const getAmenityNameById = async (amenityId) => {
  try {
    const result = await pool.query(
      'SELECT amenity_name FROM amenities WHERE amenity_id = $1',
      [amenityId]
    );
    return result.rows[0]?.amenity_name || 'ไม่ระบุ';
  } catch (error) {
    console.error('Error fetching amenity name:', error);
    return 'ไม่ระบุ';
  }
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

// ดึงหอพักแนะนำ (เรียงตามคะแนนรีวิวและราคา)
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
        ) AS review_count,
        -- คำนวณ recommendation score
        (
          COALESCE((SELECT AVG(rating) FROM reviews WHERE dorm_id = d.dorm_id), 0) * 0.5 +
          COALESCE((SELECT COUNT(*) FROM reviews WHERE dorm_id = d.dorm_id), 0) * 0.1 +
          CASE 
            WHEN d.min_price IS NOT NULL AND d.min_price > 0 
            THEN GREATEST(0, (10000 - d.min_price) / 1000) * 0.2
            ELSE 0 
          END +
          -- เพิ่มคะแนนจากจำนวนผู้พัก (ความนิยม)
          COALESCE((SELECT COUNT(*) FROM users WHERE residence_dorm_id = d.dorm_id), 0) * 0.1 +
          -- เพิ่มคะแนนจากจำนวนสิ่งอำนวยความสะดวก
          COALESCE((SELECT COUNT(*) FROM dormitory_amenities WHERE dorm_id = d.dorm_id AND is_available = true), 0) * 0.05 +
          -- เพิ่มคะแนนจากจำนวนรูปภาพ (ความสมบูรณ์ของข้อมูล)
          COALESCE((SELECT COUNT(*) FROM dormitory_images WHERE dorm_id = d.dorm_id), 0) * 0.05
        ) AS recommendation_score,
        -- ข้อมูลเพิ่มเติมสำหรับ tie-breaking
        (SELECT COUNT(*) FROM users WHERE residence_dorm_id = d.dorm_id) AS current_residents,
        (SELECT COUNT(*) FROM dormitory_amenities WHERE dorm_id = d.dorm_id AND is_available = true) AS amenities_count,
        (SELECT COUNT(*) FROM dormitory_images WHERE dorm_id = d.dorm_id) AS images_count
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      WHERE d.approval_status = 'อนุมัติ'
      ORDER BY 
        recommendation_score DESC,
        avg_rating DESC,
        review_count DESC,
        current_residents DESC,
        amenities_count DESC,
        images_count DESC,
        d.created_date DESC`;
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

// กรองหอพักตามคะแนนดาวแบบ Shopee (X ดาวขึ้นไป)
exports.filterByRating = async (req, res) => {
  try {
    const { 
      minRating = 1, 
      zoneIds, 
      minPrice, 
      maxPrice, 
      limit = 20, 
      offset = 0 
    } = req.query;

    // ตรวจสอบ minRating ต้องเป็น 1-5
    const rating = Math.max(1, Math.min(5, parseInt(minRating, 10)));
    
    let whereConditions = ["d.approval_status = 'อนุมัติ'"];
    let params = [];
    let paramIndex = 1;

    // กรองตามโซน
    if (zoneIds) {
      const zoneList = zoneIds.split(',').map(id => parseInt(id.trim(), 10)).filter(n => Number.isFinite(n));
      if (zoneList.length > 0) {
        const placeholders = zoneList.map(() => `$${paramIndex++}`).join(',');
        whereConditions.push(`d.zone_id IN (${placeholders})`);
        params = params.concat(zoneList);
      }
    }

    // กรองตามช่วงราคา
    if (minPrice !== undefined) {
      whereConditions.push(`COALESCE(d.max_price, 2147483647) >= $${paramIndex++}`);
      params.push(parseInt(minPrice, 10));
    }
    if (maxPrice !== undefined) {
      whereConditions.push(`COALESCE(d.min_price, 0) <= $${paramIndex++}`);
      params.push(parseInt(maxPrice, 10));
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Query หลัก
    const query = `
      SELECT 
        d.dorm_id,
        d.dorm_name,
        d.address,
        d.min_price,
        d.max_price,
        z.zone_name,
        ${MAIN_IMAGE_SUBQUERY},
        COALESCE(AVG(r.rating), 0) AS avg_rating,
        COUNT(DISTINCT r.review_id) AS review_count,
        (SELECT COUNT(*) FROM users WHERE residence_dorm_id = d.dorm_id) AS current_residents
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      LEFT JOIN reviews r ON d.dorm_id = r.dorm_id
      ${whereClause}
      GROUP BY d.dorm_id, z.zone_name
      HAVING AVG(r.rating) >= $${paramIndex++}
      ORDER BY 
        avg_rating DESC,
        review_count DESC,
        current_residents DESC,
        d.created_date DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    params.push(rating, parseInt(limit, 10), parseInt(offset, 10));

    const result = await pool.query(query, params);

    // นับจำนวนทั้งหมด (สำหรับ pagination)
    const countQuery = `
      SELECT COUNT(*) as total
      FROM (
        SELECT d.dorm_id
        FROM dormitories d
        LEFT JOIN reviews r ON d.dorm_id = r.dorm_id
        ${whereClause}
        GROUP BY d.dorm_id
        HAVING AVG(r.rating) >= $${paramIndex}
      ) filtered_dorms
    `;
    
    const countParams = params.slice(0, -2); // ลบ limit และ offset
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total, 10);

    res.json({
      dormitories: result.rows,
      pagination: {
        total,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        has_more: (parseInt(offset, 10) + parseInt(limit, 10)) < total
      },
      filter: {
        min_rating: rating,
        description: `${rating} ดาวขึ้นไป`
      }
    });

  } catch (error) {
    console.error("Error filtering dormitories by rating:", error);
    res.status(500).json({ 
      message: "เกิดข้อผิดพลาดในการกรองหอพักตามคะแนน", 
      error: error.message 
    });
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
// Advanced Filter - กรองหลายเงื่อนไขพร้อมกัน (รองรับทั้งเดี่ยวและรวม)
exports.advancedFilter = async (req, res) => {
  try {
    const {
      // เงื่อนไขพื้นฐาน
      zoneIds,
      minPrice,
      maxPrice,
      
      // เงื่อนไขการเช่า
      daily,
      monthly,
      
      // เงื่อนไขคะแนนดาว
      stars,
      
      // เงื่อนไขสิ่งอำนวยความสะดวก
      amenityIds,
      amenityMatch = 'any', // 'any' หรือ 'all'
      location, // 'ภายใน' | 'ภายนอก' | 'common' | 'any'
      onlyAvailable = 'true', // 'true' หรือ 'false'
      
      // เงื่อนไขประเภทห้อง
      bedType,
      roomName,
      
      // เงื่อนไขสถานะ
      status,
      
      // Pagination
      limit = 20,
      offset = 0
    } = req.query;

    let whereConditions = ["d.approval_status = 'อนุมัติ'"];
    let params = [];
    let paramIndex = 1;

    // กรองตามโซน
    if (zoneIds) {
      const zoneList = zoneIds.split(',').map(id => parseInt(id.trim(), 10)).filter(n => Number.isFinite(n));
      if (zoneList.length > 0) {
        const placeholders = zoneList.map(() => `$${paramIndex++}`).join(',');
        whereConditions.push(`d.zone_id IN (${placeholders})`);
        params = params.concat(zoneList);
      }
    }

    // กรองตามช่วงราคา
    if (minPrice !== undefined) {
      whereConditions.push(`COALESCE(d.max_price, 2147483647) >= $${paramIndex++}`);
      params.push(parseInt(minPrice, 10));
    }
    if (maxPrice !== undefined) {
      whereConditions.push(`COALESCE(d.min_price, 0) <= $${paramIndex++}`);
      params.push(parseInt(maxPrice, 10));
    }

    // กรองตามประเภทการเช่า
    let rentTypeConditions = [];
    if (daily === 'true') {
      rentTypeConditions.push(`EXISTS(SELECT 1 FROM room_types rt WHERE rt.dorm_id = d.dorm_id AND rt.daily_price IS NOT NULL)`);
    }
    if (monthly === 'true') {
      rentTypeConditions.push(`EXISTS(SELECT 1 FROM room_types rt WHERE rt.dorm_id = d.dorm_id AND rt.monthly_price IS NOT NULL)`);
    }
    if (rentTypeConditions.length > 0) {
      whereConditions.push(`(${rentTypeConditions.join(' OR ')})`);
    }

    // กรองตามประเภทเตียง
    if (bedType) {
      whereConditions.push(`EXISTS(SELECT 1 FROM room_types rt WHERE rt.dorm_id = d.dorm_id AND rt.bed_type = $${paramIndex++})`);
      params.push(bedType);
    }

    // กรองตามชื่อประเภทห้อง
    if (roomName) {
      whereConditions.push(`EXISTS(SELECT 1 FROM room_types rt WHERE rt.dorm_id = d.dorm_id AND rt.room_name ILIKE $${paramIndex++})`);
      params.push(`%${roomName}%`);
    }

    // กรองตามสถานะหอพัก
    if (status) {
      whereConditions.push(`d.status_dorm = $${paramIndex++}`);
      params.push(status);
    }

    // สร้าง WHERE clause
    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // สร้าง HAVING clause สำหรับคะแนนดาวและสิ่งอำนวยความสะดวก
    let havingConditions = [];

    // กรองตามคะแนนดาว (รองรับแบบ Shopee: "X ดาวขึ้นไป")
    if (stars) {
      const starList = stars.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n >= 1 && n <= 5);
      if (starList.length > 0) {
        // สร้างเงื่อนไข "X ดาวขึ้นไป" (minimum rating)
        let starConditions = [];
        starList.forEach(star => {
          // เงื่อนไข: คะแนนเฉลี่ย >= X ดาว
          starConditions.push(`AVG(r.rating) >= ${star}.0`);
        });
        havingConditions.push(`(${starConditions.join(' OR ')})`);
      }
    }


    // สร้างเงื่อนไขสำหรับสิ่งอำนวยความสะดวก
    let amenityJoinCondition = "LEFT JOIN dormitory_amenities da ON d.dorm_id = da.dorm_id";
    let amenityHavingCondition = "";
    
    if (amenityIds) {
      const amenityList = amenityIds.split(',').map(id => parseInt(id.trim(), 10)).filter(n => Number.isFinite(n));
      if (amenityList.length > 0) {
        let amenityConds = [`da.amenity_id = ANY($${paramIndex++}::int[])`];
        params.push(amenityList);
        
        if (onlyAvailable === 'true') {
          amenityConds.push('da.is_available = true');
        }
        if (location && location !== 'any') {
          amenityConds.push(`da.location_type = $${paramIndex++}`);
          params.push(location);
        }
        
        amenityJoinCondition = `JOIN dormitory_amenities da ON d.dorm_id = da.dorm_id AND ${amenityConds.join(' AND ')}`;
        
        // เพิ่มเงื่อนไข amenityMatch ใน HAVING clause
        if (amenityMatch === 'all') {
          amenityHavingCondition = `COUNT(DISTINCT da.amenity_id) = ${amenityList.length}`;
        } else {
          amenityHavingCondition = `COUNT(DISTINCT da.amenity_id) >= 1`;
        }
      }
    }

    // สร้าง HAVING clause
    let finalHavingConditions = [...havingConditions];
    if (amenityHavingCondition) {
      finalHavingConditions.push(amenityHavingCondition);
    }
    const havingClause = finalHavingConditions.length > 0 ? `HAVING ${finalHavingConditions.join(' AND ')}` : '';

    // สร้าง query
    const query = `
      SELECT 
        d.dorm_id, d.dorm_name, d.address, d.min_price, d.max_price, z.zone_name, ${MAIN_IMAGE_SUBQUERY},
        COALESCE(AVG(r.rating), 0) AS avg_rating,
        COUNT(DISTINCT r.review_id) AS review_count,
        ARRAY_AGG(DISTINCT da.amenity_id) FILTER (WHERE da.amenity_id IS NOT NULL) AS amenity_ids,
        EXISTS(SELECT 1 FROM room_types rt WHERE rt.dorm_id = d.dorm_id AND rt.daily_price IS NOT NULL) AS has_daily,
        EXISTS(SELECT 1 FROM room_types rt WHERE rt.dorm_id = d.dorm_id AND rt.monthly_price IS NOT NULL) AS has_monthly
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      LEFT JOIN reviews r ON d.dorm_id = r.dorm_id
      ${amenityJoinCondition}
      ${whereClause}
      GROUP BY d.dorm_id, z.zone_name
      ${havingClause}
      ORDER BY d.created_date DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await pool.query(query, params);

    res.json({
      dormitories: result.rows,
      total: result.rows.length,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });

  } catch (error) {
    console.error("Error in advanced filter:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการกรองข้อมูลหอพัก" });
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
    const firebase_uid = req.user?.uid;

    if (!Array.isArray(amenities) || amenities.length === 0) {
      return res.status(400).json({ message: 'ต้องระบุสิ่งอำนวยความสะดวกอย่างน้อย 1 รายการ' });
    }

    await client.query('BEGIN');

    // ดึง user_id จาก firebase_uid
    let userId = null;
    if (firebase_uid) {
      const userResult = await client.query(
        'SELECT id FROM users WHERE firebase_uid = $1',
        [firebase_uid]
      );
      userId = userResult.rows[0]?.id;
    }

    // ลบสิ่งอำนวยความสะดวกเดิมทั้งหมด
    await client.query('DELETE FROM dormitory_amenities WHERE dorm_id = $1', [dormId]);

    // เพิ่มสิ่งอำนวยความสะดวกใหม่
    for (const amenity of amenities) {
      let amenityId = amenity.amenity_id || amenity.id;
      const locationType = amenity.location_type || 'ภายใน';
      const customName = amenity.custom_name?.trim();

      // ถ้ามี custom_name = สร้าง amenity ใหม่หรือใช้ของเดิม
      if (customName) {
        // 1. เช็คว่ามี amenity นี้อยู่แล้วหรือยัง (case-insensitive)
        const existing = await client.query(
          `SELECT amenity_id FROM amenities 
           WHERE LOWER(amenity_name) = LOWER($1)`,
          [customName]
        );

        if (existing.rows.length > 0) {
          // ใช้ ID เดิม
          amenityId = existing.rows[0].amenity_id;
        } else {
          // สร้างใหม่
          const newAmenity = await client.query(
            `INSERT INTO amenities 
             (amenity_name, amenity_type, created_by, category)
             VALUES ($1, 'custom', $2, 'อื่นๆ')
             RETURNING amenity_id`,
            [customName, userId]
          );
          amenityId = newAmenity.rows[0].amenity_id;
        }
      }

      // ดึงชื่อจากฐานข้อมูล
      const amenityNameResult = await client.query(
        'SELECT amenity_name FROM amenities WHERE amenity_id = $1',
        [amenityId]
      );
      const amenityName = amenityNameResult.rows[0]?.amenity_name || 'ไม่ระบุ';

      // 2. เพิ่มเข้า dormitory_amenities
      await client.query(
        `INSERT INTO dormitory_amenities 
         (dorm_id, amenity_id, location_type, amenity_name, is_available) 
         VALUES ($1, $2, $3, $4, true)`,
        [dormId, amenityId, locationType, amenityName]
      );
    }

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

// ดึงรายการสิ่งอำนวยความสะดวกทั้งหมด (จากฐานข้อมูล)
exports.getAllAmenities = async (req, res) => {
  try {
    const { type } = req.query; // 'standard', 'custom', หรือ 'all' (default)

    let query = `
      SELECT 
        amenity_id,
        amenity_name as name,
        amenity_type,
        category,
        is_active
      FROM amenities
      WHERE is_active = true
    `;

    const params = [];

    // Filter ตามประเภท
    if (type === 'standard') {
      query += ` AND amenity_type = 'standard'`;
    } else if (type === 'custom') {
      query += ` AND amenity_type = 'custom'`;
    }

    query += ` ORDER BY 
      CASE amenity_type 
        WHEN 'standard' THEN 1 
        WHEN 'custom' THEN 2 
      END,
      amenity_id ASC
    `;

    const result = await pool.query(query, params);

    res.json({
      total: result.rows.length,
      amenities: result.rows
    });

  } catch (error) {
    console.error("Error fetching amenities:", error);
    res.status(500).json({ 
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลสิ่งอำนวยความสะดวก", 
      error: error.message 
    });
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

      // อัพเดตสถานะคำขอเป็น 'ยกเลิก' พร้อม response_note
      await client.query(
        "UPDATE member_requests SET status = 'ยกเลิก', response_note = $1 WHERE dorm_id = $2 AND user_id = $3 AND status = 'อนุมัติ'",
        [response_note || null, dormId, userId]
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
