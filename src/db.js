// src/db.js
const { Pool } = require('pg');
require('dotenv').config();

console.log('Database URL:', process.env.DATABASE_URL); // เพิ่มบรรทัดนี้

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL is not set in .env file.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

pool.on('connect', () => {
  console.log('Connected to PostgreSQL database!');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;