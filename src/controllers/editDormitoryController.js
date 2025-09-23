// src/controllers/editDormitoryController.js
const pool = require("../db");

// อัพเดตข้อมูลหอพักพื้นฐาน (owner)
exports.updateDormitory = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId } = req.params;
    const firebase_uid = req.user.uid;

    const userResult = await client.query(
      "SELECT id, member_type FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }
    const userId = userResult.rows[0].id;

    const dormResult = await client.query(
      "SELECT dorm_id FROM dormitories WHERE dorm_id = $1 AND owner_id = $2",
      [dormId, userId]
    );
    if (dormResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
    }

    // ตรวจสอบข้อมูลพื้นฐาน
    const { 
      dormName, 
      zoneId, 
      address, 
      description,
      latitude,
      longitude,
      electricityType,
      electricityRate,
      waterType,
      waterRate
    } = req.body;
    const errors = [];

    if (!dormName) errors.push("กรุณากรอกชื่อหอพัก");
    if (!zoneId) errors.push("กรุณาเลือกโซน");
    if (!address) errors.push("กรุณากรอกที่อยู่");
    if (!description) errors.push("กรุณากรอกรายละเอียดหอพัก");

    if (errors.length > 0) {
      return res
        .status(400)
        .json({ message: "ข้อมูลไม่ถูกต้อง", errors: errors });
    }

    await client.query("BEGIN");
    const updateQuery = `
      UPDATE dormitories
      SET dorm_name = $1,
          zone_id = $2,
          address = $3,
          dorm_description = $4,
          latitude = $5,
          longitude = $6,
          electricity_type = $7,
          electricity_rate = $8,
          water_type = $9,
          water_rate = $10,
          updated_date = NOW()
      WHERE dorm_id = $11
    `;
    await client.query(updateQuery, [
      dormName.trim(),
      zoneId,
      address.trim(),
      description.trim(),
      latitude || null,
      longitude || null,
      electricityType || null,
      electricityRate || null,
      waterType || null,
      waterRate || null,
      dormId,
    ]);
    await client.query("COMMIT");

    res.json({ message: "ข้อมูลหอพักถูกอัพเดตเรียบร้อยแล้ว", dormId });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error updating dormitory:", error);
    res
      .status(500)
      .json({
        message: "เกิดข้อผิดพลาดในการอัพเดตข้อมูลหอพัก",
        error: error.message,
      });
  } finally {
    client.release();
  }
};

// ดูรายละเอียดหอพักที่ส่งไปแล้ว
exports.getDormitoryDetails = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId } = req.params;
    const firebase_uid = req.user.uid;

    // ตรวจสอบสิทธิ์ผู้ใช้ (เฉพาะเจ้าของหอพักหรือผู้ดูแลระบบที่สามารถดูได้)
    const userResult = await client.query(
      "SELECT id, member_type FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const user = userResult.rows[0];
    const userId = user.id;

    // ตรวจสอบว่าหอพักนี้เป็นของผู้ใช้หรือไม่ (สำหรับเจ้าของหอพัก)
    const dormResult = await client.query(
      `
            SELECT 
                d.dorm_id,
                d.dorm_name,
                d.address,
                d.dorm_description,
                d.latitude,
                d.longitude,
                d.bed_type,
                d.rental_type,
                d.electricity_type,
                d.electricity_rate,
                d.water_type,
                d.water_rate,
                d.monthly_price,
                d.daily_price,
                d.approval_status,
                d.created_date,
                z.zone_name,
                (SELECT image_url FROM dormitory_images WHERE dorm_id = d.dorm_id AND is_primary = true LIMIT 1) as main_image_url
            FROM dormitories d
            LEFT JOIN zones z ON d.zone_id = z.zone_id
            WHERE d.dorm_id = $1 AND (d.owner_id = $2 OR $3 = 'admin')
            `,
      [dormId, userId, user.member_type]
    );

    if (dormResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
    }

    const dormitory = dormResult.rows[0];

    // 2. ดึงข้อมูลห้องพัก (room types) ที่เกี่ยวข้องกับหอพักนี้
    const roomTypesResult = await client.query(
      `
            SELECT 
                rt.room_type_id,
                rt.room_name,
                rt.bed_type,
                rt.size_sqm,
                rt.monthly_price,
                rt.daily_price,
                rt.summer_price,
                rt.term_price,
                rt.max_occupancy
            FROM room_types rt
            WHERE rt.dorm_id = $1
            `,
      [dormId]
    );

    // 3. ดึงข้อมูลสิ่งอำนวยความสะดวก (amenities) ที่เกี่ยวข้องกับหอพักนี้
    const amenitiesResult = await client.query(
      `
            SELECT 
                da.dorm_amenity_id,
                da.amenity_id, 
                da.location_type,
                da.custom_amenity_name,
                da.is_available,
                a.amenity_name
            FROM dormitory_amenities da
            LEFT JOIN amenities a ON da.amenity_id = a.amenity_id
            WHERE da.dorm_id = $1
            ORDER BY da.location_type, a.amenity_name
            `,
      [dormId]
    );

    // 4. ดึงข้อมูลช่องทางติดต่อ (contact information)
    let contactInfo = null;
    if (dormitory.contact_id) {
      const contactResult = await client.query(
        `
                SELECT manager_name, primary_phone, secondary_phone, line_id, email
                FROM contact_info
                WHERE contact_id = $1
                `,
        [dormitory.contact_id]
      );

      if (contactResult.rows.length > 0) {
        contactInfo = contactResult.rows[0];
      }
    }

    res.json({
      ...dormitory,
      roomTypes: roomTypesResult.rows,
      amenities: amenitiesResult.rows,
      contactInfo,
    });
  } catch (error) {
    console.error("Error fetching dormitory details:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลหอพัก" });
  } finally {
    client.release();
  }
};

// แก้ไขข้อมูลหอพักที่ส่งไปแล้ว
exports.editDormitory = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId } = req.params;
    const firebase_uid = req.user.uid;

    // ตรวจสอบสิทธิ์ผู้ใช้ (เฉพาะเจ้าของหอพักหรือผู้ดูแลระบบที่สามารถแก้ไขได้)
    const userResult = await client.query(
      "SELECT id, member_type FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const user = userResult.rows[0];
    const userId = user.id;

    // ตรวจสอบว่าหอพักนี้เป็นของผู้ใช้หรือไม่ (สำหรับเจ้าของหอพัก)
    const dormResult = await client.query(
      `
            SELECT 
                d.dorm_id,
                d.dorm_name,
                d.address,
                d.dorm_description,
                d.latitude,
                d.longitude,
                d.bed_type,
                d.rental_type,
                d.electricity_type,
                d.electricity_rate,
                d.water_type,
                d.water_rate,
                d.monthly_price,
                d.daily_price,
                d.approval_status,
                d.created_date,
                z.zone_name,
                (SELECT image_url FROM dormitory_images WHERE dorm_id = d.dorm_id AND is_primary = true LIMIT 1) as main_image_url
            FROM dormitories d
            LEFT JOIN zones z ON d.zone_id = z.zone_id
            WHERE d.dorm_id = $1 AND (d.owner_id = $2 OR $3 = 'admin')
            `,
      [dormId, userId, user.member_type]
    );

    if (dormResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
    }

    const dormitory = dormResult.rows[0];

    // อนุญาตให้แก้ไขเฉพาะข้อมูลที่ไม่เกี่ยวข้องกับการอนุมัติ (approval_status) เท่านั้น
    const {
      dormName,
      zoneId,
      address,
      description,
      bedType,
      rentalType,
      electricityType,
      electricityRate,
      waterType,
      waterRate,
      monthlyPrice,
      dailyPrice,
      latitude,
      longitude,
      amenities,
      contactInfo,
      roomTypes,
    } = req.body;

    await client.query("BEGIN");

    // 1. Update dormitory details
    const dormQuery = `
            UPDATE dormitories
            SET 
                dorm_name = $1,
                zone_id = $2,
                address = $3,
                dorm_description = $4,
                latitude = $5,
                longitude = $6,
                bed_type = $7,
                rental_type = $8,
                electricity_type = $9,
                electricity_rate = $10,
                water_type = $11,
                water_rate = $12,
                monthly_price = $13,
                daily_price = $14,
                updated_date = NOW()
            WHERE dorm_id = $15
        `;

    await client.query(dormQuery, [
      dormName.trim(),
      zoneId,
      address.trim(),
      description.trim(),
      parseFloat(latitude),
      parseFloat(longitude),
      bedType,
      rentalType,
      electricityType,
      electricityRate || null,
      waterType,
      waterRate || null,
      monthlyPrice || null,
      dailyPrice || null,
      dormId,
    ]);

    // 2. Update contact information if provided
    if (contactInfo) {
      await client.query(
        `
                UPDATE contact_info
                SET 
                    manager_name = $1,
                    primary_phone = $2,
                    secondary_phone = $3,
                    line_id = $4,
                    email = $5
                WHERE contact_id = $6
                `,
        [
          contactInfo.managerName,
          contactInfo.primaryPhone,
          contactInfo.secondaryPhone || null,
          contactInfo.lineId || null,
          contactInfo.email,
          dormitory.contact_id,
        ]
      );
    }

    // 3. Update amenities
    if (amenities && amenities.length > 0) {
      // Set all existing amenities to unavailable first
      await client.query(
        `UPDATE dormitory_amenities SET is_available = false WHERE dorm_id = $1`,
        [dormId]
      );

      const amenityPromises = amenities.map((amenity) => {
        const amenityId = typeof amenity === 'object' ? amenity.amenity_id : amenity;
        const locationType = typeof amenity === 'object' ? amenity.location_type || 'indoor' : 'indoor';
        
        return client.query(
          `INSERT INTO dormitory_amenities (dorm_id, amenity_id, location_type, is_available) VALUES ($1, $2, $3, $4)
                     ON CONFLICT (dorm_id, amenity_id) DO UPDATE SET 
                     location_type = excluded.location_type,
                     is_available = excluded.is_available`,
          [dormId, amenityId, locationType, true]
        );
      });
      await Promise.all(amenityPromises);
    }

    // 4. Update room types
    if (roomTypes && roomTypes.length > 0) {
      // Disable all existing room types first
      await client.query(
        `UPDATE room_types SET is_available = false WHERE dorm_id = $1`,
        [dormId]
      );

      const roomTypePromises = roomTypes.map((roomType) => {
        // Handle price values - convert "ติดต่อสอบถาม" to null, keep numbers as is
        const monthlyPrice =
          roomType.monthlyPrice === "ติดต่อสอบถาม"
            ? null
            : roomType.monthlyPrice;
        const dailyPrice =
          roomType.dailyPrice === "ติดต่อสอบถาม" ? null : roomType.dailyPrice;
        const summerPrice =
          roomType.summerPrice === "ติดต่อสอบถาม" ? null : roomType.summerPrice;

        return client.query(
          `
                    INSERT INTO room_types (
                        dorm_id, room_name, bed_type, size_sqm, monthly_price,
                        daily_price, summer_price, max_occupancy
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (dorm_id, room_name) DO UPDATE SET
                        bed_type = excluded.bed_type,
                        size_sqm = excluded.size_sqm,
                        monthly_price = excluded.monthly_price,
                        daily_price = excluded.daily_price,
                        summer_price = excluded.summer_price,
                        max_occupancy = excluded.max_occupancy,
                        is_available = true
                `,
          [
            dormId,
            roomType.roomName?.trim(),
            roomType.bedType,
            roomType.sizeSqm || null,
            monthlyPrice,
            dailyPrice,
            summerPrice,
            roomType.maxOccupancy || null,
          ]
        );
      });
      await Promise.all(roomTypePromises);
    }

    await client.query("COMMIT");

    res.json({ message: "ข้อมูลหอพักถูกแก้ไขเรียบร้อยแล้ว" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error editing dormitory:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการแก้ไขข้อมูลหอพัก" });
  } finally {
    client.release();
  }
};

// แก้ไขข้อมูลประเภทห้อง
exports.updateRoomType = async (req, res) => {
    try {
      const { roomTypeId } = req.params;
  
      // อ่านค่า dorm_id เพื่อใช้อัพเดตช่วงราคา
      const dormResult = await pool.query(
        "SELECT dorm_id FROM room_types WHERE room_type_id = $1",
        [roomTypeId]
      );
      if (dormResult.rows.length === 0) {
        return res.status(404).json({ message: 'ไม่พบข้อมูลประเภทห้อง' });
      }
      const dormId = dormResult.rows[0].dorm_id;
  
      // รองรับ bedType เป็น alias ของ bed_type
      const { 
         room_name,
         bed_type,
         bedType,
         monthly_price,
         daily_price,
         summer_price,
         term_price,
       } = req.body;
  
      const updateFields = [];
      const values = [];
      let p = 1;
  
      if (room_name !== undefined) { updateFields.push(`room_name = $${p++}`); values.push(room_name); }
      if (bed_type !== undefined || bedType !== undefined) {
        updateFields.push(`bed_type = $${p++}`); values.push(bed_type ?? bedType);
      }
      if (monthly_price !== undefined) { updateFields.push(`monthly_price = $${p++}`); values.push(monthly_price); }
      if (daily_price   !== undefined) { updateFields.push(`daily_price = $${p++}`);   values.push(daily_price); }
      if (summer_price  !== undefined) { updateFields.push(`summer_price = $${p++}`);  values.push(summer_price); }
      if (term_price    !== undefined) { updateFields.push(`term_price = $${p++}`);    values.push(term_price); }
  
      if (updateFields.length === 0) {
        return res.status(400).json({ message: 'ไม่มีข้อมูลสำหรับอัพเดต' });
      }
  
      const sql = `
        UPDATE room_types
        SET ${updateFields.join(', ')}
        WHERE room_type_id = $${p}
        RETURNING *
      `;
      values.push(roomTypeId);
  
      const result = await pool.query(sql, values);
      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'ไม่พบข้อมูลประเภทห้อง' });
      }
  
      await updateDormitoryPriceRange(dormId);
  
      res.json({ message: 'อัพเดตข้อมูลประเภทห้องสำเร็จ', roomType: result.rows[0] });
    } catch (error) {
      console.error('Error updating room type:', error);
      res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
  };
  

// ฟังก์ชันช่วยอัพเดตช่วงราคาของหอพัก
exports.updateDormitoryPriceRange = async function updateDormitoryPriceRange(dormId) {
  try {
    // หาราคาต่ำสุดและสูงสุดของประเภทห้องในหอพัก
    const priceRangeQuery = `
      SELECT 
        ROUND(MIN(monthly_price))::integer as min_price,
        ROUND(MAX(monthly_price))::integer as max_price
      FROM room_types
      WHERE dorm_id = $1 AND monthly_price IS NOT NULL
    `;

    const priceRangeResult = await pool.query(priceRangeQuery, [dormId]);
    const { min_price, max_price } = priceRangeResult.rows[0];

    // อัพเดตราคาในตาราง dormitories
    const updateQuery = `
      UPDATE dormitories
      SET min_price = $1,
          max_price = $2,
          updated_date = CURRENT_TIMESTAMP
      WHERE dorm_id = $3
    `;

    await pool.query(updateQuery, [min_price, max_price, dormId]);

    return true;
  } catch (error) {
    console.error('Error updating dormitory price range:', error);
    throw error;
  }
}
