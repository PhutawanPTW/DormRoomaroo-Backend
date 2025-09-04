// src/db.js
const { Pool } = require('pg');
require('dotenv').config();

// Avoid printing secrets

if (!process.env.DATABASE_URL) {
  console.error("Error: DATABASE_URL is not set in .env file.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Optional: you can add minimal health logs if needed

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

module.exports = pool;