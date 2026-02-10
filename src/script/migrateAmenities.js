// src/script/migrateAmenities.js
// Script สำหรับสร้างตาราง amenities และ migrate ข้อมูล

const pool = require('../db');
const fs = require('fs');
const path = require('path');

async function migrateAmenities() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting amenities migration...\n');
    
    await client.query('BEGIN');
    
    // อ่านไฟล์ SQL
    const sqlPath = path.join(__dirname, 'createAmenitiesTable.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // รัน SQL
    await client.query(sql);
    
    console.log('✅ Created amenities table');
    console.log('✅ Inserted 24 standard amenities');
    console.log('✅ Set sequence to start from 25');
    console.log('✅ Created indexes');
    console.log('✅ Added foreign key constraint');
    
    // ตรวจสอบผลลัพธ์
    const result = await client.query('SELECT COUNT(*) as count FROM amenities');
    console.log(`\n📊 Total amenities: ${result.rows[0].count}`);
    
    // แสดง amenities ทั้งหมด
    const amenities = await client.query(
      'SELECT amenity_id, amenity_name, amenity_type, category FROM amenities ORDER BY amenity_id'
    );
    
    console.log('\n📋 Amenities list:');
    amenities.rows.forEach(a => {
      console.log(`  ${a.amenity_id}. ${a.amenity_name} (${a.amenity_type}, ${a.category || 'N/A'})`);
    });
    
    await client.query('COMMIT');
    
    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    pool.end();
  }
}

// รัน migration
migrateAmenities()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Error:', error.message);
    process.exit(1);
  });
