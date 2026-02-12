// src/config/firebase.js
const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

// 1. Load Service Account Keys
let mainServiceAccount, storageServiceAccount;

// Try to load from environment variable first, then from file
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  try {
    mainServiceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    console.log('Main Firebase service account loaded from environment variable');
    console.log('Project ID:', mainServiceAccount.project_id);
  } catch (error) {
    console.error('Error parsing FIREBASE_SERVICE_ACCOUNT_KEY environment variable:', error);
    process.exit(1);
  }
} else {
  // Fallback to file
  const mainServiceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH || './firebase-admin-key.json';
  try {
    const mainKeyPath = path.resolve(process.cwd(), mainServiceAccountPath);
    mainServiceAccount = require(mainKeyPath);
    console.log('Main Firebase service account loaded from file:', mainKeyPath);
    console.log('Project ID:', mainServiceAccount.project_id);
  } catch (error) {
    console.error('Error loading main Firebase service account key from file:', error);
    console.error('Attempted path:', path.resolve(process.cwd(), mainServiceAccountPath));
    console.error('Please set FIREBASE_SERVICE_ACCOUNT_KEY environment variable or provide the key file');
    process.exit(1);
  }
}

// Load storage service account
if (process.env.FIREBASE_STORAGE_SERVICE_ACCOUNT_KEY) {
  try {
    storageServiceAccount = JSON.parse(process.env.FIREBASE_STORAGE_SERVICE_ACCOUNT_KEY);
    console.log('Storage Firebase service account loaded from environment variable');
  } catch (error) {
    console.error('Error parsing FIREBASE_STORAGE_SERVICE_ACCOUNT_KEY environment variable:', error);
    process.exit(1);
  }
} else {
  // Fallback to file
  const storageServiceAccountPath = process.env.FIREBASE_STORAGE_SERVICE_ACCOUNT_KEY_PATH || './storage-admin-key.json';
  try {
    const storageKeyPath = path.resolve(process.cwd(), storageServiceAccountPath);
    storageServiceAccount = require(storageKeyPath);
    console.log('Storage Firebase service account loaded from file:', storageKeyPath);
  } catch (error) {
    console.error('Error loading storage Firebase service account key from file:', error);
    console.error('Attempted path:', path.resolve(process.cwd(), storageServiceAccountPath));
    console.error('Please set FIREBASE_STORAGE_SERVICE_ACCOUNT_KEY environment variable or provide the key file');
    process.exit(1);
  }
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