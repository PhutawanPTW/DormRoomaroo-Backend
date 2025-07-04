// src/config/firebase.js
const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

// 1. Load Service Account Keys
const mainServiceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || '../../firebase-admin-key.json';
const storageServiceAccountPath = process.env.FIREBASE_STORAGE_SERVICE_ACCOUNT_KEY_PATH || '../../storage-admin-key.json';

let mainServiceAccount, storageServiceAccount;

try {
  // ใช้ path.resolve เพื่อแก้ปัญหา path ไม่ถูกต้อง
  const mainKeyPath = path.resolve(__dirname, mainServiceAccountPath.startsWith('./') ? 
    '../..' + mainServiceAccountPath.substring(1) : mainServiceAccountPath);
  
  mainServiceAccount = require(mainServiceAccountPath.startsWith('./') ? 
    path.resolve(__dirname, '../..', mainServiceAccountPath.substring(2)) : mainServiceAccountPath);
    
  console.log('Main Firebase service account loaded successfully.');
} catch (error) {
  console.error('Error loading main Firebase service account key:', error);
  process.exit(1);
}

try {
  storageServiceAccount = require(storageServiceAccountPath.startsWith('./') ? 
    path.resolve(__dirname, '../..', storageServiceAccountPath.substring(2)) : storageServiceAccountPath);
    
  console.log('Storage Firebase service account loaded successfully.');
} catch (error) {
  console.error('Error loading storage Firebase service account key:', error);
  process.exit(1);
}

// 2. Initialize the default app (for Auth, etc.)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(mainServiceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || mainServiceAccount.project_id
  }, 'default'); // Explicitly name the default app
  console.log('Default Firebase Admin SDK initialized successfully.');
}

// 3. Initialize the secondary app for Storage
// Check if the app is already initialized before trying to create it
if (!admin.apps.some(app => app.name === 'storageApp')) {
    admin.initializeApp({
        credential: admin.credential.cert(storageServiceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "projectviewmash-bac0a.appspot.com"
    }, 'storageApp');
    console.log('Storage Firebase Admin SDK initialized successfully.');
}


// 4. Export both apps
module.exports = {
  default: admin.app('default'),
  storageApp: admin.app('storageApp')
};