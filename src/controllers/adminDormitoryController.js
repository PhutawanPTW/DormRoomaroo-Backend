const pool = require('../db');

const MAIN_IMAGE_SUBQUERY = `(
  SELECT image_url FROM dormitory_images
  WHERE dorm_id = d.dorm_id
  ORDER BY is_primary DESC, upload_date DESC, image_id ASC
  LIMIT 1
) AS main_image_url`;

// ดึงรายการหอพักทั้งหมดสำหรับแอดมิน (รวมถึงหอพักที่ยังไม่ได้อนุมัติ)
exports.getAllDormitoriesAdmin = async (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT 
        d.*,
        z.zone_name,
        c.manager_name,
        c.primary_phone,
        c.secondary_phone,
        c.line_id,
        c.email as contact_email,
        ${MAIN_IMAGE_SUBQUERY}
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      LEFT JOIN contact_info c ON d.contact_id = c.contact_id
    `;

    const values = [];
    if (status) {
      values.push(status);
      query += ` WHERE d.approval_status = $1`;
    }

    query += ' ORDER BY d.updated_date DESC NULLS LAST';

    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dormitories for admin:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// อนุมัติหอพัก
exports.approveDormitory = async (req, res) => {
  try {
    const { dormId } = req.params;

    const updateQuery = `
      UPDATE dormitories
      SET approval_status = 'อนุมัติแล้ว', updated_date = CURRENT_TIMESTAMP
      WHERE dorm_id = $1
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [dormId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลหอพัก' });
    }

    res.json({
      message: 'อนุมัติหอพักเรียบร้อยแล้ว',
      dormitory: result.rows[0]
    });
  } catch (error) {
    console.error('Error approving dormitory:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// ปฏิเสธหอพัก
exports.rejectDormitory = async (req, res) => {
  try {
    const { dormId } = req.params;
    const { rejectionReason } = req.body;

    if (!rejectionReason) {
      return res.status(400).json({ message: 'กรุณาระบุเหตุผลในการปฏิเสธ' });
    }

    const updateQuery = `
      UPDATE dormitories
      SET approval_status = 'ไม่อนุมัติ', 
          rejection_reason = $2,
          updated_date = CURRENT_TIMESTAMP
      WHERE dorm_id = $1
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [dormId, rejectionReason]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลหอพัก' });
    }

    res.json({
      message: 'ปฏิเสธหอพักเรียบร้อยแล้ว',
      dormitory: result.rows[0]
    });
  } catch (error) {
    console.error('Error rejecting dormitory:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// แก้ไขข้อมูลหอพักโดยแอดมิน
exports.updateDormitoryByAdmin = async (req, res) => {
  try {
    const { dormId } = req.params;
    const updateData = req.body;

    // ตรวจสอบว่ามีข้อมูลที่ต้องการอัพเดต
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: 'ไม่มีข้อมูลสำหรับอัพเดต' });
    }

    // สร้างคำสั่ง SQL สำหรับอัพเดต
    const updateFields = [];
    const values = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(updateData)) {
      // แปลงชื่อฟิลด์จาก camelCase เป็น snake_case สำหรับ DB
      const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      updateFields.push(`${dbField} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }

    // เพิ่ม updated_date
    updateFields.push(`updated_date = CURRENT_TIMESTAMP`);

    const query = `
      UPDATE dormitories
      SET ${updateFields.join(', ')}
      WHERE dorm_id = $${paramCount}
      RETURNING *
    `;

    values.push(dormId);

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลหอพัก' });
    }

    res.json({
      message: 'อัพเดตข้อมูลหอพักเรียบร้อยแล้ว',
      dormitory: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating dormitory by admin:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

// ลบหอพักโดยแอดมิน
exports.deleteDormitoryByAdmin = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId } = req.params;

    await client.query('BEGIN');

    // 1. ลบรูปภาพที่เกี่ยวข้อง
    await client.query('DELETE FROM dormitory_images WHERE dorm_id = $1', [dormId]);

    // 2. ลบประเภทห้องที่เกี่ยวข้อง
    await client.query('DELETE FROM room_types WHERE dorm_id = $1', [dormId]);

    // 3. ลบข้อมูลหอพัก (ถ้ามี contact_info ที่เกี่ยวข้อง)
    const contactInfoResult = await client.query(
      'SELECT contact_id FROM dormitories WHERE dorm_id = $1',
      [dormId]
    );

    // 4. ลบหอพัก
    const result = await client.query(
      'DELETE FROM dormitories WHERE dorm_id = $1 RETURNING *',
      [dormId]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'ไม่พบข้อมูลหอพัก' });
    }

    // 5. ลบข้อมูลการติดต่อที่เกี่ยวข้อง (ถ้ามี)
    if (contactInfoResult.rows.length > 0 && contactInfoResult.rows[0].contact_id) {
      await client.query(
        'DELETE FROM contact_info WHERE contact_id = $1',
        [contactInfoResult.rows[0].contact_id]
      );
    }

    await client.query('COMMIT');

    res.json({
      message: 'ลบข้อมูลหอพักเรียบร้อยแล้ว',
      dormitory: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting dormitory by admin:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  } finally {
    client.release();
  }
};

// ดูรายละเอียดหอพักโดยแอดมิน
exports.getDormitoryDetailsByAdmin = async (req, res) => {
  try {
    const { dormId } = req.params;

    const query = `
      SELECT 
        d.*,
        z.zone_name,
        c.manager_name,
        c.primary_phone,
        c.secondary_phone,
        c.line_id,
        c.email as contact_email,
        (SELECT json_agg(rt.*) FROM room_types rt WHERE rt.dorm_id = d.dorm_id) as room_types,
        (SELECT json_agg(
          json_build_object(
            'image_id', di.image_id,
            'image_url', di.image_url,
            'image_type', di.image_type,
            'is_primary', di.is_primary
          )
        ) FROM dormitory_images di WHERE di.dorm_id = d.dorm_id) as images
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      LEFT JOIN contact_info c ON d.contact_id = c.contact_id
      WHERE d.dorm_id = $1
    `;

    const result = await pool.query(query, [dormId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลหอพัก' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching dormitory details for admin:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
}; 