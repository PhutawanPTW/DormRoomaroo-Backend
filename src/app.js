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
app.use('/api/dormitories', dormitoryRoutes);
app.use('/api/zones', zoneRoutes);

// Start Server
app.listen(PORT, () => {
  console.log(`DormRoomaroo Backend server listening on port ${PORT}`);
  console.log(`Connected to database: ${process.env.DATABASE_URL ? 'Yes' : 'No'}`);
  console.log(`Firebase Project ID: ${process.env.FIREBASE_PROJECT_ID}`);
});

module.exports = app;