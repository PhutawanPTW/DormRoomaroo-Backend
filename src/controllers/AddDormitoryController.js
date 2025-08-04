// src/controllers/addDormitoryController.js
const pool = require('../db');
const storageService = require('../services/storageService');

// ============== ฟังก์ชันหลักสำหรับเพิ่มข้อมูลหอพัก ==============

// ตรวจสอบข้อมูลพื้นฐานของหอพัก (ชื่อ, โซน, ที่อยู่, รายละเอียด)
const validateBasicDormitoryInfo = (req) => {
    const {
        dormName,
        zoneId,
        address,
        description
    } = req.body;

    const errors = [];

    // ตรวจสอบข้อมูลพื้นฐานที่จำเป็น
    if (!dormName?.trim()) {
        errors.push('กรุณากรอกชื่อหอพัก');
    }
    if (!zoneId) {
        errors.push('กรุณาเลือกโซน');
    }
    if (!address?.trim()) {
        errors.push('กรุณากรอกที่อยู่');
    }
    if (!description?.trim()) {
        errors.push('กรุณากรอกรายละเอียดหอพัก');
    }

    return errors;
};

// ฟังก์ชันหลักสำหรับเพิ่มข้อมูลหอพัก (เริ่มจากข้อมูลพื้นฐาน)
exports.addDormitory = async (req, res) => {
    const client = await pool.connect();
    try {
        const firebase_uid = req.user.uid;
        
        // ตรวจสอบว่าผู้ใช้เป็น owner
        const userResult = await client.query(
            'SELECT id, user_id, member_type FROM users WHERE firebase_uid = $1',
            [firebase_uid]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลผู้ใช้' });
        }
        
        const user = userResult.rows[0];
        const userId = user.id !== null && user.id !== undefined ? user.id : user.user_id;
        
        if (user.member_type !== 'owner') {
            return res.status(403).json({ message: 'เฉพาะเจ้าของหอพักเท่านั้นที่สามารถเพิ่มข้อมูลหอพักได้' });
        }

        // ตรวจสอบข้อมูลพื้นฐาน
        const validationErrors = validateBasicDormitoryInfo(req);
        if (validationErrors.length > 0) {
            return res.status(400).json({ 
                message: 'ข้อมูลไม่ถูกต้อง', 
                errors: validationErrors 
            });
        }

        await client.query('BEGIN');

        const {
            dormName,
            zoneId,
            address,
            description
            // ส่วนอื่นๆ จะเพิ่มในภายหลัง เช่น:
            // bedType,
            // rentalType,
            // electricityType,
            // electricityRate,
            // waterType,
            // waterRate,
            // latitude,
            // longitude,
            // contactInfo,
            // roomTypes,
            // amenities
        } = req.body;

        // เพิ่มข้อมูลหอพักพื้นฐาน (สถานะรอพิจารณา)
        const dormQuery = `
            INSERT INTO dormitories (
                dorm_name, 
                zone_id, 
                address, 
                dorm_description, 
                approval_status, 
                submitted_by, 
                submitted_date
                // ส่วนอื่นๆ จะเพิ่มในภายหลัง เช่น:
                // bed_type,
                // rental_type,
                // electricity_type,
                // electricity_rate,
                // water_type,
                // water_rate,
                // latitude,
                // longitude,
                // contact_id
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
            RETURNING dorm_id
        `;

        const dormResult = await client.query(dormQuery, [
            dormName.trim(), 
            zoneId, 
            address.trim(), 
            description.trim(), 
            'pending', 
            userId
        ]);

        const dormId = dormResult.rows[0].dorm_id;

        // ส่วนการเพิ่มข้อมูลอื่นๆ จะเพิ่มในภายหลัง เช่น:
        // 1. เพิ่มข้อมูลช่องทางติดต่อ (contact_info)
        // 2. เพิ่มรูปภาพ (dormitory_images)
        // 3. เพิ่มสิ่งอำนวยความสะดวก (dormitory_amenities)
        // 4. เพิ่มประเภทห้อง (room_types)

        await client.query('COMMIT');

        res.status(201).json({
            message: 'ข้อมูลพื้นฐานหอพักถูกเพิ่มเรียบร้อยแล้ว รอการอนุมัติจากผู้ดูแลระบบ',
            dormId: dormId,
            status: 'รอพิจารณา',
            nextStep: 'เพิ่มข้อมูลเพิ่มเติม (ราคา, สิ่งอำนวยความสะดวก, รูปภาพ)'
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error adding dormitory:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเพิ่มข้อมูลหอพัก', error: error.message });
    } finally {
        client.release();
    }
};

// ดึงข้อมูลหอพัก
exports.getDormitory = async (req, res) => {
    try {
        const { dormId } = req.params;
        const firebase_uid = req.user.uid;
        
        // ตรวจสอบสิทธิ์ผู้ใช้
        const userResult = await pool.query(
            'SELECT id, user_id, member_type FROM users WHERE firebase_uid = $1',
            [firebase_uid]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลผู้ใช้' });
        }
        
        const user = userResult.rows[0];
        const userId = user.id !== null && user.id !== undefined ? user.id : user.user_id;
        
        // ดึงข้อมูลหอพัก
        const query = `
            SELECT 
                d.dorm_id,
                d.dorm_name,
                d.zone_id,
                d.address,
                d.dorm_description,
                d.approval_status,
                d.created_date,
                z.zone_name
                // ส่วนอื่นๆ จะเพิ่มในภายหลัง เช่น:
                // d.bed_type,
                // d.rental_type,
                // d.electricity_type,
                // d.electricity_rate,
                // d.water_type,
                // d.water_rate,
                // d.latitude,
                // d.longitude
            FROM dormitories d
            LEFT JOIN zones z ON d.zone_id = z.zone_id
            WHERE d.dorm_id = $1 AND d.submitted_by = $2
        `;

        const result = await pool.query(query, [dormId, userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลหอพัก' });
        }

        res.json(result.rows[0]);

    } catch (error) {
        console.error('Error fetching dormitory:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูลหอพัก' });
    }
};

// อัพเดตข้อมูลหอพัก
exports.updateDormitory = async (req, res) => {
    const client = await pool.connect();
    try {
        const { dormId } = req.params;
        const firebase_uid = req.user.uid;
        
        // ตรวจสอบสิทธิ์ผู้ใช้
        const userResult = await client.query(
            'SELECT id, user_id, member_type FROM users WHERE firebase_uid = $1',
            [firebase_uid]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลผู้ใช้' });
        }
        
        const user = userResult.rows[0];
        const userId = user.id !== null && user.id !== undefined ? user.id : user.user_id;
        
        // ตรวจสอบว่าหอพักนี้เป็นของผู้ใช้หรือไม่
        const dormResult = await client.query(
            'SELECT dorm_id FROM dormitories WHERE dorm_id = $1 AND submitted_by = $2',
            [dormId, userId]
        );
        
        if (dormResult.rows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลหอพัก' });
        }

        // ตรวจสอบข้อมูลพื้นฐาน
        const validationErrors = validateBasicDormitoryInfo(req);
        if (validationErrors.length > 0) {
            return res.status(400).json({ 
                message: 'ข้อมูลไม่ถูกต้อง', 
                errors: validationErrors 
            });
        }

        const {
            dormName,
            zoneId,
            address,
            description
            // ส่วนอื่นๆ จะเพิ่มในภายหลัง
        } = req.body;

        await client.query('BEGIN');

        // อัพเดตข้อมูลพื้นฐาน
        const updateQuery = `
            UPDATE dormitories
            SET 
                dorm_name = $1,
                zone_id = $2,
                address = $3,
                dorm_description = $4,
                submitted_date = NOW()
                // ส่วนอื่นๆ จะเพิ่มในภายหลัง
            WHERE dorm_id = $5
        `;

        await client.query(updateQuery, [
            dormName.trim(), 
            zoneId, 
            address.trim(), 
            description.trim(), 
            dormId
        ]);

        await client.query('COMMIT');

        res.json({ 
            message: 'ข้อมูลหอพักถูกอัพเดตเรียบร้อยแล้ว',
            dormId: dormId
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating dormitory:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการอัพเดตข้อมูลหอพัก', error: error.message });
    } finally {
        client.release();
    }
};

// ดูรายการหอพักที่ตัวเองส่งไป
exports.getMyDormitories = async (req, res) => {
    try {
        const firebase_uid = req.user.uid;
        
        // ค้นหา user ID
        const userResult = await pool.query(
            'SELECT id, user_id FROM users WHERE firebase_uid = $1',
            [firebase_uid]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลผู้ใช้' });
        }
        
        const user = userResult.rows[0];
        const userId = user.id !== null && user.id !== undefined ? user.id : user.user_id;

        const query = `
            SELECT 
                d.dorm_id,
                d.dorm_name,
                d.address,
                d.approval_status,
                d.created_date AS submitted_date,
                z.zone_name
                // ส่วนอื่นๆ จะเพิ่มในภายหลัง เช่น:
                // (SELECT image_url FROM dormitory_images WHERE dorm_id = d.dorm_id AND is_primary = true LIMIT 1) as main_image_url
            FROM dormitories d
            LEFT JOIN zones z ON d.zone_id = z.zone_id
            WHERE d.submitted_by = $1
            ORDER BY d.created_date DESC
        `;

        const result = await pool.query(query, [userId]);
        res.json(result.rows);

    } catch (error) {
        console.error('Error fetching my dormitories:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
    }
};

// ============== ฟังก์ชันเดิม (คอมเม้นไว้ก่อน) ==============

// ส่งข้อมูลหอพักใหม่โดยเจ้าของหอพัก (เฉพาะข้อมูลทั่วไปก่อน)
const validateSubmitDormitory = (req) => {
    // ใช้ฟังก์ชันเดิมที่มีอยู่แล้ว
    return validateBasicDormitoryInfo(req);
};

// Helper functions for validation
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

const isValidPhoneNumber = (phone) => {
    // Thai phone number format: 0X-XXXX-XXXX or 0XXXXXXXXX
    const phoneRegex = /^0[0-9]{8,9}$/;
    return phoneRegex.test(phone.replace(/[-\s]/g, ''));
};

// Get room type options for dropdown
exports.getRoomTypeOptions = async (req, res) => {
    try {
        const roomTypes = [
            'ห้องพัดลม + เตียงเดี่ยว',
            'ห้องพัดลม + เตียงคู่',
            'ห้องแอร์ + เตียงเดี่ยว',
            'ห้องแอร์ + เตียงคู่',
            'อื่นๆ'
        ];
        
        res.json(roomTypes);
    } catch (error) {
        console.error('Error fetching room type options:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
    }
};

// ฟังก์ชันส่งข้อมูลหอพัก (เฉพาะข้อมูลทั่วไปก่อน)
exports.submitDormitory = async (req, res) => {
    const client = await pool.connect();
    try {
        const firebase_uid = req.user.uid;
        
        // ตรวจสอบว่าผู้ใช้เป็น owner
        const userResult = await client.query(
            'SELECT id, user_id, member_type FROM users WHERE firebase_uid = $1',
            [firebase_uid]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลผู้ใช้' });
        }
        
        const user = userResult.rows[0];
        const userId = user.id !== null && user.id !== undefined ? user.id : user.user_id;
        
        if (user.member_type !== 'owner') {
            return res.status(403).json({ message: 'เฉพาะเจ้าของหอพักเท่านั้นที่สามารถเพิ่มข้อมูลหอพักได้' });
        }

        // ตรวจสอบข้อมูลพื้นฐาน
        const validationErrors = validateBasicDormitoryInfo(req);
        if (validationErrors.length > 0) {
            return res.status(400).json({ 
                message: 'ข้อมูลไม่ถูกต้อง', 
                errors: validationErrors 
            });
        }

        await client.query('BEGIN');

        const {
            dormName,
            zoneId,
            address,
            description
        } = req.body;

        // เพิ่มข้อมูลหอพักพื้นฐาน (สถานะรอพิจารณา)
        const dormQuery = `
            INSERT INTO dormitories (
                dorm_name, 
                zone_id, 
                address, 
                dorm_description, 
                approval_status, 
                submitted_by, 
                submitted_date
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
            RETURNING dorm_id
        `;

        const dormResult = await client.query(dormQuery, [
            dormName.trim(), 
            zoneId, 
            address.trim(), 
            description.trim(), 
            'pending', 
            userId
        ]);

        const dormId = dormResult.rows[0].dorm_id;

        // อัพโหลดรูปภาพหลัก (ถ้ามี)
        if (req.files && req.files.length > 0) {
            const file = req.files[0]; // ใช้รูปแรกเป็นรูปหลัก
            const imageUrl = await storageService.uploadImage(file);
            await client.query(
                `INSERT INTO dormitory_images (dorm_id, image_url, image_type, is_primary, upload_date)
                 VALUES ($1, $2, $3, $4, NOW())`,
                [dormId, imageUrl, 'general', true]
            );
        }

        await client.query('COMMIT');

        res.status(201).json({
            message: 'ข้อมูลพื้นฐานหอพักถูกเพิ่มเรียบร้อยแล้ว รอการอนุมัติจากผู้ดูแลระบบ',
            dormId: dormId,
            status: 'รอพิจารณา',
            nextStep: 'เพิ่มข้อมูลเพิ่มเติม (ราคา, สิ่งอำนวยความสะดวก, รูปภาพ)'
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error submitting dormitory:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการส่งข้อมูล', error: error.message });
    } finally {
        client.release();
    }
};

// ดูรายการหอพักที่ตัวเองส่งไป
exports.getMySubmissions = async (req, res) => {
    try {
        const firebase_uid = req.user.uid;
        
        // ค้นหา user ID
        const userResult = await pool.query(
            'SELECT id, user_id FROM users WHERE firebase_uid = $1',
            [firebase_uid]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลผู้ใช้' });
        }
        
        const user = userResult.rows[0];
        const userId = user.id !== null && user.id !== undefined ? user.id : user.user_id;

        const query = `
            SELECT 
                d.dorm_id,
                d.dorm_name,
                d.address,
                d.approval_status,
                d.created_date AS submitted_date,
                z.zone_name,
                (SELECT image_url FROM dormitory_images WHERE dorm_id = d.dorm_id AND is_primary = true LIMIT 1) as main_image_url
            FROM dormitories d
            LEFT JOIN zones z ON d.zone_id = z.zone_id
            WHERE d.submitted_by = $1
            ORDER BY d.created_date DESC
        `;

        const result = await pool.query(query, [userId]);
        res.json(result.rows);

    } catch (error) {
        console.error('Error fetching my submissions:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
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
            'SELECT id, user_id, member_type FROM users WHERE firebase_uid = $1',
            [firebase_uid]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลผู้ใช้' });
        }
        
        const user = userResult.rows[0];
        const userId = user.id !== null && user.id !== undefined ? user.id : user.user_id;
        
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
            WHERE d.dorm_id = $1 AND (d.submitted_by = $2 OR $3 = 'admin')
            `,
            [dormId, userId, user.member_type]
        );
        
        if (dormResult.rows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลหอพัก' });
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
                rt.price_type,
                rt.description,
                rt.max_occupancy,
                r.room_id,
                r.room_number,
                r.occupancy_status
            FROM room_types rt
            LEFT JOIN rooms r ON rt.room_type_id = r.room_type_id
            WHERE rt.dorm_id = $1
            `,
            [dormId]
        );

        // 3. ดึงข้อมูลสิ่งอำนวยความสะดวก (amenities) ที่เกี่ยวข้องกับหอพักนี้
        const amenitiesResult = await client.query(
            `
            SELECT a.amenity_id, a.amenity_name, da.is_available
            FROM dormitory_amenities da
            JOIN amenities a ON da.amenity_id = a.amenity_id
            WHERE da.dorm_id = $1
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
            contactInfo
        });

    } catch (error) {
        console.error('Error fetching dormitory details:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูลหอพัก' });
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
            'SELECT id, user_id, member_type FROM users WHERE firebase_uid = $1',
            [firebase_uid]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลผู้ใช้' });
        }
        
        const user = userResult.rows[0];
        const userId = user.id !== null && user.id !== undefined ? user.id : user.user_id;
        
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
            WHERE d.dorm_id = $1 AND (d.submitted_by = $2 OR $3 = 'admin')
            `,
            [dormId, userId, user.member_type]
        );
        
        if (dormResult.rows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลหอพัก' });
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
            roomTypes
        } = req.body;

        await client.query('BEGIN');

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
                submitted_date = NOW()
            WHERE dorm_id = $15
        `;

        await client.query(dormQuery, [
            dormName.trim(), zoneId, address.trim(), description.trim(), 
            parseFloat(latitude), parseFloat(longitude),
            bedType, rentalType, electricityType, electricityRate || null,
            waterType, waterRate || null, monthlyPrice || null, dailyPrice || null,
            dormId
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
                    dormitory.contact_id
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
            
            const amenityPromises = amenities.map(amenityId =>
                client.query(
                    `INSERT INTO dormitory_amenities (dorm_id, amenity_id, is_available) VALUES ($1, $2, $3)
                     ON CONFLICT (dorm_id, amenity_id) DO UPDATE SET is_available = excluded.is_available`,
                    [dormId, amenityId, true]
                )
            );
            await Promise.all(amenityPromises);
        }

        // 4. Update room types
        if (roomTypes && roomTypes.length > 0) {
            // Disable all existing room types first
            await client.query(
                `UPDATE room_types SET is_available = false WHERE dorm_id = $1`,
                [dormId]
            );
            
            const roomTypePromises = roomTypes.map(roomType => {
                // Handle price values - convert "ติดต่อสอบถาม" to null, keep numbers as is
                const monthlyPrice = roomType.monthlyPrice === 'ติดต่อสอบถาม' ? null : roomType.monthlyPrice;
                const dailyPrice = roomType.dailyPrice === 'ติดต่อสอบถาม' ? null : roomType.dailyPrice;
                const summerPrice = roomType.summerPrice === 'ติดต่อสอบถาม' ? null : roomType.summerPrice;
                
                return client.query(`
                    INSERT INTO room_types (
                        dorm_id, room_name, bed_type, size_sqm, monthly_price,
                        daily_price, summer_price, price_type, description, max_occupancy
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    ON CONFLICT (dorm_id, room_name) DO UPDATE SET
                        bed_type = excluded.bed_type,
                        size_sqm = excluded.size_sqm,
                        monthly_price = excluded.monthly_price,
                        daily_price = excluded.daily_price,
                        summer_price = excluded.summer_price,
                        price_type = excluded.price_type,
                        description = excluded.description,
                        max_occupancy = excluded.max_occupancy,
                        is_available = true
                `, [
                    dormId, roomType.roomName?.trim(), roomType.bedType, roomType.sizeSqm || null,
                    monthlyPrice, dailyPrice, summerPrice, 
                    roomType.priceType || 'fixed',
                    roomType.description?.trim() || null, roomType.maxOccupancy || null
                ]);
            });
            await Promise.all(roomTypePromises);
        }

        await client.query('COMMIT');

        res.json({ message: 'ข้อมูลหอพักถูกแก้ไขเรียบร้อยแล้ว' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error editing dormitory:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการแก้ไขข้อมูลหอพัก' });
    } finally {
        client.release();
    }
};

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
                (SELECT image_url FROM dormitory_images WHERE dorm_id = d.dorm_id AND is_primary = true LIMIT 1) as main_image_url
            FROM dormitories d
            LEFT JOIN zones z ON d.zone_id = z.zone_id
            ORDER BY d.created_date DESC
        `;

        const result = await pool.query(query);
        res.json(result.rows);

    } catch (error) {
        console.error('Error fetching all dormitories:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูลหอพักทั้งหมด' });
    }
};

// ฟังก์ชันสำหรับอนุมัติหรือปฏิเสธหอพัก
exports.updateDormitoryApproval = async (req, res) => {
    const client = await pool.connect();
    try {
        const { dormId } = req.params;
        const { status, rejectionReason } = req.body;
        const firebase_uid = req.user.uid;
        
        // ตรวจสอบสิทธิ์ผู้ใช้ (เฉพาะผู้ดูแลระบบที่สามารถอนุมัติหรือปฏิเสธได้)
        const userResult = await client.query(
            'SELECT id, user_id, member_type FROM users WHERE firebase_uid = $1',
            [firebase_uid]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลผู้ใช้' });
        }
        
        const user = userResult.rows[0];
        const userId = user.id !== null && user.id !== undefined ? user.id : user.user_id;
        
        if (user.member_type !== 'admin') {
            return res.status(403).json({ message: 'เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดำเนินการนี้ได้' });
        }

        await client.query('BEGIN');

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
            status === 'rejected' ? rejectionReason : null, // Set rejection reason only if rejected
            userId,
            dormId
        ]);

        await client.query('COMMIT');

        res.json({ message: 'สถานะการอนุมัติหอพักถูกปรับปรุงเรียบร้อยแล้ว' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating dormitory approval:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการปรับปรุงสถานะการอนุมัติหอพัก' });
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
            'SELECT id, user_id, member_type FROM users WHERE firebase_uid = $1',
            [firebase_uid]
        );
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ message: 'ไม่พบข้อมูลผู้ใช้' });
        }
        
        const user = userResult.rows[0];
        const userId = user.id !== null && user.id !== undefined ? user.id : user.user_id;
        
        if (user.member_type !== 'admin') {
            return res.status(403).json({ message: 'เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถลบหอพักได้' });
        }

        await client.query('BEGIN');

        // 1. ลบข้อมูลห้องพักที่เกี่ยวข้องกับหอพักนี้
        await client.query(
            `DELETE FROM rooms WHERE room_type_id IN (SELECT room_type_id FROM room_types WHERE dorm_id = $1)`,
            [dormId]
        );

        // 2. ลบข้อมูลประเภทห้อง (room types) ที่เกี่ยวข้องกับหอพักนี้
        await client.query(
            `DELETE FROM room_types WHERE dorm_id = $1`,
            [dormId]
        );

        // 3. ลบข้อมูลสิ่งอำนวยความสะดวก (amenities) ที่เกี่ยวข้องกับหอพักนี้
        await client.query(
            `DELETE FROM dormitory_amenities WHERE dorm_id = $1`,
            [dormId]
        );

        // 4. ลบข้อมูลรูปภาพหอพัก
        await client.query(
            `DELETE FROM dormitory_images WHERE dorm_id = $1`,
            [dormId]
        );

        // 5. ลบข้อมูลหอพัก
        await client.query(
            `DELETE FROM dormitories WHERE dorm_id = $1`,
            [dormId]
        );

        await client.query('COMMIT');

        res.json({ message: 'ลบหอพักเรียบร้อยแล้ว' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting dormitory:', error);
        res.status(500).json({ message: 'เกิดข้อผิดพลาดในการลบหอพัก' });
    } finally {
        client.release();
    }
};