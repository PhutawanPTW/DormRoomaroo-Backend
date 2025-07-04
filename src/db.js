// src/db.js
const { Pool } = require('pg');
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL is not set in .env file.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // สำหรับการ deploy บนบาง environment เช่น Heroku อาจต้องใช้ SSL
  // แต่ถ้า local development หรือ Docker ที่ไม่ได้ใช้ SSL ให้คอมเมนต์ออก
  // ssl: {
  //   rejectUnauthorized: false
  // }
});

pool.on('connect', () => {
  console.log('Connected to PostgreSQL database!');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;