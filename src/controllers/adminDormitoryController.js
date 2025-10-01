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
                rejection_reason = $2,
                reviewed_by = $3,
                reviewed_date = NOW()
            WHERE dorm_id = $4
        `;

    await client.query(dormQuery, [
      status,
      status === "ไม่อนุมัติ" ? rejectionReason : null, // Set rejection reason only if rejected
      userId,
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

// ฟังก์ชันสำหรับลบหอพัก (เฉพาะผู้ดูแลระบบ)
exports.deleteDormitory = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId } = req.params;
    const firebase_uid = req.user.uid;

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

    // 1. ลบข้อมูลห้องพักที่เกี่ยวข้องกับหอพักนี้
    await client.query(
      `DELETE FROM rooms WHERE room_type_id IN (SELECT room_type_id FROM room_types WHERE dorm_id = $1)`,
      [dormId]
    );

    // 2. ลบข้อมูลประเภทห้อง (room types) ที่เกี่ยวข้องกับหอพักนี้
    await client.query(`DELETE FROM room_types WHERE dorm_id = $1`, [dormId]);

    // 3. ลบข้อมูลสิ่งอำนวยความสะดวก (amenities) ที่เกี่ยวข้องกับหอพักนี้
    await client.query(`DELETE FROM dormitory_amenities WHERE dorm_id = $1`, [
      dormId,
    ]);

    // 4. จัดการข้อมูล stay_history ของหอพักนี้
    //    - ตั้งค่า dorm_id = NULL และเพิ่มโน้ตลงใน status ว่า "หอพัก id X ถูกลบ"
    await client.query(
      `UPDATE stay_history 
       SET dorm_id = NULL, 
           status = CASE 
             WHEN is_current = true OR status = 'อยู่' THEN CONCAT('หอพัก id ', $1::text, ' ถูกลบ')
             ELSE status 
           END,
           end_date = CASE 
             WHEN is_current = true THEN CURRENT_TIMESTAMP 
             ELSE end_date 
           END,
           is_current = false
       WHERE dorm_id = $1`,
      [dormId]
    );

    // 5. ลบข้อมูลรูปภาพหอพัก
    await client.query(`DELETE FROM dormitory_images WHERE dorm_id = $1`, [
      dormId,
    ]);

    // 6. ลบข้อมูลหอพัก
    await client.query(`DELETE FROM dormitories WHERE dorm_id = $1`, [dormId]);

    await client.query("COMMIT");

    res.json({ message: "ลบหอพักเรียบร้อยแล้ว" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error deleting dormitory:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการลบหอพัก" });
  } finally {
    client.release();
  }
}; 