// ทดสอบการโหลด Firebase config
require('dotenv').config();

console.log('Testing Firebase configuration...');
console.log('FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID);
console.log('FIREBASE_SERVICE_ACCOUNT_KEY_PATH:', process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH);

try {
  const firebase = require('./src/config/firebase');
  console.log('✅ Firebase config loaded successfully');
  
  // ทดสอบ Firebase Admin
  const admin = firebase.default;
  console.log('✅ Firebase Admin app initialized');
  console.log('Project ID:', admin.options.projectId);
  
} catch (error) {
  console.error('❌ Error loading Firebase config:', error.message);
  console.error('Full error:', error);
}