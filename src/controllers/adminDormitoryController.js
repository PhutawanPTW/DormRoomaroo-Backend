// src/controllers/adminDormitoryController.js
const pool = require("../db");

// ฟังก์ชันสำหรับดูรายการหอพักทั้งหมด (สำหรับผู้ดูแลระบบ)
exports.getAllDormitories = async (req, res) => {
  try {
    const query = `
            SELECT 
                d.dorm_id,
                d.dorm_name,
                d.address,
                d.approval_status,
                d.created_date AS submitted_date,
                z.zone_name,
                u.username AS owner_username,
                u.display_name AS owner_name,
                (SELECT image_url FROM dormitory_images WHERE dorm_id = d.dorm_id AND is_primary = true LIMIT 1) as main_image_url
            FROM dormitories d
            LEFT JOIN zones z ON d.zone_id = z.zone_id
            LEFT JOIN users u ON d.owner_id = u.id
            ORDER BY d.created_date DESC
        `;

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching all dormitories:", error);
    res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลหอพักทั้งหมด" });
  }
};

// ฟังก์ชันสำหรับดูรายการหอพักที่รอการอนุมัติ (สำหรับผู้ดูแลระบบ)
exports.getPendingDormitories = async (req, res) => {
  try {
    const query = `
            SELECT 
                d.dorm_id,
                d.dorm_name,
                d.address,
                d.approval_status,
                d.created_date AS submitted_date,
                z.zone_name,
                u.username AS owner_username,
                u.display_name AS owner_name,
                (SELECT image_url FROM dormitory_images WHERE dorm_id = d.dorm_id AND is_primary = true LIMIT 1) as main_image_url
            FROM dormitories d
            LEFT JOIN zones z ON d.zone_id = z.zone_id
            LEFT JOIN users u ON d.owner_id = u.id
            WHERE d.approval_status = 'รออนุมัติ'
            ORDER BY d.created_date DESC
        `;

    console.log("🔍 [getPendingDormitories] Executing query:", query);
    const result = await pool.query(query);
    console.log("📊 [getPendingDormitories] Query result:", result.rows);
    console.log("📈 [getPendingDormitories] Number of pending dormitories:", result.rows.length);
    
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching pending dormitories:", error);
    res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลหอพักที่รอการอนุมัติ" });
  }
};

exports.updateDormitoryApproval = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId } = req.params;
    const { status, rejectionReason } = req.body;
    const firebase_uid = req.user.uid;

    // ตรวจสอบสิทธิ์ผู้ใช้ (เฉพาะผู้ดูแลระบบที่สามารถอนุมัติหรือปฏิเสธได้)
    const userResult = await client.query(
      "SELECT id, member_type FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const user = userResult.rows[0];
    const userId = user.id;

    if (user.member_type !== "admin") {
      return res
        .status(403)
        .json({ message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดำเนินการนี้ได้" });
    }

    await client.query("BEGIN");

    // 1. Update dormitory approval status
    const dormQuery = `
            UPDATE dormitories
            SET 
                approval_status = $1,
                updated_date = NOW()
            WHERE dorm_id = $2
        `;

    await client.query(dormQuery, [
      status,
      dormId,
    ]);

    await client.query("COMMIT");

    res.json({ message: "สถานะการอนุมัติหอพักถูกปรับปรุงเรียบร้อยแล้ว" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error updating dormitory approval:", error);
    res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดในการปรับปรุงสถานะการอนุมัติหอพัก" });
  } finally {
    client.release();
  }
};

// ฟังก์ชันสำหรับดูรายละเอียดหอพักแต่ละตัว (สำหรับแอดมิน)
exports.getDormitoryDetailsByAdmin = async (req, res) => {
  try {
    const { dormId } = req.params;
    
    // 1. ข้อมูลพื้นฐานหอพัก
    const dormQuery = `
      SELECT 
        d.*,
        z.zone_name,
        u.username AS owner_username,
        u.display_name AS owner_name,
        u.email AS owner_email,
        u.phone_number AS owner_phone,
        u.secondary_phone AS owner_secondary_phone,
        u.line_id AS owner_line_id,
        u.manager_name AS owner_manager_name,
        u.photo_url AS owner_photo_url
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      LEFT JOIN users u ON d.owner_id = u.id
      WHERE d.dorm_id = $1
    `;
    
    const dormResult = await pool.query(dormQuery, [dormId]);
    
    if (dormResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
    }
    
    const dormitory = dormResult.rows[0];
    
    // 2. รูปภาพหอพัก
    const imagesQuery = `
      SELECT image_id, image_url, is_primary
      FROM dormitory_images 
      WHERE dorm_id = $1 
      ORDER BY is_primary DESC, image_id ASC
    `;
    const imagesResult = await pool.query(imagesQuery, [dormId]);
    
    // 3. ประเภทห้อง
    const roomTypesQuery = `
      SELECT 
        rt.*,
        0 as total_rooms,
        0 as available_rooms
      FROM room_types rt
      WHERE rt.dorm_id = $1
      ORDER BY rt.room_type_id
    `;
    const roomTypesResult = await pool.query(roomTypesQuery, [dormId]);
    
    // 4. สิ่งอำนวยความสะดวก
    const amenitiesQuery = `
      SELECT 
        da.dorm_amenity_id,
        da.amenity_id,
        da.amenity_name,
        da.location_type,
        da.is_available
      FROM dormitory_amenities da
      WHERE da.dorm_id = $1
      ORDER BY da.location_type, da.amenity_name
    `;
    const amenitiesResult = await pool.query(amenitiesQuery, [dormId]);
    
    
    // จัดกลุ่มสิ่งอำนวยความสะดวก
    const groupedAmenities = {
      'ภายใน': [],
      'ภายนอก': [],
      'common': []
    };
    
    amenitiesResult.rows.forEach(amenity => {
      const locationType = amenity.location_type || 'ภายใน';
      if (groupedAmenities[locationType]) {
        groupedAmenities[locationType].push(amenity);
      }
    });
    
    res.json({
      dormitory: {
        ...dormitory,
        latitude: dormitory.latitude ? Number(dormitory.latitude) : null,
        longitude: dormitory.longitude ? Number(dormitory.longitude) : null,
      },
      images: imagesResult.rows,
      room_types: roomTypesResult.rows,
      amenities: groupedAmenities
    });
    
  } catch (error) {
    console.error("Error fetching dormitory details for admin:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลรายละเอียดหอพัก" });
  }
};

// ฟังก์ชันสำหรับดูสมาชิกในหอพัก (สำหรับแอดมิน)
exports.getDormitoryMembers = async (req, res) => {
  try {
    const { dormId } = req.params;
    
    const query = `
      SELECT 
        u.id,
        u.username,
        u.display_name,
        u.email,
        u.phone_number,
        u.photo_url,
        u.created_at as member_since,
        sh.start_date,
        sh.end_date,
        sh.status,
        sh.is_current,
        mr.request_date,
        mr.status as request_status
      FROM users u
      LEFT JOIN stay_history sh ON u.id = sh.user_id AND sh.dorm_id = $1
      LEFT JOIN member_requests mr ON u.id = mr.user_id AND mr.dorm_id = $1
      WHERE u.residence_dorm_id = $1
      ORDER BY sh.start_date DESC, u.created_at DESC
    `;
    
    const result = await pool.query(query, [dormId]);
    
    res.json({
      dorm_id: dormId,
      members: result.rows
    });
    
  } catch (error) {
    console.error("Error fetching dormitory members:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลสมาชิกหอพัก" });
  }
};

// ฟังก์ชันสำหรับแก้ไขหอพักโดยแอดมิน
exports.updateDormitoryByAdmin = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId } = req.params;
    const firebase_uid = req.user.uid;
    const updateData = req.body;
    
    // ตรวจสอบสิทธิ์แอดมิน
    const userResult = await client.query(
      "SELECT id, member_type FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }
    
    const user = userResult.rows[0];
    if (user.member_type !== "admin") {
      return res.status(403).json({ message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดำเนินการนี้ได้" });
    }
    
    await client.query("BEGIN");
    
    // สร้าง dynamic query สำหรับการอัปเดต
    const allowedFields = [
      'dorm_name', 'address', 'dorm_description', 'latitude', 'longitude',
      'electricity_type', 'electricity_rate', 'water_type', 'water_rate',
      'zone_id', 'approval_status', 'status_dorm'
    ];
    
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;
    
    for (const [key, value] of Object.entries(updateData)) {
      if (allowedFields.includes(key) && value !== undefined) {
        updateFields.push(`${key} = $${paramCount}`);
        updateValues.push(value);
        paramCount++;
      }
    }
    
    if (updateFields.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "ไม่มีข้อมูลที่ต้องอัปเดต" });
    }
    
    // เพิ่ม updated_date
    updateFields.push(`updated_date = NOW()`);
    
    // เพิ่ม dormId เป็น parameter สุดท้าย
    updateValues.push(dormId);
    
    const updateQuery = `
      UPDATE dormitories 
      SET ${updateFields.join(', ')}
      WHERE dorm_id = $${paramCount}
    `;
    
    await client.query(updateQuery, updateValues);
    
    await client.query("COMMIT");
    
    res.json({ message: "อัปเดตข้อมูลหอพักเรียบร้อยแล้ว" });
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error updating dormitory by admin:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตข้อมูลหอพัก" });
  } finally {
    client.release();
  }
};

// ฟังก์ชันสำหรับดูสถิติหอพัก (สำหรับแอดมิน)
exports.getDormitoryStats = async (req, res) => {
  try {
    const { dormId } = req.params;
    
    // 1. สถิติพื้นฐาน
    const basicStatsQuery = `
      SELECT 
        COUNT(DISTINCT rt.room_type_id) as total_room_types,
        0 as total_rooms,
        0 as available_rooms,
        COUNT(DISTINCT da.amenity_id) as total_amenities,
        COUNT(DISTINCT u.id) as current_members,
        COUNT(DISTINCT sh.user_id) as total_members_ever
      FROM dormitories d
      LEFT JOIN room_types rt ON d.dorm_id = rt.dorm_id
      LEFT JOIN dormitory_amenities da ON d.dorm_id = da.dorm_id
      LEFT JOIN users u ON d.dorm_id = u.residence_dorm_id
      LEFT JOIN stay_history sh ON d.dorm_id = sh.dorm_id
      WHERE d.dorm_id = $1
    `;
    
    // 2. สถิติการรีวิว
    const reviewStatsQuery = `
      SELECT 
        COUNT(*) as total_reviews,
        AVG(rating) as average_rating,
        COUNT(CASE WHEN rating = 5 THEN 1 END) as five_star,
        COUNT(CASE WHEN rating = 4 THEN 1 END) as four_star,
        COUNT(CASE WHEN rating = 3 THEN 1 END) as three_star,
        COUNT(CASE WHEN rating = 2 THEN 1 END) as two_star,
        COUNT(CASE WHEN rating = 1 THEN 1 END) as one_star
      FROM reviews 
      WHERE dorm_id = $1
    `;
    
    // 3. สถิติการเข้าพัก (ย้อนหลัง 12 เดือน)
    const occupancyStatsQuery = `
      SELECT 
        DATE_TRUNC('month', start_date) as month,
        COUNT(*) as new_members,
        COUNT(CASE WHEN end_date IS NOT NULL THEN 1 END) as moved_out
      FROM stay_history 
      WHERE dorm_id = $1 
        AND start_date >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', start_date)
      ORDER BY month DESC
    `;
    
    const [basicStats, reviewStats, occupancyStats] = await Promise.all([
      pool.query(basicStatsQuery, [dormId]),
      pool.query(reviewStatsQuery, [dormId]),
      pool.query(occupancyStatsQuery, [dormId])
    ]);
    
    res.json({
      dorm_id: dormId,
      basic_stats: basicStats.rows[0] || {},
      review_stats: reviewStats.rows[0] || {
        total_reviews: 0,
        average_rating: 0,
        five_star: 0,
        four_star: 0,
        three_star: 0,
        two_star: 0,
        one_star: 0
      },
      occupancy_stats: occupancyStats.rows
    });
    
  } catch (error) {
    console.error("Error fetching dormitory stats:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลสถิติหอพัก" });
  }
};

// ฟังก์ชันสำหรับจัดการสถานะหอพัก (เปิด/ปิด)
exports.updateDormitoryStatus = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId } = req.params;
    const { status_dorm } = req.body; // 'เปิดใช้งาน' หรือ 'ปิดใช้งาน'
    const firebase_uid = req.user.uid;
    
    // ตรวจสอบสิทธิ์แอดมิน
    const userResult = await client.query(
      "SELECT id, member_type FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }
    
    const user = userResult.rows[0];
    if (user.member_type !== "admin") {
      return res.status(403).json({ message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดำเนินการนี้ได้" });
    }
    
    // ตรวจสอบสถานะที่ส่งมา
    if (!['เปิดใช้งาน', 'ปิดใช้งาน'].includes(status_dorm)) {
      return res.status(400).json({ message: "สถานะไม่ถูกต้อง ต้องเป็น 'เปิดใช้งาน' หรือ 'ปิดใช้งาน'" });
    }
    
    await client.query("BEGIN");
    
    // อัปเดตสถานะหอพัก
    await client.query(
      `UPDATE dormitories 
       SET status_dorm = $1, updated_date = NOW() 
       WHERE dorm_id = $2`,
      [status_dorm, dormId]
    );
    
    // หากปิดใช้งาน ให้จัดการสมาชิกที่อาศัยอยู่
    if (status_dorm === 'ปิดใช้งาน') {
      // บันทึกประวัติการย้ายออก
      const residentsResult = await client.query(
        `SELECT id FROM users WHERE residence_dorm_id = $1`,
        [dormId]
      );
      
      if (residentsResult.rows.length > 0) {
        const residentIds = residentsResult.rows.map(r => r.id);
        
        // บันทึกประวัติการย้ายออก
        const insertHistoryQuery = `
          INSERT INTO member_requests (user_id, dorm_id, request_date, status)
          SELECT id, $1, CURRENT_TIMESTAMP, 'ย้ายออกอัตโนมัติ (หอพักปิดใช้งาน)'
          FROM users
          WHERE id = ANY($2::int[])
        `;
        await client.query(insertHistoryQuery, [dormId, residentIds]);
        
        // อัปเดต stay_history
        await client.query(
          `UPDATE stay_history 
           SET end_date = NOW(), is_current = false, status = 'ย้ายออก (หอพักปิดใช้งาน)'
           WHERE user_id = ANY($1::int[]) AND dorm_id = $2 AND is_current = true`,
          [residentIds, dormId]
        );
        
        // ถอดสมาชิกออกจากหอพัก
        await client.query(
          `UPDATE users SET residence_dorm_id = NULL, updated_at = CURRENT_TIMESTAMP 
           WHERE id = ANY($1::int[])`,
          [residentIds]
        );
      }
    }
    
    await client.query("COMMIT");
    
    res.json({ 
      message: `อัปเดตสถานะหอพักเป็น '${status_dorm}' เรียบร้อยแล้ว`,
      status_dorm: status_dorm
    });
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error updating dormitory status:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตสถานะหอพัก" });
  } finally {
    client.release();
  }
};

// ตรวจสอบสมาชิกของหอพักก่อนลบ (สำหรับ admin)
exports.checkDormitoryMembers = async (req, res) => {
  try {
    const { dormId } = req.params;
    const firebase_uid = req.user.uid;

    // ตรวจสอบสิทธิ์ผู้ใช้ (เฉพาะผู้ดูแลระบบที่สามารถตรวจสอบได้)
    const userResult = await pool.query(
      "SELECT id, member_type FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const user = userResult.rows[0];

    if (user.member_type !== "admin") {
      return res.status(403).json({ message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถตรวจสอบได้" });
    }

    // ตรวจสอบว่าหอพักมีอยู่หรือไม่
    const dormResult = await pool.query(
      "SELECT dorm_id, dorm_name FROM dormitories WHERE dorm_id = $1",
      [dormId]
    );

    if (dormResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
    }

    const dormName = dormResult.rows[0].dorm_name;

    // ตรวจสอบจำนวนสมาชิกที่อาศัยอยู่
    const residentCountResult = await pool.query(
      `SELECT COUNT(*)::int AS member_count FROM users WHERE residence_dorm_id = $1`,
      [dormId]
    );
    const memberCount = residentCountResult.rows[0]?.member_count || 0;

    // ดึงรายชื่อสมาชิกที่อาศัยอยู่ (ถ้ามี)
    let members = [];
    if (memberCount > 0) {
      const membersResult = await pool.query(
        `SELECT id, username, display_name, email FROM users WHERE residence_dorm_id = $1`,
        [dormId]
      );
      members = membersResult.rows;
    }

    res.json({
      dorm_id: parseInt(dormId),
      dorm_name: dormName,
      member_count: memberCount,
      members: members,
      has_members: memberCount > 0,
      confirmation_message: memberCount > 0 
        ? `ยืนยันการลบหอพัก\nคุณต้องการลบหอพัก "${dormName}" และ สมาชิกของหอ ใช่หรือไม่ ?`
        : `ยืนยันการลบหอพัก\nคุณต้องการลบหอพัก "${dormName}" ใช่หรือไม่ ?`
    });
  } catch (error) {
    console.error('Error checking dormitory members:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// ฟังก์ชันสำหรับลบหอพัก (เฉพาะผู้ดูแลระบบ)
exports.deleteDormitory = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId } = req.params;
    const firebase_uid = req.user.uid;
    const confirmRaw = (req.query && req.query.confirm) ?? (req.body && req.body.confirm);
    const confirm = (typeof confirmRaw === 'string') ? confirmRaw.toLowerCase() === 'true' : (confirmRaw === true);

    // ตรวจสอบสิทธิ์ผู้ใช้ (เฉพาะผู้ดูแลระบบที่สามารถลบได้)
    const userResult = await client.query(
      "SELECT id, member_type FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const user = userResult.rows[0];
    const userId = user.id;

    if (user.member_type !== "admin") {
      return res
        .status(403)
        .json({ message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถลบหอพักได้" });
    }

    await client.query("BEGIN");

    // ตรวจสอบว่าหอพักมีอยู่หรือไม่และดึงชื่อหอพัก
    const dormCheckResult = await client.query(
      "SELECT dorm_id, dorm_name FROM dormitories WHERE dorm_id = $1",
      [dormId]
    );

    if (dormCheckResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
    }

    const dormName = dormCheckResult.rows[0].dorm_name;

    // Pre-check: ถ้ามีสมาชิกอาศัยอยู่ ให้ปฏิเสธด้วย 409
    const residentCountResult = await client.query(
      `SELECT COUNT(*)::int AS member_count FROM users WHERE residence_dorm_id = $1`,
      [dormId]
    );
    const residentCount = residentCountResult.rows[0]?.member_count || 0;
    
    if (residentCount > 0 && !confirm) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'ยังมีสมาชิกอาศัยอยู่ในหอพักนี้ ต้องยืนยันก่อนลบ',
        member_count: residentCount,
        dorm_name: dormName,
        require_confirmation: true,
        confirmation_message: `ยืนยันการลบหอพัก\nคุณต้องการลบหอพัก "${dormName}" และ สมาชิกของหอ ใช่หรือไม่ ?`
      });
    }

    // 0. จัดการสมาชิกที่อาศัยอยู่ในหอพักนี้: บันทึกประวัติและถอดออกจากหอพัก
    //    - เก็บประวัติในตาราง member_requests เป็นสถานะ "ย้ายออกอัตโนมัติ"
    //    - ตั้งค่า users.residence_dorm_id = NULL
    const residentsResult = await client.query(
      `SELECT id FROM users WHERE residence_dorm_id = $1`,
      [dormId]
    );

    if (residentsResult.rows.length > 0) {
      const residentIds = residentsResult.rows.map(r => r.id);

      // บันทึกประวัติการย้ายออก
      const insertHistoryQuery = `
        INSERT INTO member_requests (user_id, dorm_id, request_date, status)
        SELECT id, $1, CURRENT_TIMESTAMP, 'ย้ายออกอัตโนมัติ'
        FROM users
        WHERE id = ANY($2::int[])
      `;
      await client.query(insertHistoryQuery, [dormId, residentIds]);

      // ถอดสมาชิกออกจากหอพัก
      await client.query(
        `UPDATE users SET residence_dorm_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::int[])`,
        [residentIds]
      );
    }

    // 1. ลบข้อมูลประเภทห้องที่เกี่ยวข้องกับหอพักนี้
    await client.query(
      `DELETE FROM room_types WHERE dorm_id = $1`,
      [dormId]
    );

    // 2. ลบข้อมูล member_requests ที่เกี่ยวข้องกับหอพักนี้
    await client.query(`DELETE FROM member_requests WHERE dorm_id = $1`, [dormId]);

    // 3. ลบข้อมูล stay_history ที่เกี่ยวข้องกับหอพักนี้
    await client.query(`DELETE FROM stay_history WHERE dorm_id = $1`, [dormId]);

    // 4. ลบข้อมูลประเภทห้อง (room types) ที่เกี่ยวข้องกับหอพักนี้
    await client.query(`DELETE FROM room_types WHERE dorm_id = $1`, [dormId]);

    // 5. ลบข้อมูลสิ่งอำนวยความสะดวก (amenities) ที่เกี่ยวข้องกับหอพักนี้
    await client.query(`DELETE FROM dormitory_amenities WHERE dorm_id = $1`, [
      dormId,
    ]);

    // 6. ลบข้อมูลรูปภาพหอพัก
    await client.query(`DELETE FROM dormitory_images WHERE dorm_id = $1`, [
      dormId,
    ]);

    // 7. ลบข้อมูลหอพัก
    await client.query(`DELETE FROM dormitories WHERE dorm_id = $1`, [dormId]);

    await client.query("COMMIT");

    // ส่งข้อความตอบกลับที่แตกต่างกันตามจำนวนสมาชิก
    const successMessage = residentCount > 0 
      ? `ลบหอพัก "${dormName}" และสมาชิก ${residentCount} คนเรียบร้อยแล้ว`
      : `ลบหอพัก "${dormName}" เรียบร้อยแล้ว`;

    res.json({ 
      message: successMessage,
      dorm_name: dormName,
      member_count: residentCount
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error deleting dormitory:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบหอพัก" });
  } finally {
    client.release();
  }
}; 