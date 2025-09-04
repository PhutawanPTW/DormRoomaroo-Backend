// src/controllers/stayController.js
const pool = require("../db");

// ดึงประวัติการเข้าพักของผู้ใช้
exports.getUserStayHistory = async (req, res) => {
  try {
    const { uid } = req.user;

    // ตรวจสอบข้อมูลผู้ใช้
    const userResult = await pool.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const userId = userResult.rows[0].id;

    // ดึงประวัติการเข้าพักทั้งหมดของผู้ใช้
    const stayHistoryQuery = `
      SELECT 
        s.stay_id,
        s.start_date,
        s.end_date,
        s.is_current,
        s.status,
        d.dorm_id,
        d.dorm_name,
        d.address,
        z.zone_name
      FROM stays s
      JOIN dormitories d ON s.dorm_id = d.dorm_id
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      WHERE s.user_id = $1
      ORDER BY s.start_date DESC
    `;

    const stayHistoryResult = await pool.query(stayHistoryQuery, [userId]);

    res.json({
      user_id: userId,
      total_stays: stayHistoryResult.rows.length,
      current_stay: stayHistoryResult.rows.find(stay => stay.is_current) || null,
      stay_history: stayHistoryResult.rows
    });

  } catch (error) {
    console.error("Error fetching user stay history:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

// สร้างประวัติการเข้าพักใหม่ (เมื่อย้ายหอพัก)
exports.createStayRecord = async (req, res) => {
  const client = await pool.connect();
  try {
    const { uid } = req.user;
    const { dorm_id, start_date } = req.body;

    if (!dorm_id || !start_date) {
      return res.status(400).json({ message: "กรุณาระบุหอพักและวันที่เริ่มเข้าพัก" });
    }

    await client.query('BEGIN');

    // ตรวจสอบข้อมูลผู้ใช้
    const userResult = await client.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [uid]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const userId = userResult.rows[0].id;

    // ตรวจสอบว่าหอพักมีอยู่หรือไม่
    const dormResult = await client.query(
      "SELECT dorm_id, dorm_name FROM dormitories WHERE dorm_id = $1",
      [dorm_id]
    );

    if (dormResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
    }

    // ปิดประวัติการเข้าพักปัจจุบัน (ถ้ามี)
    await client.query(
      "UPDATE stays SET end_date = CURRENT_TIMESTAMP, is_current = false WHERE user_id = $1 AND is_current = true",
      [userId]
    );

    // สร้างประวัติการเข้าพักใหม่
    const createStayQuery = `
      INSERT INTO stays (user_id, dorm_id, start_date, is_current, status)
      VALUES ($1, $2, $3, true, 'เข้าพัก')
      RETURNING stay_id
    `;

    const stayResult = await client.query(createStayQuery, [
      userId,
      dorm_id,
      start_date
    ]);

    await client.query('COMMIT');

    res.status(201).json({
      message: "สร้างประวัติการเข้าพักสำเร็จ",
      stay_id: stayResult.rows[0].stay_id,
      dorm_name: dormResult.rows[0].dorm_name
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error creating stay record:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  } finally {
    client.release();
  }
};

// อัพเดตประวัติการเข้าพัก (เมื่อออกจากหอพัก)
exports.updateStayRecord = async (req, res) => {
  const client = await pool.connect();
  try {
    const { stayId } = req.params;
    const { uid } = req.user;
    const { end_date, status } = req.body;

    await client.query('BEGIN');

    // ตรวจสอบข้อมูลผู้ใช้
    const userResult = await client.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [uid]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const userId = userResult.rows[0].id;

    // ตรวจสอบว่าประวัติการเข้าพักมีอยู่และเป็นของผู้ใช้นี้หรือไม่
    const stayResult = await client.query(
      "SELECT stay_id, user_id, is_current FROM stays WHERE stay_id = $1",
      [stayId]
    );

    if (stayResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "ไม่พบประวัติการเข้าพัก" });
    }

    if (stayResult.rows[0].user_id !== userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: "ไม่มีสิทธิ์แก้ไขประวัติการเข้าพักนี้" });
    }

    // อัพเดตประวัติการเข้าพัก
    const updateFields = [];
    const values = [];
    let paramIndex = 1;

    if (end_date !== undefined) {
      updateFields.push(`end_date = $${paramIndex++}`);
      values.push(end_date);
    }

    if (status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      values.push(status);
    }

    // ถ้ามี end_date ให้ตั้ง is_current เป็น false
    if (end_date !== undefined) {
      updateFields.push(`is_current = false`);
    }

    if (updateFields.length > 0) {
      values.push(stayId);
      const updateQuery = `
        UPDATE stays 
        SET ${updateFields.join(', ')}
        WHERE stay_id = $${paramIndex}
      `;
      await client.query(updateQuery, values);
    }

    await client.query('COMMIT');

    res.json({ message: "อัพเดตประวัติการเข้าพักสำเร็จ" });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error updating stay record:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  } finally {
    client.release();
  }
};

// ดึงประวัติการเข้าพักของหอพัก (สำหรับเจ้าของหอพัก)
exports.getDormitoryStayHistory = async (req, res) => {
  try {
    const { dormId } = req.params;
    const { uid } = req.user;

    // ตรวจสอบข้อมูลผู้ใช้
    const userResult = await pool.query(
      "SELECT id, member_type FROM users WHERE firebase_uid = $1",
      [uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const user = userResult.rows[0];

    // ตรวจสอบว่าเป็นเจ้าของหอพักหรือไม่
    const dormResult = await pool.query(
      "SELECT dorm_id, dorm_name FROM dormitories WHERE dorm_id = $1 AND owner_id = $2",
      [dormId, user.id]
    );

    if (dormResult.rows.length === 0) {
      return res.status(403).json({ message: "ไม่มีสิทธิ์เข้าถึงข้อมูลหอพักนี้" });
    }

    // ดึงประวัติการเข้าพักของหอพัก
    const stayHistoryQuery = `
      SELECT 
        s.stay_id,
        s.start_date,
        s.end_date,
        s.is_current,
        s.status,
        u.id as user_id,
        u.display_name,
        u.email,
        u.phone_number
      FROM stays s
      JOIN users u ON s.user_id = u.id
      WHERE s.dorm_id = $1
      ORDER BY s.start_date DESC
    `;

    const stayHistoryResult = await pool.query(stayHistoryQuery, [dormId]);

    // คำนวณสถิติ
    const currentResidents = stayHistoryResult.rows.filter(stay => stay.is_current).length;
    const totalResidents = stayHistoryResult.rows.length;

    res.json({
      dorm_id: parseInt(dormId),
      dorm_name: dormResult.rows[0].dorm_name,
      current_residents: currentResidents,
      total_residents: totalResidents,
      stay_history: stayHistoryResult.rows
    });

  } catch (error) {
    console.error("Error fetching dormitory stay history:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

// ฟังก์ชันช่วยสำหรับอัพเดตประวัติการเข้าพักเมื่อย้ายหอ (เรียกจาก profileController)
exports.updateStayHistoryOnMove = async (userId, oldDormId, newDormId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ปิดประวัติการเข้าพักเก่า (ถ้ามี)
    if (oldDormId) {
      await client.query(
        "UPDATE stays SET end_date = CURRENT_TIMESTAMP, is_current = false WHERE user_id = $1 AND dorm_id = $2 AND is_current = true",
        [userId, oldDormId]
      );
    }

    // สร้างประวัติการเข้าพักใหม่ (ถ้ามีหอพักใหม่)
    if (newDormId) {
      await client.query(
        "INSERT INTO stays (user_id, dorm_id, start_date, is_current, status) VALUES ($1, $2, CURRENT_TIMESTAMP, true, 'เข้าพัก')",
        [userId, newDormId]
      );
    }

    await client.query('COMMIT');
    return true;

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error updating stay history on move:", error);
    throw error;
  } finally {
    client.release();
  }
};
