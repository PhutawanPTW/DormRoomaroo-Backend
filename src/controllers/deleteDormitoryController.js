// src/controllers/deleteDormitoryController.js
const pool = require('../db');

// ตรวจสอบสมาชิกของหอพักก่อนลบ
exports.checkDormitoryMembers = async (req, res) => {
  try {
    const { dormId } = req.params;
    const firebase_uid = req.user.uid;

    // ตรวจสอบสิทธิ์ผู้ใช้ (เฉพาะเจ้าของหอพักที่สามารถตรวจสอบได้)
    const userResult = await pool.query(
      "SELECT id, member_type FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const user = userResult.rows[0];
    const userId = user.id;

    // ตรวจสอบว่าหอพักนี้เป็นของผู้ใช้หรือไม่
    const dormResult = await pool.query(
      "SELECT dorm_id, dorm_name FROM dormitories WHERE dorm_id = $1 AND owner_id = $2",
      [dormId, userId]
    );

    if (dormResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพักหรือไม่มีสิทธิ์เข้าถึง" });
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

    // อัพเดตช่วงราคาในตาราง dormitories (import จาก editDormitoryController)
    const { updateDormitoryPriceRange } = require('./editDormitoryController');
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

// ลบหอพัก (สำหรับ owner)
exports.deleteDormitory = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId } = req.params;
    const firebase_uid = req.user.uid;
    const confirmRaw = (req.query && req.query.confirm) ?? (req.body && req.body.confirm);
    const confirm = (typeof confirmRaw === 'string') ? confirmRaw.toLowerCase() === 'true' : (confirmRaw === true);

    // ตรวจสอบสิทธิ์ผู้ใช้ (เฉพาะเจ้าของหอพักที่สามารถลบได้)
    const userResult = await client.query(
      "SELECT id, member_type FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const user = userResult.rows[0];
    const userId = user.id;

    // ตรวจสอบว่าหอพักนี้เป็นของผู้ใช้หรือไม่
    const dormResult = await client.query(
      "SELECT dorm_id, dorm_name FROM dormitories WHERE dorm_id = $1 AND owner_id = $2",
      [dormId, userId]
    );

    if (dormResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพักหรือไม่มีสิทธิ์ลบ" });
    }

    await client.query("BEGIN");

    // Pre-check: ถ้ามีสมาชิกอาศัยอยู่ ให้ปฏิเสธด้วย 409
    const residentCountResult = await client.query(
      `SELECT COUNT(*)::int AS member_count FROM users WHERE residence_dorm_id = $1`,
      [dormId]
    );
    const residentCount = residentCountResult.rows[0]?.member_count || 0;
    const dormName = dormResult.rows[0].dorm_name;
    
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

    // หากยืนยันแล้วและมีสมาชิก: เคลียร์ความสัมพันธ์ก่อนลบ
    if (residentCount > 0 && confirm) {
      // ดึงรายชื่อสมาชิกที่อาศัยอยู่
      const residentsResult = await client.query(
        `SELECT id FROM users WHERE residence_dorm_id = $1`,
        [dormId]
      );
      const residentIds = residentsResult.rows.map(r => r.id);

      if (residentIds.length > 0) {
        // บันทึกประวัติใน member_requests ว่า "ย้ายออกโดยเจ้าของ"
        await client.query(
          `INSERT INTO member_requests (user_id, dorm_id, request_date, status)
           SELECT id, $1, CURRENT_TIMESTAMP, 'ย้ายออกโดยเจ้าของ'
           FROM users WHERE id = ANY($2::int[])`,
          [dormId, residentIds]
        );

        // ปิด stay ปัจจุบันใน stay_history สำหรับหอนี้
        await client.query(
          `UPDATE stay_history
           SET end_date = NOW(), is_current = false, status = 'หอพักถูกลบ'
           WHERE dorm_id = $1 AND user_id = ANY($2::int[]) AND is_current = true`,
          [dormId, residentIds]
        );

        // ถอดสมาชิกออกจากหอพัก
        await client.query(
          `UPDATE users SET residence_dorm_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ANY($1::int[])`,
          [residentIds]
        );
      }
    }

    // 1. ลบข้อมูล member_requests ที่เกี่ยวข้องกับหอพักนี้
    await client.query(`DELETE FROM member_requests WHERE dorm_id = $1`, [dormId]);

    // 2. ลบข้อมูล stay_history ที่เกี่ยวข้องกับหอพักนี้
    await client.query(`DELETE FROM stay_history WHERE dorm_id = $1`, [dormId]);

    // 3. ลบข้อมูลประเภทห้อง (room types) ที่เกี่ยวข้องกับหอพักนี้
    await client.query(`DELETE FROM room_types WHERE dorm_id = $1`, [dormId]);

    // 4. ลบข้อมูลสิ่งอำนวยความสะดวก (amenities) ที่เกี่ยวข้องกับหอพักนี้
    await client.query(`DELETE FROM dormitory_amenities WHERE dorm_id = $1`, [dormId]);

    // 5. ลบข้อมูลรูปภาพหอพัก
    await client.query(`DELETE FROM dormitory_images WHERE dorm_id = $1`, [dormId]);

    // 6. ลบข้อมูลรีวิว (reviews) ที่เกี่ยวข้องกับหอพักนี้
    await client.query(`DELETE FROM reviews WHERE dorm_id = $1`, [dormId]);

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

