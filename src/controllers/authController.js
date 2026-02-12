const firebaseAdmin = require('../config/firebase');
const userService = require('../services/userService');
const storageService = require('../services/r2StorageService'); // เปลี่ยนไปใช้ R2
const { generateUsernameFromEmail } = userService;
const pool = require('../db');

function mapUserRowToProfile(row) {
  if (!row) return null;
  return {
    uid: row.firebase_uid,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    photoURL: row.photo_url || null,
    memberType: row.member_type,
    phoneNumber: row.phone_number || null,
    residenceDormId: row.residence_dorm_id || null,
    needsProfileSetup: false,
    // *** เพิ่ม owner fields ***
    managerName: row.manager_name || null,
    secondaryPhone: row.secondary_phone || null,
    lineId: row.line_id || null,
  };
}

exports.googleLogin = async (req, res) => {
  // Reduce noisy logs
  const { userType } = req.body;
  try {
    const firebase_uid = req.user.uid;
    const email = req.user.email || null;
    const displayName = req.user.name || null;
    const photoURL = req.user.picture || null;

    // audit: login attempt

    // ตรวจสอบว่ามีผู้ใช้อยู่แล้วหรือไม่
    const existingUser = await userService.getUserByFirebaseUid(firebase_uid);

    // ถ้ามีอยู่แล้ว และ member_type ไม่ตรงกับ userType ที่ frontend ขอ => ปฏิเสธ
    if (existingUser && existingUser.member_type && userType && existingUser.member_type !== userType) {
      console.warn('Account type mismatch');
      const thaiRole = existingUser.member_type === 'owner' ? 'เจ้าของหอพัก' : 'สมาชิก';
      return res.status(409).json({ code: 'account-type-mismatch', message: `อีเมลนี้ถูกลงทะเบียนเป็น${thaiRole}แล้ว ไม่สามารถเข้าสู่ระบบในหน้านี้ได้` });
    }

    // ถ้าไม่มีผู้ใช้ในระบบ ส่งกลับให้ไปกรอกข้อมูล
    if (!existingUser) {
      // new user, requires profile setup
      return res.status(200).json({
        uid: firebase_uid,
        email: email,
        displayName: displayName,
        photoURL: photoURL,
        needsProfileSetup: true,
        memberType: userType
      });
    }

    // ตรวจสอบว่าต้องกรอกข้อมูลเพิ่มเติมหรือไม่
    let needsProfileSetup = false;
    if (existingUser.member_type === 'member') {
      needsProfileSetup = !existingUser.phone_number || !existingUser.residence_dorm_id;
    } else if (existingUser.member_type === 'owner') {
      needsProfileSetup = !existingUser.manager_name;
    }

    // Map DB fields (snake_case) to frontend UserProfile (camelCase)
    const userProfile = {
      ...mapUserRowToProfile(existingUser),
      id: existingUser.id,
      needsProfileSetup: needsProfileSetup
    };

    // return user profile

    res.status(200).json(userProfile);
  } catch (error) {
    console.error('Google Login Error:', error.message);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์', error: error.message });
  }
};

exports.registerWithEmail = async (req, res) => {
  // registration request

  const firebase_uid = req.user?.uid;
  if (!firebase_uid) {
    console.error('Registration Error: Missing Firebase UID');
    return res.status(401).json({ message: 'ไม่ได้รับอนุญาต: ไม่พบ Firebase UID' });
  }

  // *** เพิ่มการ destructure ข้อมูล owner fields ***
  const {
    email,
    fullName,
    memberType,
    phoneNumber,
    dormitory,
    dormitoryId,
    managerName,
    secondaryPhone,
    lineId
  } = req.body;

  const dormitoryParam = dormitory !== undefined ? dormitory : dormitoryId;

  // *** ปรับปรุงการตรวจสอบ required fields ***
  if (!email || !fullName || !memberType) {
      console.error('Registration Error: Missing basic required fields');
    return res.status(400).json({ message: 'กรุณากรอกข้อมูลที่จำเป็น: อีเมล, ชื่อเต็ม, ประเภทผู้ใช้' });
  }

  // ตรวจสอบ required fields ตาม memberType
  if (memberType === 'member') {
    if (!phoneNumber || !dormitoryParam) {
      console.error('Registration Error: Missing required fields for member');
      return res.status(400).json({ message: 'กรุณากรอกข้อมูลที่จำเป็นสำหรับสมาชิก: เบอร์โทรศัพท์และหอพัก' });
    }
  } else if (memberType === 'owner') {
    if (!managerName) {
      console.error('Registration Error: Missing required fields for owner');
      return res.status(400).json({ message: 'กรุณากรอกข้อมูลที่จำเป็นสำหรับเจ้าของ: ชื่อผู้จัดการ' });
    }
  }

  if (!['member', 'owner'].includes(memberType)) {
    console.error('Registration Error: Invalid memberType');
    return res.status(400).json({ message: 'ประเภทผู้ใช้ไม่ถูกต้อง ต้องเป็น "member" หรือ "owner"' });
  }

  let photoUrl = null;
  if (req.file) {
    photoUrl = await storageService.uploadProfileImage(req.file);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingUser = await userService.getUserByFirebaseUid(firebase_uid);
    if (existingUser) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'อีเมลนี้ถูกใช้งานแล้ว' });
    }

    // แปลง dormitory เป็น integer ถ้าเป็น string (สำหรับ member เท่านั้น)
    let dormitoryIdFinal = null;
    if (memberType === 'member' && dormitoryParam) {
      // normalize dormitory param

      if (typeof dormitoryParam === 'object' && dormitoryParam !== null) {
        if (dormitoryParam.id) {
          dormitoryIdFinal = parseInt(dormitoryParam.id, 10);
        } else if (dormitoryParam.dorm_id) {
          dormitoryIdFinal = parseInt(dormitoryParam.dorm_id, 10);
        } else {
          dormitoryIdFinal = parseInt(String(dormitoryParam), 10);
        }
      } else {
        dormitoryIdFinal = parseInt(dormitoryParam, 10);
      }

      // normalized dormitoryId computed

      if (isNaN(dormitoryIdFinal)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'รูปแบบ ID หอพักไม่ถูกต้อง' });
      }
    }

    // *** ปรับปรุงการเรียก upsertUserWithEmail ให้รวม owner fields ***
    const newUser = await userService.upsertUserWithEmail({
      firebase_uid,
      email,
      displayName: fullName,
      photoUrl,
      memberType,
      phoneNumber,
      // สำคัญ: ยังไม่ตั้งหอพักให้ผู้ใช้จนกว่าจะได้รับการอนุมัติจากเจ้าของหอ
      residenceDormId: null,
      // *** เพิ่ม owner fields ***
      managerName: memberType === 'owner' ? managerName : null,
      secondaryPhone: memberType === 'owner' ? secondaryPhone : null,
      lineId: memberType === 'owner' ? lineId : null
    });

    // new user created/updated

    // อัพเดต Firebase user profile
    await firebaseAdmin.auth().updateUser(firebase_uid, {
      displayName: fullName,
      ...(photoUrl && { photoURL: photoUrl })
    });

    // *** สร้าง userProfile response ที่รวม owner fields ***
    const userProfile = {
      ...mapUserRowToProfile(newUser),
      id: newUser.id,
      memberType: memberType,
      needsProfileSetup: false,
      // *** เพิ่ม owner fields ใน response ***
      managerName: newUser.manager_name || null,
      secondaryPhone: newUser.secondary_phone || null,
      lineId: newUser.line_id || null
    };

    // respond with user profile

    // สร้างคำขอเข้าหอพักอัตโนมัติถ้าเป็น member และมี dormitoryId
    if (memberType === 'member' && dormitoryIdFinal) {
      try {
        const userId = newUser.id !== undefined ? newUser.id : newUser.user_id;

        const existingRequest = await client.query(
          'SELECT * FROM member_requests WHERE user_id = $1 AND dorm_id = $2',
          [userId, dormitoryIdFinal]
        );

        if (existingRequest.rows.length === 0) {
          await client.query(
            `INSERT INTO member_requests (user_id, dorm_id, request_date, status)
             VALUES ($1, $2, CURRENT_TIMESTAMP, 'รออนุมัติ')`,
            [userId, dormitoryIdFinal]
          );
          console.log(`Created membership request for user ${userId} to dormitory ${dormitoryIdFinal}`);
        }
      } catch (requestError) {
        console.error('Error creating membership request during registration:', requestError);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: 'ลงทะเบียนผู้ใช้สำเร็จ!',
      user: userProfile
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Email Registration Error:', error);
    if (error.code === '23505') {
      return res.status(409).json({ message: 'อีเมลนี้ถูกใช้งานแล้ว' });
    }
    res.status(400).json({ message: 'ไม่สามารถลงทะเบียนผู้ใช้ได้', error: error.message });
  } finally {
    client.release();
  }
};

exports.fetchCurrentUserProfile = async (req, res) => {
  try {
    const firebase_uid = req.user.uid;
    // fetch current user profile

    const user = await userService.getUserByFirebaseUid(firebase_uid);
    // user existence checked

    // ถ้าไม่พบข้อมูลผู้ใช้ในฐานข้อมูล
    if (!user) {
      return res.status(200).json({
        uid: firebase_uid,
        email: req.user.email || null,
        displayName: req.user.name || null,
        photoURL: req.user.picture || null,
        needsProfileSetup: true,
        isNewUser: true // เพิ่มฟิลด์นี้เพื่อให้ frontend รู้ว่าเป็นผู้ใช้ใหม่
      });
    }

    // ตรวจสอบความครบถ้วนโปรไฟล์ แยกจากสถานะอนุมัติหอพัก
    let needsProfileSetup = false;
    if (user.member_type === 'member') {
      // ผ่อนปรน: ต้องมีเฉพาะเบอร์โทรเท่านั้น ถือว่าจบโปรไฟล์
      needsProfileSetup = !user.phone_number;
    } else if (user.member_type === 'owner') {
      needsProfileSetup = !user.manager_name;
    }

    // คำนวณสถานะรออนุมัติหอพักสำหรับ member
    let pendingApproval = false;
    let pendingDormId = null;
    let pendingDormName = null;
    if (user.member_type === 'member') {
      try {
        const pending = await pool.query(
          `SELECT mr.dorm_id, d.dorm_name 
           FROM member_requests mr
           JOIN dormitories d ON mr.dorm_id = d.dorm_id
           WHERE mr.user_id = $1 AND mr.status = 'รออนุมัติ' 
           LIMIT 1`,
          [user.id]
        );
        if (pending.rows.length > 0) {
          pendingApproval = true;
          pendingDormId = pending.rows[0].dorm_id;
          pendingDormName = pending.rows[0].dorm_name;
        }
      } catch (e) {
        console.error('Error checking pendingApproval:', e.message);
      }
    }

    const userProfile = {
      ...mapUserRowToProfile(user),
      id: user.id,
      needsProfileSetup: needsProfileSetup,
      pendingApproval,
      pendingDormId,
      pendingDormName,
      isNewUser: false // ผู้ใช้ที่มีข้อมูลในระบบแล้ว
    };

    // profile prepared

    res.json(userProfile);
  } catch (error) {
    console.error('Error fetching current user profile:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์', error: error.message });
  }
};

exports.completeUserProfile = async (req, res) => {
  const firebase_uid = req.user.uid;
  const {
    phoneNumber,
    userType,
    dormitoryId,
    managerName,
    secondaryPhone,
    lineId
  } = req.body;

  console.log('=== Profile Completion Debug ===');
  console.log('Request body:', req.body);

  if (!userType) {
    return res.status(400).json({
      message: 'กรุณาระบุประเภทผู้ใช้งาน (userType)'
    });
  }

  if (userType === 'member') {
    if (!phoneNumber) {
      return res.status(400).json({
        message: 'กรุณาระบุเบอร์โทรศัพท์'
      });
    }
  } else if (userType === 'owner') {
    if (!managerName) {
      return res.status(400).json({
        message: 'กรุณาระบุชื่อผู้จัดการ'
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingUser = await userService.getUserByFirebaseUid(firebase_uid);

    let updatedUser;
    let parsedDormitoryId = null;
    if (dormitoryId) {
      console.log('Converting dormitoryId to integer:', dormitoryId);

      if (typeof dormitoryId === 'object' && dormitoryId !== null) {
        if (dormitoryId.id) {
          parsedDormitoryId = parseInt(dormitoryId.id, 10);
        } else if (dormitoryId.dorm_id) {
          parsedDormitoryId = parseInt(dormitoryId.dorm_id, 10);
        } else {
          parsedDormitoryId = parseInt(String(dormitoryId), 10);
        }
      } else {
        parsedDormitoryId = parseInt(dormitoryId, 10);
      }

      console.log('Converted dormitoryId:', parsedDormitoryId);

      if (isNaN(parsedDormitoryId)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'รูปแบบ ID หอพักไม่ถูกต้อง' });
      }
    }

    const userData = {
      firebase_uid,
      email: req.user.email || null,
      displayName: req.user.name || null,
      photoUrl: req.user.picture || null,
      memberType: userType,
      phoneNumber: phoneNumber || null,
      residenceDormId: null, // ไม่ตั้ง residence_dorm_id จนกว่าจะได้รับการอนุมัติ
      managerName: userType === 'owner' ? managerName : null,
      secondaryPhone: userType === 'owner' ? secondaryPhone : null,
      lineId: userType === 'owner' ? lineId : null
    };

    if (existingUser) {
      updatedUser = await userService.updateProfile(firebase_uid, userData);
    } else {
      updatedUser = await userService.createNewUser(userData);
    }

    if (!updatedUser) {
      throw new Error('ไม่สามารถอัพเดทหรือสร้างโปรไฟล์ผู้ใช้ได้');
    }

    if (userType === 'member' && parsedDormitoryId) {
      try {
        const userId = updatedUser.id;
        const existingRequest = await client.query(
          'SELECT * FROM member_requests WHERE user_id = $1 AND dorm_id = $2',
          [userId, parsedDormitoryId]
        );

        if (existingRequest.rows.length === 0) {
          await client.query(
            `INSERT INTO member_requests (user_id, dorm_id, request_date, status)
             VALUES ($1, $2, CURRENT_TIMESTAMP, 'รออนุมัติ')`,
            [userId, parsedDormitoryId]
          );
          console.log(`Created membership request for user ${userId} to dormitory ${parsedDormitoryId}`);
        }
      } catch (requestError) {
        console.error('Error creating membership request during profile completion:', requestError);
      }
    }

    const userProfile = {
      ...mapUserRowToProfile(updatedUser),
      id: updatedUser.id,
      needsProfileSetup: false
    };

    await client.query('COMMIT');
    res.json(userProfile);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating user profile:', error.message);
    res.status(500).json({ message: 'ไม่สามารถอัพเดทโปรไฟล์ได้', error: error.message });
  } finally {
    client.release();
  }
};

// เพิ่ม function สำหรับดึงรายการหอพัก
exports.getDormitoryOptions = async (req, res) => {
  try {
    const query = `
      SELECT dorm_id, dorm_name, address, monthly_price, zone_name
      FROM dormitories d
      LEFT JOIN zones z ON d.zone_id = z.zone_id
      WHERE d.approval_status = 'อนุมัติ'
      ORDER BY d.dorm_name
    `;

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dormitory options:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์', error: error.message });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    // TODO: Implement authorization check here (e.g., only 'admin' can access)
    if (req.user.memberType !== 'admin') { // Assuming req.user from verifyFirebaseToken has memberType
      return res.status(403).json({ message: 'ไม่มีสิทธิ์: เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถเข้าถึงทรัพยากรนี้ได้' });
    }
    const pool = require('../db');
    const result = await pool.query('SELECT * FROM users');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงข้อมูลผู้ใช้', error: error.message });
  }
};

// เข้าสู่ระบบสำหรับแอดมิน
exports.adminLogin = async (req, res) => {
  try {
    const firebase_uid = req.user.uid; // uid from verified token

    // ตรวจสอบว่าผู้ใช้มีสิทธิ์แอดมินหรือไม่
    const userQuery = 'SELECT * FROM users WHERE firebase_uid = $1';
    const userResult = await pool.query(userQuery, [firebase_uid]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลผู้ใช้ในระบบ' });
    }

    const user = userResult.rows[0];

    if (user.member_type !== 'admin') {
      return res.status(403).json({ message: 'ไม่มีสิทธิ์เข้าใช้งานส่วนแอดมิน' });
    }

    // ส่งข้อมูลแอดมินกลับไป
    const adminProfile = {
      uid: user.firebase_uid,
      username: user.username,
      email: user.email,
      displayName: user.display_name,
      photoURL: user.photo_url || null,
      memberType: user.member_type
    };

    res.status(200).json(adminProfile);
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบแอดมิน', error: error.message });
  }
};



// เพิ่ม endpoint สำหรับตรวจสอบความถูกต้องของ token
exports.verifyToken = async (req, res) => {
  try {
    // ถ้า middleware verifyFirebaseToken ผ่านมาถึงจุดนี้ แสดงว่า token ยังใช้งานได้
    const firebase_uid = req.user.uid;
    const tokenExpiry = new Date(req.user.exp * 1000);
    const now = new Date();
    const timeLeft = Math.floor((tokenExpiry - now) / 1000); // เวลาที่เหลือเป็นวินาที

    console.log(`Token verification successful for UID: ${firebase_uid}`);
    console.log(`Token expires at: ${tokenExpiry.toISOString()}`);
    console.log(`Time left: ${timeLeft} seconds`);

    res.json({
      valid: true,
      uid: firebase_uid,
      expiresAt: tokenExpiry,
      timeLeft: timeLeft
    });
  } catch (error) {
    console.error('Error in token verification endpoint:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์', error: error.message });
  }
};

// ตรวจสอบและจัดการคำขอลืมรหัสผ่าน ตามกติกาที่กำหนด
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body || {};

    // ตรวจรูปแบบอีเมลไม่ถูกต้อง
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(String(email).toLowerCase())) {
      return res.status(400).json({
        code: 'invalid-email-format',
        allowed: false,
        message: 'รูปแบบอีเมลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง'
      });
    }

    // ตรวจผู้ใช้ด้วย Firebase Admin
    let userRecord;
    try {
      userRecord = await firebaseAdmin.auth().getUserByEmail(email);
    } catch (err) {
      if (err && err.code === 'auth/user-not-found') {
        return res.status(404).json({
          code: 'email-not-found',
          allowed: false,
          message: 'ไม่พบอีเมลนี้ในระบบ'
        });
      }
      // ข้อผิดพลาดอื่นๆ
      console.error('Forgot password lookup error:', err);
      return res.status(500).json({ message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
    }

    const providers = (userRecord.providerData || []).map(p => p.providerId);
    const hasPassword = providers.includes('password');
    const hasGoogleOnly = providers.length > 0 && providers.every(p => p === 'google.com');

    if (hasPassword) {
      // อนุญาตให้ส่งลิงก์รีเซ็ต (ให้ frontend ไปเรียก Firebase client SDK ส่งอีเมล)
      return res.status(200).json({
        code: 'reset-allowed',
        allowed: true,
        message: 'ส่งลิงก์รีเซ็ตรหัสผ่านไปยังอีเมลของคุณแล้ว กรุณาตรวจสอบอีเมล'
      });
    }

    if (hasGoogleOnly) {
      return res.status(200).json({
        code: 'google-only',
        allowed: false,
        message: "บัญชีนี้เข้าสู่ระบบด้วย Google เท่านั้น โปรดใช้ปุ่ม ‘เข้าสู่ระบบด้วย Google’"
      });
    }

    // ไม่รองรับกรณีอื่นๆ: ตีความว่าไม่มีสิทธิ์รีเซ็ตด้วยรหัสผ่าน
    return res.status(404).json({
      code: 'email-not-found',
      allowed: false,
      message: 'ไม่พบอีเมลนี้ในระบบ'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์' });
  }
};