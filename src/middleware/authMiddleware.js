// src/middleware/authMiddleware.js
const firebaseAdmin = require('../config/firebase').default; // Use the default app
const pool = require('../db');
const jwt = require('jsonwebtoken');

// JWT Secret Key สำหรับแอดมิน (ควรเก็บใน .env file)
const ADMIN_JWT_SECRET = 'DormRoomaroo-Admin-Secret-Key-2024';

async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization;
  
  console.log('Auth header present:', !!authHeader);
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided or malformed.' });
  }

  const idToken = authHeader.split(' ')[1]; // ดึง ID Token ออกมา
  console.log('Token received, length:', idToken.length);
  
  try {
    console.log('Attempting to verify token...');
    const decodedToken = await firebaseAdmin.auth().verifyIdToken(idToken);
    console.log('Token verified successfully for user:', decodedToken.uid);
    req.user = decodedToken; // เก็บ decoded token ไว้ใน req.user
    next(); // ไปยัง Middleware หรือ Controller ถัดไป
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    // แจ้ง Error ตามประเภท เช่น expired token
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Unauthorized: ID token has expired.' });
    }
    return res.status(401).json({ error: 'Unauthorized: Invalid ID token.', details: error.message });
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
      'SELECT role FROM users WHERE firebase_uid = $1',
      [req.user.uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found in database.' });
    }

    const user = result.rows[0];
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin privileges required.' });
    }

    // ถ้าเป็นแอดมิน ให้ดำเนินการต่อ
    next();
  } catch (error) {
    console.error('Error checking admin privileges:', error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
}

// ตรวจสอบ JWT token ของแอดมิน
function verifyAdminToken(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided or malformed.' });
  }

  const token = authHeader.split(' ')[1]; // ดึง Token ออกมา
  
  try {
    const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
    req.admin = decoded; // เก็บข้อมูลแอดมินไว้ใน req.admin
    next();
  } catch (error) {
    console.error('Error verifying admin token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid admin token.', details: error.message });
  }
}

module.exports = { verifyFirebaseToken, requireAdmin, verifyAdminToken, ADMIN_JWT_SECRET };