// ทดสอบการเชื่อมต่อ Cloudflare R2
require('dotenv').config();

console.log('Testing Cloudflare R2 configuration...');
console.log('R2_ENDPOINT:', process.env.R2_ENDPOINT);
console.log('R2_BUCKET_NAME:', process.env.R2_BUCKET_NAME);
console.log('R2_ACCESS_KEY_ID:', process.env.R2_ACCESS_KEY_ID ? '✅ Set' : '❌ Missing');
console.log('R2_SECRET_ACCESS_KEY:', process.env.R2_SECRET_ACCESS_KEY ? '✅ Set' : '❌ Missing');

try {
  const r2Storage = require('./src/services/r2StorageService');
  console.log('✅ R2 Storage service loaded successfully');
  
  // ทดสอบ list files
  r2Storage.listFiles().then(files => {
    console.log('✅ R2 connection successful');
    console.log(`Found ${files.length} files in bucket`);
    if (files.length > 0) {
      console.log('Sample files:', files.slice(0, 3).map(f => f.Key));
    }
  }).catch(error => {
    console.error('❌ R2 connection failed:', error.message);
  });
  
} catch (error) {
  console.error('❌ Error loading R2 config:', error.message);
}