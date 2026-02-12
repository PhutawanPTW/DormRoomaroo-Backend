// src/config/firebase.js
const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

// Load Firebase Service Account Key for Authentication only
let serviceAccount;

// Try to load from environment variable first, then from file
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    console.log('Firebase service account loaded from environment variable');
    console.log('Project ID:', serviceAccount.project_id);
  } catch (error) {
    console.error('Error parsing FIREBASE_SERVICE_ACCOUNT_KEY environment variable:', error);
    process.exit(1);
  }
} else {
  // Fallback to file
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || './firebase-admin-key.json';
  try {
    const keyPath = path.resolve(process.cwd(), serviceAccountPath);
    serviceAccount = require(keyPath);
    console.log('Firebase service account loaded from file:', keyPath);
    console.log('Project ID:', serviceAccount.project_id);
  } catch (error) {
    console.error('Error loading Firebase service account key from file:', error);
    console.error('Attempted path:', path.resolve(process.cwd(), serviceAccountPath));
    console.error('Please set FIREBASE_SERVICE_ACCOUNT_KEY environment variable or provide the key file');
    process.exit(1);
  }
}

// Initialize Firebase Admin SDK (for Authentication only)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
    // เพิ่มการตั้งค่าเพื่อแก้ปัญหา metadata.google.internal
    httpAgent: undefined,
    // บังคับใช้ service account credential แทน metadata server
    serviceAccountId: serviceAccount.client_email
  });
  console.log('✅ Firebase Admin SDK initialized successfully (Authentication only)');
  console.log('📦 Storage: Using Cloudflare R2 instead of Firebase Storage');
  console.log('🔑 Using service account:', serviceAccount.client_email);
}

// Export the default app
module.exports = admin;