// src/app.js
require('dotenv').config();

// เรียกใช้ Firebase Admin SDK เพื่อให้แน่ใจว่า initialized ตั้งแต่เริ่มต้น
const admin = require('./config/firebase');

const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// Import Routes
const authRoutes = require('./routes/auth');
const dormitoryRoutes = require('./routes/dormitoryRoutes');
const zoneRoutes = require('./routes/zoneRoutes');
const adminDormitoryRoutes = require('./routes/adminDormitoryRoutes');
const addDormitoryRoutes = require('./routes/addDormitoryRoutes');
const deleteDormitoryRoutes = require('./routes/deleteDormitoryRoutes');
const profileRoutes = require('./routes/profileRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const editDormitoryRoutes = require('./routes/editDormitoryRoutes');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads')); // ทำให้เข้าถึงไฟล์ใน uploads ได้

// Basic Route (สำหรับทดสอบว่า Backend รันอยู่)
app.get('/', (req, res) => {
  res.send('DormRoomaroo Backend API is running!');
});

// API Routes
app.use('/api/auth', authRoutes);
// เพิ่ม route สำหรับแก้ปัญหา /api/api/ ที่ Frontend เรียกผิด
app.use('/api/api/auth', authRoutes);
app.use('/api/dormitories', dormitoryRoutes);
app.use('/api/zones', zoneRoutes);
app.use('/api/admin/dormitories', adminDormitoryRoutes);
app.use('/api/add-dormitory', addDormitoryRoutes);
app.use('/api/delete-dormitory', deleteDormitoryRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/edit-dormitory', editDormitoryRoutes);

// Start Server
app.listen(PORT, () => {
  console.log(`DormRoomaroo API listening on port ${PORT}`);
});

module.exports = app;