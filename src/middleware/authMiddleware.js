// src/middleware/authMiddleware.js
const firebaseAdmin = require('../config/firebase'); // Use the default app
const pool = require('../db');

async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization;
  
  // Minimal auth header validation logs (debug removed)
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided or malformed.' });
  }

  const idToken = authHeader.split(' ')[1]; // ดึง ID Token ออกมา
  // Avoid logging tokens
  
  try {
    console.log('Verifying Firebase ID token...');
    // เพิ่ม checkRevoked: false เพื่อลดการเรียก metadata server
    const decodedToken = await firebaseAdmin.auth().verifyIdToken(idToken, false);
    console.log('Token verified successfully for user:', decodedToken.uid);
    req.user = decodedToken; // เก็บ decoded token ไว้ใน req.user
    next(); // ไปยัง Middleware หรือ Controller ถัดไป
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    
    // แจ้ง Error ตามประเภท เช่น expired token
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ 
        error: 'Unauthorized: ID token has expired.', 
        code: 'token-expired',
        message: 'Your session has expired. Please login again.'
      });
    }
    if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({ 
        error: 'Unauthorized: ID token has been revoked.', 
        code: 'token-revoked',
        message: 'Your session has been revoked. Please login again.'
      });
    }
    if (error.message && error.message.includes('metadata.google.internal')) {
      return res.status(401).json({ 
        error: 'Unauthorized: Firebase service configuration error.', 
        code: 'service-config-error',
        message: 'Authentication service temporarily unavailable. Please try again.'
      });
    }
    return res.status(401).json({ 
      error: 'Unauthorized: Invalid ID token.', 
      code: 'token-invalid',
      message: 'Invalid authentication token. Please login again.'
    });
  }
}

// ตรวจสอบว่าผู้ใช้เป็นแอดมินหรือไม่
async function requireAdmin(req, res, next) {
  if (!req.user || !req.user.uid) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required.' });
  }

  try {
    // ตรวจสอบสถานะแอดมินจากฐานข้อมูล
    const result = await pool.query(
      'SELECT member_type FROM users WHERE firebase_uid = $1',
      [req.user.uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found in database.' });
    }

    const user = result.rows[0];
    if (user.member_type !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin privileges required.' });
    }

    // ถ้าเป็นแอดมิน ให้ดำเนินการต่อ
    next();
  } catch (error) {
    console.error('Error checking admin privileges:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}

module.exports = { verifyFirebaseToken, requireAdmin };