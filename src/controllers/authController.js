const firebaseAdmin = require('../config/firebase').default;
const userService = require('../services/userService');
const storageService = require('../services/storageService');
const { generateUsernameFromEmail } = userService;
const pool = require('../db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { ADMIN_JWT_SECRET } = require('../middleware/authMiddleware');

// Helper: map user row (snake_case) => profile object (camelCase)
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
  };
}

exports.googleLogin = async (req, res) => {
    console.log("Body:", req.body);
    console.log("User from token:", req.user);
    const { userType } = req.body; // รับเฉพาะ userType จาก body
    try {
        const firebase_uid = req.user.uid; // uid from verified token
        const email = req.user.email || null;
        const displayName = req.user.name || null;
        const photoURL = req.user.picture || null;

        console.log('Google login for uid:', firebase_uid, 'requested userType:', userType);

        // ตรวจสอบว่ามีผู้ใช้อยู่แล้วหรือไม่
        const existingUser = await userService.getUserByFirebaseUid(firebase_uid);

        // ถ้ามีอยู่แล้ว และ member_type ไม่ตรงกับ userType ที่ frontend ขอ => ปฏิเสธ
        if (existingUser && existingUser.member_type && userType && existingUser.member_type !== userType) {
          console.warn('Account type mismatch. Existing:', existingUser.member_type, 'requested:', userType);
          const thaiRole = existingUser.member_type === 'owner' ? 'เจ้าของหอพัก' : 'สมาชิก';
          return res.status(409).json({ code: 'account-type-mismatch', message: `อีเมลนี้ถูกลงทะเบียนเป็น${thaiRole}แล้ว ไม่สามารถเข้าสู่ระบบในหน้านี้ได้` });
        }

        let userInDb;

        if (existingUser) {
          // อัปเดตข้อมูลพื้นฐาน (ยกเว้น member_type) ถ้าจำเป็น
          userInDb = await userService.updateProfile(firebase_uid, {
            email,
            displayName,
            photoUrl: photoURL
          });

          // ถ้า updateProfile ไม่ได้ปรับอะไร result อาจเป็น null
          if (!userInDb) {
            userInDb = existingUser;
          }
        } else {
          // ผู้ใช้ใหม่ สร้างด้วย memberType ตามที่ขอมา
          userInDb = await userService.findOrCreateUser({
            firebase_uid,
            email,
            displayName,
            photoURL,
            memberType: userType
          });
        }

        // คำนวณ needsProfileSetup
        let needsProfileSetup = true; // Default to true when userType isn't provided
        
        if (userInDb.member_type) { // ถ้ามี memberType ใน DB
            if (userInDb.member_type === 'member') {
                if (userInDb.phone_number && userInDb.residence_dorm_id) {
                    needsProfileSetup = false;
                }
            } else if (userInDb.member_type === 'owner') {
                // Owner ที่มาจาก Google ถือว่าไม่ต้องกรอกข้อมูลเพิ่มเติมแล้ว
                // เว้นแต่จะมีข้อมูลธุรกิจที่จำเป็นต้องกรอกในอนาคต (ถ้ามี ให้เพิ่มเงื่อนไขตรงนี้)
                needsProfileSetup = false;
            }
        }

        // Log debug information
        console.log('User in DB after findOrCreate:', {
            uid: userInDb.firebase_uid,
            memberType: userInDb.member_type,
            needsProfileSetup: needsProfileSetup
        });

        // Map DB fields (snake_case) to frontend UserProfile (camelCase)
        const userProfile = {
          ...mapUserRowToProfile(userInDb),
          needsProfileSetup: needsProfileSetup,
        };

        console.log('==== Debug newUser row ====');
        console.log(Object.keys(userInDb), userInDb);

        res.status(200).json(userProfile);
    } catch (error) {
        console.error('Detailed Google Login Error:', error);
        if (error.code) console.error('Error code:', error.code);
        if (error.stack) console.error('Error stack:', error.stack);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

exports.registerWithEmail = async (req, res) => {
  console.log('=== Registration Request Debug ===');
  console.log('Request body:', req.body);
  console.log('Request file:', req.file);
  console.log('Dormitory value:', req.body.dormitory);
  console.log('Dormitory type:', typeof req.body.dormitory);

  const firebase_uid = req.user?.uid;
  if (!firebase_uid) {
    console.error('Registration Error: Firebase UID is missing from request.');
    return res.status(401).json({ message: 'Unauthorized: Firebase UID not found.' });
  }

  const { email, fullName, memberType, phoneNumber, dormitory, dormitoryId } = req.body;
  const dormitoryParam = dormitory !== undefined ? dormitory : dormitoryId;

  if (!email || !fullName || !memberType || !phoneNumber || (memberType === 'member' && !dormitoryParam)) {
    console.error('Registration Error: Missing required fields.');
    return res.status(400).json({ message: 'Missing required fields: email, fullName, memberType, phoneNumber, or dormitory (for member).' });
  }

  if (!['member', 'owner'].includes(memberType)) {
    console.error('Registration Error: Invalid memberType:', memberType);
    return res.status(400).json({ message: 'Invalid memberType. Must be "member" or "owner".' });
  }

  let photoUrl = null;
  if (req.file) {
    photoUrl = await storageService.uploadImage(req.file);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingUser = await userService.getUserByFirebaseUid(firebase_uid);
    if (existingUser) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'อีเมลนี้ถูกใช้งานแล้ว' });
    }

    // แปลง dormitory เป็น integer ถ้าเป็น string
    let dormitoryIdFinal = null;
    if (memberType === 'member' && dormitoryParam) {
      console.log('Converting dormitory to integer:', dormitoryParam);
      
      // ตรวจสอบว่า dormitory เป็น object หรือไม่
      if (typeof dormitoryParam === 'object' && dormitoryParam !== null) {
        // ถ้าเป็น object ให้ดูว่ามี property id หรือ dorm_id หรือไม่
        if (dormitoryParam.id) {
          dormitoryIdFinal = parseInt(dormitoryParam.id, 10);
        } else if (dormitoryParam.dorm_id) {
          dormitoryIdFinal = parseInt(dormitoryParam.dorm_id, 10);
        } else {
          // ถ้าไม่มี id ให้ลองแปลงทั้ง object เป็น string แล้วแปลงเป็น integer
          dormitoryIdFinal = parseInt(String(dormitoryParam), 10);
        }
      } else {
        // ถ้าไม่ใช่ object ให้แปลงเป็น integer ตามปกติ
        dormitoryIdFinal = parseInt(dormitoryParam, 10);
      }
      
      console.log('Converted dormitoryId:', dormitoryIdFinal);
      console.log('isNaN check:', isNaN(dormitoryIdFinal));
      
      if (isNaN(dormitoryIdFinal)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Invalid dormitory ID format' });
      }
    }

    console.log('ค่าที่ frontend ส่งมา:', req.body.dormitory);
    console.log('หลังแปลงเป็น integer:', dormitoryIdFinal);

    const newUser = await userService.upsertUserWithEmail({
      firebase_uid,
      email,
      displayName: fullName,
      photoUrl,
      memberType,
      phoneNumber,
      residenceDormId: dormitoryIdFinal
    });

    // บันทึก log ค่าของ newUser ที่ได้หลังจากลงทะเบียนเสร็จ
    console.log('==== New User Data After Registration ====');
    console.log('memberType from request:', memberType);
    console.log('memberType saved in DB:', newUser.member_type);
    console.log('User data:', newUser);

    await firebaseAdmin.auth().updateUser(firebase_uid, {
      displayName: fullName,
      ...(photoUrl && { photoURL: photoUrl })
    });

    const userProfile = {
      ...mapUserRowToProfile(newUser),
      // ใช้ memberType จาก input โดยตรง แทนที่จะใช้ค่าจาก database เพื่อให้แน่ใจว่าถูกต้อง
      memberType: memberType,
      needsProfileSetup: false
    };

    console.log('==== User Profile Response ====');
    console.log('memberType in response:', userProfile.memberType);
    console.log('Full response object:', userProfile);

    // สร้างคำขอเข้าหอพักอัตโนมัติถ้าเป็น member และมี dormitoryId
    if (memberType === 'member' && dormitoryIdFinal) {
      try {
        const userId = newUser.id !== undefined ? newUser.id : newUser.user_id;
        
        // ตรวจสอบว่ามีคำขอแล้วหรือไม่
        const existingRequest = await client.query(
          'SELECT * FROM member_requests WHERE user_id = $1 AND dorm_id = $2',
          [userId, dormitoryIdFinal]
        );
        
        if (existingRequest.rows.length === 0) {
          // สร้างคำขอใหม่
          await client.query(
            `INSERT INTO member_requests (user_id, dorm_id, request_date, status)
             VALUES ($1, $2, CURRENT_TIMESTAMP, 'รอพิจารณา')`,
            [userId, dormitoryIdFinal]
          );
          console.log(`Created membership request for user ${userId} to dormitory ${dormitoryIdFinal}`);
        }
      } catch (requestError) {
        console.error('Error creating membership request during registration:', requestError);
        // ไม่ต้อง rollback เพราะการสร้าง user สำเร็จแล้ว แค่ log error
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      message: 'User registered successfully!',
      user: userProfile
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Email Registration Error:', error);
    if (error.code === '23505') {
      return res.status(409).json({ message: 'อีเมลนี้ถูกใช้งานแล้ว' });
    }
    res.status(400).json({ message: 'Failed to register user.', error: error.message });
  } finally {
    client.release();
  }
};

exports.fetchCurrentUserProfile = async (req, res) => {
    try {
        const firebase_uid = req.user.uid;
        const user = await userService.getUserByFirebaseUid(firebase_uid);

        let calculatedNeedsProfileSetup = false;
        if (user) {
            // If user exists in DB, check completeness based on member type
            if (user.member_type === 'member') {
                if (!user.phone_number || !user.residence_dorm_id) {
                    calculatedNeedsProfileSetup = true;
                }
            } else if (user.member_type === 'owner') {
                calculatedNeedsProfileSetup = false;
            }
        } else {
            // If user only exists in Firebase Auth but not in our DB, they definitely need profile setup
            calculatedNeedsProfileSetup = true;
        }

        const userProfile = {
            uid: user ? user.firebase_uid : firebase_uid,
            username: user ? user.username : null,
            email: user ? user.email : req.user.email || null,
            displayName: user ? user.display_name : req.user.name || null,
            photoURL: user ? user.photo_url : req.user.picture || null,
            memberType: user ? user.member_type : null,
            phoneNumber: user ? user.phone_number || null : null,
            residenceDormId: user ? user.residence_dorm_id || null : null,
            needsProfileSetup: calculatedNeedsProfileSetup
        };
        res.json(userProfile);
    } catch (error) {
        console.error('Error fetching current user profile:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

exports.completeUserProfile = async (req, res) => {
  const firebase_uid = req.user.uid;
  const { phoneNumber, userType, dormitoryId } = req.body; // เปลี่ยนจาก dormitory เป็น dormitoryId
  
  console.log('=== Profile Completion Debug ===');
  console.log('Request body:', req.body);
  console.log('dormitoryId value:', dormitoryId);
  console.log('dormitoryId type:', typeof dormitoryId);

  if (!phoneNumber || !userType) {
    return res.status(400).json({ 
      message: 'Missing required fields: phoneNumber, userType.' 
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingUser = await userService.getUserByFirebaseUid(firebase_uid);

    let updatedUser;
    // แปลง dormitoryId เป็น integer ถ้าเป็น string
    let parsedDormitoryId = null;
    if (dormitoryId) {
      console.log('Converting dormitoryId to integer:', dormitoryId);
      
      // ตรวจสอบว่า dormitoryId เป็น object หรือไม่
      if (typeof dormitoryId === 'object' && dormitoryId !== null) {
        // ถ้าเป็น object ให้ดูว่ามี property id หรือ dorm_id หรือไม่
        if (dormitoryId.id) {
          parsedDormitoryId = parseInt(dormitoryId.id, 10);
        } else if (dormitoryId.dorm_id) {
          parsedDormitoryId = parseInt(dormitoryId.dorm_id, 10);
        } else {
          // ถ้าไม่มี id ให้ลองแปลงทั้ง object เป็น string แล้วแปลงเป็น integer
          parsedDormitoryId = parseInt(String(dormitoryId), 10);
        }
      } else {
        // ถ้าไม่ใช่ object ให้แปลงเป็น integer ตามปกติ
        parsedDormitoryId = parseInt(dormitoryId, 10);
      }
      
      console.log('Converted dormitoryId:', parsedDormitoryId);
      console.log('isNaN check:', isNaN(parsedDormitoryId));
      
      if (isNaN(parsedDormitoryId)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Invalid dormitory ID format' });
      }
    }

    const updateData = {
      memberType: userType,
      phoneNumber: phoneNumber,
      residenceDormId: parsedDormitoryId
    };

    if (!existingUser) {
      const username = await generateUsernameFromEmail(req.user.email || 'user');
      updatedUser = await userService.upsertUserWithEmail({
        firebase_uid,
        email: req.user.email || null,
        displayName: req.user.name || null,
        photoUrl: req.user.picture || null,
        ...updateData
      });
    } else {
      updatedUser = await userService.updateProfile(firebase_uid, updateData);
    }

    if (!updatedUser) {
      throw new Error('Failed to update or create user profile.');
    }

    // สร้างคำขอเข้าหอพักอัตโนมัติถ้าเป็น member และมี dormitoryId
    if (userType === 'member' && parsedDormitoryId) {
      try {
        const userId = updatedUser.id !== undefined ? updatedUser.id : updatedUser.user_id;
        
        // ตรวจสอบว่ามีคำขอแล้วหรือไม่
        const existingRequest = await client.query(
          'SELECT * FROM member_requests WHERE user_id = $1 AND dorm_id = $2',
          [userId, parsedDormitoryId]
        );
        
        if (existingRequest.rows.length === 0) {
          // สร้างคำขอใหม่
          await client.query(
            `INSERT INTO member_requests (user_id, dorm_id, request_date, status)
             VALUES ($1, $2, CURRENT_TIMESTAMP, 'รอพิจารณา')`,
            [userId, parsedDormitoryId]
          );
          console.log(`Created membership request for user ${userId} to dormitory ${parsedDormitoryId}`);
        }
      } catch (requestError) {
        console.error('Error creating membership request during profile completion:', requestError);
        // ไม่ต้อง rollback เพราะการอัพเดทโปรไฟล์สำเร็จแล้ว แค่ log error
      }
    }

    // สำหรับ member ที่ยังไม่เลือกหอพัก needsProfileSetup = false แล้ว
    // แต่จะมี flow เลือกหอพักแยกทีหลัง
    let calculatedNeedsProfileSetup = false;

    const userProfile = {
      ...mapUserRowToProfile(updatedUser),
      needsProfileSetup: calculatedNeedsProfileSetup
    };

    console.log('==== Debug updatedUser row ====');
    console.log(Object.keys(updatedUser), updatedUser);

    await client.query('COMMIT');
    res.json(userProfile);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating user profile:', error);
    res.status(500).json({ message: 'Failed to update profile.', error: error.message });
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
      WHERE d.approval_status = 'อนุมัติแล้ว'
      ORDER BY d.dorm_name
    `;
    
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching dormitory options:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
};

exports.getAllUsers = async (req, res) => {
    try {
        // TODO: Implement authorization check here (e.g., only 'admin' can access)
        if (req.user.memberType !== 'admin') { // Assuming req.user from verifyFirebaseToken has memberType
            return res.status(403).json({ message: 'Forbidden: Only administrators can access this resource.' });
        }
        const pool = require('../db');
        const result = await pool.query('SELECT * FROM users');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching users', error: error.message });
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
    
    if (user.role !== 'admin') {
      return res.status(403).json({ message: 'ไม่มีสิทธิ์เข้าใช้งานส่วนแอดมิน' });
    }
    
    // ส่งข้อมูลแอดมินกลับไป
    const adminProfile = {
      uid: user.firebase_uid,
      username: user.username,
      email: user.email,
      displayName: user.display_name,
      photoURL: user.photo_url || null,
      role: user.role
    };
    
    res.status(200).json(adminProfile);
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบแอดมิน', error: error.message });
  }
};

// เข้าสู่ระบบสำหรับแอดมิน (ไม่ผ่าน Firebase)
exports.adminDirectLogin = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ message: 'กรุณาระบุชื่อผู้ใช้และรหัสผ่าน' });
    }
    
    // ตรวจสอบว่ามีผู้ใช้นี้ในตาราง admins หรือไม่
    const query = 'SELECT * FROM admins WHERE username = $1';
    const result = await pool.query(query, [username]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
    
    const admin = result.rows[0];
    
    // ตรวจสอบรหัสผ่าน
    const passwordMatch = await bcrypt.compare(password, admin.password_hash);
    
    if (!passwordMatch) {
      return res.status(401).json({ message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
    
    // สร้าง JWT token
    const token = jwt.sign(
      { 
        admin_id: admin.admin_id, 
        username: admin.username 
      }, 
      ADMIN_JWT_SECRET, 
      { expiresIn: '24h' }
    );
    
    // อัพเดต last_login
    await pool.query(
      'UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE admin_id = $1',
      [admin.admin_id]
    );
    
    // ส่งข้อมูลแอดมินและ token กลับไป (ไม่รวมรหัสผ่าน)
    const adminProfile = {
      admin_id: admin.admin_id,
      username: admin.username,
      display_name: admin.display_name,
      photo_url: admin.photo_url
    };
    
    res.status(200).json({
      message: 'เข้าสู่ระบบสำเร็จ',
      admin: adminProfile,
      token: token
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบแอดมิน', error: error.message });
  }
};

// เปลี่ยนรหัสผ่านสำหรับแอดมิน
exports.changeAdminPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const { admin_id } = req.admin; // จาก token ที่ verify แล้ว
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'กรุณาระบุรหัสผ่านปัจจุบันและรหัสผ่านใหม่' });
    }
    
    // ตรวจสอบว่ามีผู้ใช้นี้ในตาราง admins หรือไม่
    const query = 'SELECT * FROM admins WHERE admin_id = $1';
    const result = await pool.query(query, [admin_id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบข้อมูลแอดมิน' });
    }
    
    const admin = result.rows[0];
    
    // ตรวจสอบรหัสผ่านปัจจุบัน
    const passwordMatch = await bcrypt.compare(currentPassword, admin.password_hash);
    
    if (!passwordMatch) {
      return res.status(401).json({ message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    }
    
    // สร้าง hash รหัสผ่านใหม่
    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);
    
    // อัพเดตรหัสผ่าน
    await pool.query(
      'UPDATE admins SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE admin_id = $2',
      [newPasswordHash, admin_id]
    );
    
    res.status(200).json({ message: 'เปลี่ยนรหัสผ่านสำเร็จ' });
  } catch (error) {
    console.error('Error changing admin password:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน', error: error.message });
  }
};