// src/controllers/profileController.js
const pool = require("../db");
const bcrypt = require("bcrypt");
const storageService = require("../services/storageService");
const stayController = require("./stayController");

// ดึงข้อมูลโปรไฟล์ผู้ใช้
exports.getUserProfile = async (req, res) => {
  try {
    const { uid } = req.user;

    const query = `
      SELECT 
        id,
        firebase_uid,
        username,
        email,
        display_name,
        photo_url,
        phone_number,
        member_type,
        residence_dorm_id,
        manager_name,
        secondary_phone,
        line_id,
        created_at,
        updated_at
      FROM users 
      WHERE firebase_uid = $1
    `;

    const result = await pool.query(query, [uid]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const user = result.rows[0];

    // ดึงข้อมูลหอพักปัจจุบัน (ถ้ามี)
    let currentDorm = null;
    if (user.residence_dorm_id) {
      const dormQuery = `
        SELECT dorm_id, dorm_name, address
        FROM dormitories 
        WHERE dorm_id = $1
      `;
      const dormResult = await pool.query(dormQuery, [user.residence_dorm_id]);
      if (dormResult.rows.length > 0) {
        currentDorm = dormResult.rows[0];
      }
    }

    // ดึงรายการหอพักที่สามารถเลือกได้ (สำหรับ member)
    let availableDorms = [];
    if (user.member_type === 'member') {
      const dormsQuery = `
        SELECT dorm_id, dorm_name, address, zone_name
        FROM dormitories d
        LEFT JOIN zones z ON d.zone_id = z.zone_id
        WHERE d.approval_status = 'อนุมัติ'
        ORDER BY d.dorm_name
      `;
      const dormsResult = await pool.query(dormsQuery);
      availableDorms = dormsResult.rows;
    }

    res.json({
      user: {
        id: user.id,
        firebase_uid: user.firebase_uid,
        username: user.username,
        email: user.email,
        display_name: user.display_name,
        photo_url: user.photo_url,
        phone_number: user.phone_number,
        member_type: user.member_type,
        manager_name: user.manager_name,
        secondary_phone: user.secondary_phone,
        line_id: user.line_id,
        created_at: user.created_at,
        updated_at: user.updated_at
      },
      current_dorm: currentDorm,
      available_dorms: availableDorms
    });

  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

// อัพเดตข้อมูลโปรไฟล์
exports.updateUserProfile = async (req, res) => {
  const client = await pool.connect();
  try {
    const { uid } = req.user;
    const {
      display_name,
      phone_number,
      manager_name,
      secondary_phone,
      line_id
    } = req.body;

    await client.query('BEGIN');

    // ดึงข้อมูลผู้ใช้ปัจจุบัน
    const userResult = await client.query(
      "SELECT id, member_type, email FROM users WHERE firebase_uid = $1",
      [uid]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const user = userResult.rows[0];

    // อัพเดตข้อมูลพื้นฐาน
    const updateFields = [];
    const values = [];
    let paramIndex = 1;

    if (display_name !== undefined) {
      updateFields.push(`display_name = $${paramIndex++}`);
      values.push(display_name);
    }

    if (phone_number !== undefined) {
      updateFields.push(`phone_number = $${paramIndex++}`);
      values.push(phone_number);
    }

    // อัพเดตข้อมูล owner (ถ้าเป็น owner)
    if (user.member_type === 'owner') {
      if (manager_name !== undefined) {
        updateFields.push(`manager_name = $${paramIndex++}`);
        values.push(manager_name);
      }
      if (secondary_phone !== undefined) {
        updateFields.push(`secondary_phone = $${paramIndex++}`);
        values.push(secondary_phone);
      }
      if (line_id !== undefined) {
        updateFields.push(`line_id = $${paramIndex++}`);
        values.push(line_id);
      }
    }

    if (updateFields.length > 0) {
      updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(uid);

      const updateQuery = `
        UPDATE users 
        SET ${updateFields.join(', ')}
        WHERE firebase_uid = $${paramIndex}
        RETURNING *
      `;

      await client.query(updateQuery, values);
    }

    await client.query('COMMIT');

    res.json({ message: "อัพเดตโปรไฟล์สำเร็จ" });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error updating user profile:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  } finally {
    client.release();
  }
};

// อัพโหลดรูปโปรไฟล์
exports.uploadProfileImage = async (req, res) => {
  const client = await pool.connect();
  try {
    const { uid } = req.user;

    if (!req.file) {
      return res.status(400).json({ message: "กรุณาเลือกไฟล์รูปภาพ" });
    }

    await client.query('BEGIN');

    // อัพโหลดรูปไปยัง Firebase Storage
    const imageUrl = await storageService.uploadImage(req.file);

    // อัพเดต URL รูปในฐานข้อมูล
    await client.query(
      "UPDATE users SET photo_url = $1, updated_at = CURRENT_TIMESTAMP WHERE firebase_uid = $2",
      [imageUrl, uid]
    );

    await client.query('COMMIT');

    res.json({ 
      message: "อัพโหลดรูปโปรไฟล์สำเร็จ",
      photo_url: imageUrl
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error uploading profile image:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  } finally {
    client.release();
  }
};

// เปลี่ยนรหัสผ่าน (สำหรับ Email/Password users เท่านั้น)
exports.changePassword = async (req, res) => {
  const client = await pool.connect();
  try {
    const { uid } = req.user;
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ message: "กรุณาระบุรหัสผ่านปัจจุบันและรหัสผ่านใหม่" });
    }

    await client.query('BEGIN');

    // ตรวจสอบว่าผู้ใช้เป็น Email/Password user หรือไม่
    const userResult = await client.query(
      "SELECT id, email, password_hash FROM users WHERE firebase_uid = $1",
      [uid]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const user = userResult.rows[0];

    // ตรวจสอบว่ามี password_hash หรือไม่ (Email/Password user)
    if (!user.password_hash) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: "ไม่สามารถเปลี่ยนรหัสผ่านได้สำหรับ Google Account" });
    }

    // ตรวจสอบรหัสผ่านปัจจุบัน
    const passwordMatch = await bcrypt.compare(current_password, user.password_hash);
    if (!passwordMatch) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
    }

    // สร้าง hash รหัสผ่านใหม่
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(new_password, saltRounds);

    // อัพเดตรหัสผ่าน
    await client.query(
      "UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE firebase_uid = $2",
      [newPasswordHash, uid]
    );

    await client.query('COMMIT');

    res.json({ message: "เปลี่ยนรหัสผ่านสำเร็จ" });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error changing password:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  } finally {
    client.release();
  }
};

// เปลี่ยนหอพัก (สำหรับ member เท่านั้น)
exports.changeDormitory = async (req, res) => {
  const client = await pool.connect();
  try {
    const { uid } = req.user;
    const { new_dorm_id } = req.body;

    if (!new_dorm_id) {
      return res.status(400).json({ message: "กรุณาระบุหอพักใหม่" });
    }

    await client.query('BEGIN');

    // ตรวจสอบข้อมูลผู้ใช้
    const userResult = await client.query(
      "SELECT id, member_type, residence_dorm_id FROM users WHERE firebase_uid = $1",
      [uid]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const user = userResult.rows[0];

    // ตรวจสอบว่าเป็น member หรือไม่
    if (user.member_type !== 'member') {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: "เฉพาะสมาชิกเท่านั้นที่สามารถเปลี่ยนหอพักได้" });
    }

    // ตรวจสอบว่าหอพักใหม่มีอยู่และได้รับการอนุมัติหรือไม่
    const dormResult = await client.query(
      "SELECT dorm_id, dorm_name FROM dormitories WHERE dorm_id = $1 AND approval_status = 'อนุมัติ'",
      [new_dorm_id]
    );

    if (dormResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "ไม่พบหอพักที่เลือกหรือหอพักยังไม่ได้รับการอนุมัติ" });
    }

    const oldDormId = user.residence_dorm_id;

    // ถ้ามีหอพักเก่า ให้ยกเลิกคำขอในหอพักเก่า
    if (oldDormId && oldDormId !== new_dorm_id) {
      await client.query(
        "UPDATE member_requests SET status = 'ยกเลิก' WHERE user_id = $1 AND dorm_id = $2",
        [user.id, oldDormId]
      );
    }

    // อัพเดต residence_dorm_id
    await client.query(
      "UPDATE users SET residence_dorm_id = $1, updated_at = CURRENT_TIMESTAMP WHERE firebase_uid = $2",
      [new_dorm_id, uid]
    );

    // สร้างคำขอใหม่สำหรับหอพักใหม่
    const existingRequest = await client.query(
      "SELECT * FROM member_requests WHERE user_id = $1 AND dorm_id = $2",
      [user.id, new_dorm_id]
    );

    if (existingRequest.rows.length === 0) {
      await client.query(
        "INSERT INTO member_requests (user_id, dorm_id, request_date, status) VALUES ($1, $2, CURRENT_TIMESTAMP, 'รออนุมัติ')",
        [user.id, new_dorm_id]
      );
    }

    // อัพเดตประวัติการเข้าพัก
    await stayController.updateStayHistoryOnMove(user.id, oldDormId, new_dorm_id);

    await client.query('COMMIT');

    res.json({ 
      message: "เปลี่ยนหอพักสำเร็จ รอการอนุมัติจากเจ้าของหอพัก",
      new_dorm_name: dormResult.rows[0].dorm_name
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error changing dormitory:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  } finally {
    client.release();
  }
};
