// src/controllers/AddDormitoryController.js
const pool = require("../db");
const storageService = require("../services/storageService");

function normalizeBasicFields(req) {
  const body = req.body || {};

  // รับตามหน้าบ้านแบบเดียว: snake_case top-level เท่านั้น
  const dormName = (body.dorm_name ?? "").toString().trim();
  const zoneIdRaw = body.zone_id;
  const zoneId =
    zoneIdRaw === undefined || zoneIdRaw === null || zoneIdRaw === ""
      ? null
      : parseInt(zoneIdRaw, 10);
  const address = (body.address ?? "").toString().trim();
  const description = (body.dorm_description ?? "").toString().trim();
  
  // ข้อมูลใหม่ที่หน้าบ้านส่งมา
  const electricityType = body.electricity_type || "คิดตามหน่วย";
  const electricityRate = body.electricity_rate ? parseFloat(body.electricity_rate) : 0;
  const waterType = body.water_type || "คิดตามหน่วย";
  const waterRate = body.water_rate ? parseFloat(body.water_rate) : 0;
  const latitude = body.latitude ? parseFloat(body.latitude) : null;
  const longitude = body.longitude ? parseFloat(body.longitude) : null;
  const amenities = Array.isArray(body.amenities) ? body.amenities : [];

  return { 
    dormName, 
    zoneId, 
    address, 
    description, 
    electricityType, 
    electricityRate, 
    waterType, 
    waterRate, 
    latitude, 
    longitude, 
    amenities 
  };
}

// ตรวจสอบข้อมูลพื้นฐานของหอพัก (ชื่อ, โซน, ที่อยู่, รายละเอียด)
const validateBasicDormitoryInfo = (req) => {
  const { dormName, zoneId, address, description } = normalizeBasicFields(req);
  const errors = [];

  if (!dormName) errors.push("กรุณากรอกชื่อหอพัก");
  if (
    zoneId === null ||
    zoneId === undefined ||
    !Number.isInteger(zoneId) ||
    zoneId <= 0
  ) {
    errors.push("กรุณาเลือกโซน");
  }
  if (!address) errors.push("กรุณากรอกที่อยู่");
  if (!description) errors.push("กรุณากรอกรายละเอียดหอพัก");

  return errors;
};

// ฟังก์ชันหลักสำหรับเพิ่มข้อมูลหอพัก (เริ่มจากข้อมูลพื้นฐาน)
exports.addDormitory = async (req, res) => {
  const client = await pool.connect();
  try {
    const firebase_uid = req.user.uid;

    // ตรวจสอบว่าเป็น owner
    const userResult = await client.query(
      "SELECT id, member_type FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }
    const user = userResult.rows[0];
    if (user.member_type !== "owner") {
      return res.status(403).json({
        message: "เฉพาะเจ้าของหอพักเท่านั้นที่สามารถเพิ่มข้อมูลหอพักได้",
      });
    }

    // ตรวจสอบข้อมูลพื้นฐาน
    const validationErrors = validateBasicDormitoryInfo(req);
    if (validationErrors.length > 0) {
      const dbg = normalizeBasicFields(req);
      console.warn("[addDormitory] Validation failed");
      return res.status(400).json({
        message: "ข้อมูลไม่ถูกต้อง",
        errors: validationErrors,
        normalized: dbg,
      });
    }

    await client.query("BEGIN");

    const { 
      dormName, 
      zoneId, 
      address, 
      description, 
      electricityType, 
      electricityRate, 
      waterType, 
      waterRate, 
      latitude, 
      longitude, 
      amenities 
    } = normalizeBasicFields(req);

    // เพิ่มข้อมูลหอพักพื้นฐาน
    const dormQuery = `
      INSERT INTO dormitories (
        dorm_name,
        zone_id,
        address,
        dorm_description,
        electricity_type,
        electricity_rate,
        water_type,
        water_rate,
        latitude,
        longitude,
        approval_status,
        owner_id,
        created_date
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      RETURNING dorm_id
    `;
    const dormResult = await client.query(dormQuery, [
      dormName,
      zoneId,
      address,
      description,
      electricityType,
      electricityRate,
      waterType,
      waterRate,
      latitude,
      longitude,
      "รออนุมัติ",
      user.id,
    ]);
    const dormId = dormResult.rows[0].dorm_id;

    // เพิ่มสิ่งอำนวยความสะดวก (ถ้ามี)
    if (amenities && amenities.length > 0) {
      console.log(`[addDormitory] Inserting amenities: ${amenities.length} items for dorm ${dormId}`);
      
      for (const amenity of amenities) {
        const amenityId = amenity.amenity_id || amenity.id;
        const locationType = amenity.location_type || 'indoor';
        const amenityName = amenity.amenity_name || null;
        
        await client.query(
          `INSERT INTO dormitory_amenities (dorm_id, amenity_id, location_type, amenity_name, is_available) 
           VALUES ($1, $2, $3, $4, $5)`,
          [dormId, amenityId, locationType, amenityName, true]
        );
      }
    }

    const providedRoomTypes = Array.isArray(req.body?.roomTypes)
      ? req.body.roomTypes
      : Array.isArray(req.body?.room_types)
      ? req.body.room_types
      : [];

    const toNumberOrNull = (v) => {
      if (v === undefined || v === null) return null;
      if (typeof v === "string") {
        const t = v.trim();
        if (t === "" || t === "ติดต่อสอบถาม") return null;
        const n = Number(t.replace(/[\,\s]/g, ""));
        return Number.isFinite(n) ? n : null;
      }
      return Number.isFinite(Number(v)) ? Number(v) : null;
    };

    if (providedRoomTypes.length > 0) {
      console.log(
        `[addDormitory] Inserting room types: ${providedRoomTypes.length} items for dorm ${dormId}`
      );
      for (const rt of providedRoomTypes) {
        const name = (rt.name ?? rt.roomName ?? rt.room_name ?? "")
          .toString()
          .trim();
        if (!name) continue;

        // << สำคัญ: รองรับทั้ง bedType และ bed_type จากหน้าบ้าน >>
        const bed_type = rt.bed_type ?? rt.bedType ?? null;

        const monthly_price = toNumberOrNull(
          rt.monthly_price ?? rt.monthlyPrice
        );
        const daily_price = toNumberOrNull(rt.daily_price ?? rt.dailyPrice);
        const summer_price = toNumberOrNull(rt.summer_price ?? rt.summerPrice);
        const term_price = toNumberOrNull(rt.term_price ?? rt.termPrice);

        await client.query(
          `
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
    `,
          [
            dormId,
            name,
            bed_type,
            monthly_price,
            daily_price,
            summer_price,
            term_price,
          ]
        );
      }

      // อัพเดตช่วงราคารายเดือนใน dormitories (ถ้ามี monthly_price)
      await client.query(
        `
  UPDATE dormitories d
  SET min_price = sub.min_price,
      max_price = sub.max_price,
      updated_date = CURRENT_TIMESTAMP
  FROM (
    SELECT dorm_id,
           ROUND(MIN(monthly_price))::int AS min_price,
           ROUND(MAX(monthly_price))::int AS max_price
    FROM room_types
    WHERE dorm_id = $1 AND monthly_price IS NOT NULL
    GROUP BY dorm_id
  ) sub
  WHERE d.dorm_id = sub.dorm_id
  `,
        [dormId]
      );
    } else {
      console.log(`[addDormitory] No room types provided for dorm ${dormId}`);
    }

    await client.query("COMMIT");

    res.status(201).json({
      message:
        "ข้อมูลพื้นฐานหอพักถูกเพิ่มเรียบร้อยแล้ว รอการอนุมัติจากผู้ดูแลระบบ",
      dorm_id: dormId,
      status: "รอพิจารณา",
      nextStep: "เพิ่มข้อมูลเพิ่มเติม (ราคา, สิ่งอำนวยความสะดวก, รูปภาพ)",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[addDormitory] Error adding dormitory:", error);
    res.status(500).json({
      message: "เกิดข้อผิดพลาดในการเพิ่มข้อมูลหอพัก",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// ดึงข้อมูลหอพัก (owner)
exports.getDormitory = async (req, res) => {
  try {
    const { dormId } = req.params;
    const firebase_uid = req.user.uid;

    const userResult = await pool.query(
      "SELECT id, member_type FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }
    const userId = userResult.rows[0].id;

    const query = `
      SELECT d.dorm_id, d.dorm_name, d.zone_id, d.address,
             d.dorm_description, d.approval_status, d.created_date, z.zone_name
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      WHERE d.dorm_id = $1 AND d.owner_id = $2
    `;
    const result = await pool.query(query, [dormId, userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching dormitory:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลหอพัก" });
  }
};

// ดูรายการหอพักของ owner พร้อมสรุปราคา (min รายเดือน และ min รายวัน) + สมาชิก
exports.getMyDormitories = async (req, res) => {
  try {
    const firebase_uid = req.user.uid;
    const userResult = await pool.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }
    const userId = userResult.rows[0].id;

    const dormsQuery = `
      SELECT
        d.dorm_id,
        d.dorm_name,
        d.address,
        d.approval_status,
        d.created_date AS submitted_date,
        to_char(COALESCE(d.updated_date, d.created_date), 'YYYY-MM-DD') AS updated_date,
        (SELECT MIN(rt.monthly_price)::int FROM room_types rt
          WHERE rt.dorm_id = d.dorm_id AND rt.monthly_price IS NOT NULL) AS monthly_min_price,
        (SELECT MIN(rt.daily_price)::int FROM room_types rt
          WHERE rt.dorm_id = d.dorm_id AND rt.daily_price IS NOT NULL) AS daily_min_price,
        z.zone_name,
        (SELECT image_url FROM dormitory_images
         WHERE dorm_id = d.dorm_id
         ORDER BY is_primary DESC, upload_date DESC, image_id ASC
         LIMIT 1) AS main_image_url
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      WHERE d.owner_id = $1
      ORDER BY d.created_date DESC
    `;
    const dormsResult = await pool.query(dormsQuery, [userId]);
    const dorms = dormsResult.rows;

    const dormIds = dorms.map((d) => d.dorm_id);
    let membersByDorm = {};
    let pendingRequestsByDorm = {};

    if (dormIds.length > 0) {
      const membersQuery = `
        SELECT u.id, u.display_name, u.email, u.residence_dorm_id
        FROM users u
        WHERE u.residence_dorm_id = ANY($1::int[])
      `;
      const membersResult = await pool.query(membersQuery, [dormIds]);
      membersByDorm = dormIds.reduce((acc, dormId) => {
        acc[dormId] = membersResult.rows.filter(
          (m) => m.residence_dorm_id === dormId
        );
        return acc;
      }, {});
      const pendingQuery = `
        SELECT mr.dorm_id, COUNT(*) as pending_count
        FROM member_requests mr
        WHERE mr.dorm_id = ANY($1::int[]) AND mr.status = 'รออนุมัติ'
        GROUP BY mr.dorm_id
      `;
      const pendingResult = await pool.query(pendingQuery, [dormIds]);
      pendingRequestsByDorm = pendingResult.rows.reduce((acc, row) => {
        acc[row.dorm_id] = parseInt(row.pending_count);
        return acc;
      }, {});
    }

    const dormsWithMembers = dorms.map((dorm) => ({
      ...dorm,
      member_count: (membersByDorm[dorm.dorm_id] || []).length,
      pending_request_count: pendingRequestsByDorm[dorm.dorm_id] || 0,
      total_related_users:
        (membersByDorm[dorm.dorm_id] || []).length +
        (pendingRequestsByDorm[dorm.dorm_id] || 0),
      members: membersByDorm[dorm.dorm_id] || [],
    }));

    res.json(dormsWithMembers);
  } catch (error) {
    console.error("Error fetching my dormitories:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// ตัวเลือกประเภทห้อง (owner form)
exports.getRoomTypeOptions = async (_req, res) => {
  try {
    const roomTypes = [
      "ห้องพัดลม + เตียงเดี่ยว",
      "ห้องพัดลม + เตียงคู่",
      "ห้องแอร์ + เตียงเดี่ยว",
      "ห้องแอร์ + เตียงคู่",
      "อื่นๆ",
    ];
    res.json(roomTypes);
  } catch (error) {
    console.error("Error fetching room type options:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};

// ฟังก์ชันส่งข้อมูลหอพัก (อัปโหลดภาพหลักได้)
exports.submitDormitory = async (req, res) => {
  const client = await pool.connect();
  try {
    const firebase_uid = req.user.uid;

    const userResult = await client.query(
      "SELECT id, member_type FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }
    const user = userResult.rows[0];
    if (user.member_type !== "owner") {
      return res.status(403).json({
        message: "เฉพาะเจ้าของหอพักเท่านั้นที่สามารถเพิ่มข้อมูลหอพักได้",
      });
    }

    const validationErrors = validateBasicDormitoryInfo(req);
    if (validationErrors.length > 0) {
      return res
        .status(400)
        .json({ message: "ข้อมูลไม่ถูกต้อง", errors: validationErrors });
    }

    await client.query("BEGIN");

    const { dormName, zoneId, address, description } =
      normalizeBasicFields(req);

    const dormQuery = `
      INSERT INTO dormitories (
        dorm_name, zone_id, address, dorm_description,
        approval_status, owner_id, created_date
      ) VALUES ($1,$2,$3,$4,$5,$6,NOW())
      RETURNING dorm_id
    `;
    const dormResult = await client.query(dormQuery, [
      dormName.trim(),
      zoneId,
      address.trim(),
      description.trim(),
      "รออนุมัติ",
      user.id,
    ]);
    const dormId = dormResult.rows[0].dorm_id;

    // อัปโหลดรูปภาพหลัก (ถ้ามี)
    if (req.files && req.files.length > 0) {
      const file = req.files[0];
      const imageUrl = await storageService.uploadDormitoryImage(file, dormName.trim());
      await client.query(
        `INSERT INTO dormitory_images (dorm_id, image_url, is_primary, upload_date)
         VALUES ($1,$2,$3,NOW())`,
        [dormId, imageUrl, true]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({
      message:
        "ข้อมูลพื้นฐานหอพักถูกเพิ่มเรียบร้อยแล้ว รอการอนุมัติจากผู้ดูแลระบบ",
      dormId,
      status: "รอพิจารณา",
      nextStep: "เพิ่มข้อมูลเพิ่มเติม (ราคา, สิ่งอำนวยความสะดวก, รูปภาพ)",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error submitting dormitory:", error);
    res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดในการส่งข้อมูล", error: error.message });
  } finally {
    client.release();
  }
};

// ดูรายการหอพักที่ตัวเองส่งไป (owner)
exports.getMySubmissions = async (req, res) => {
  try {
    const firebase_uid = req.user.uid;
    const userResult = await pool.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebase_uid]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }
    const userId = userResult.rows[0].id;

    const query = `
      SELECT d.dorm_id, d.dorm_name, d.address, d.approval_status,
             d.created_date AS submitted_date, z.zone_name,
             (SELECT image_url FROM dormitory_images
              WHERE dorm_id = d.dorm_id AND is_primary = true LIMIT 1) AS main_image_url
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      WHERE d.owner_id = $1
      ORDER BY d.created_date DESC
    `;
    const result = await pool.query(query, [userId]);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching my submissions:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
  }
};
