// src/controllers/deleteDormitoryController.js
const pool = require('../db');

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

    // 1. ลบข้อมูลประเภทห้อง (room types) ที่เกี่ยวข้องกับหอพักนี้
    await client.query(`DELETE FROM room_types WHERE dorm_id = $1`, [dormId]);

    // 2. ลบข้อมูลสิ่งอำนวยความสะดวก (amenities) ที่เกี่ยวข้องกับหอพักนี้
    await client.query(`DELETE FROM dormitory_amenities WHERE dorm_id = $1`, [dormId]);

    // 3. ลบข้อมูลรูปภาพหอพัก
    await client.query(`DELETE FROM dormitory_images WHERE dorm_id = $1`, [dormId]);

    // 4. ลบข้อมูลหอพัก
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

