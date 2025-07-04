const { storageApp } = require('../config/firebase');
const { v4: uuidv4 } = require('uuid');

// Always use the bucket that was configured for the storageApp. If the env var
// is present we prefer it, otherwise we fall back to the bucket specified when
// the app was initialised in src/config/firebase.js.  Being explicit here
// prevents the Admin SDK from accidentally falling back to the default app's
// bucket when the configuration is missing or incorrect.

const bucketName = process.env.FIREBASE_STORAGE_BUCKET || storageApp.options.storageBucket;

if (!bucketName) {
  // This should never happen because we initialise storageApp with a bucket
  // name, but having a guard makes debugging easier when deploying in new
  // environments.
  // eslint-disable-next-line no-console
  console.warn(
    '⚠️  Firebase storage bucket name is not set. Falling back to default bucket.  ' +
    'Please set the FIREBASE_STORAGE_BUCKET environment variable or provide   ' +
    '"storageBucket" when initialising the Firebase app.'
  );
}

const bucket = storageApp.storage().bucket(bucketName);

/**
 * Uploads a file to Firebase Storage and returns the public URL.
 * @param {object} file - The file object from multer (req.file).
 * @returns {Promise<string>} The public URL of the uploaded file.
 */
const uploadImage = (file) => {
  if (!file) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    // สร้างชื่อไฟล์ที่ไม่ซ้ำกัน โดยใช้ UUID และเก็บนามสกุลเดิม
    const uniqueFileName = `${uuidv4()}-${file.originalname}`;
    const blob = bucket.file(`Profile_Roomaroo/${uniqueFileName}`);

    const blobStream = blob.createWriteStream({
      metadata: {
        contentType: file.mimetype,
        // เพิ่ม token สำหรับการเข้าถึงแบบ public
        metadata: {
            firebaseStorageDownloadTokens: uuidv4(),
        }
      },
      resumable: false,
    });

    blobStream.on('error', (err) => {
      console.error('Blob stream error:', err);
      reject(new Error('Could not upload the file to Firebase Storage.'));
    });

    blobStream.on('finish', () => {
      // สร้าง Public URL
      const publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(blob.name)}?alt=media&token=${blob.metadata.metadata.firebaseStorageDownloadTokens}`;
      console.log('File uploaded successfully. Public URL:', publicUrl);
      resolve(publicUrl);
    });

    blobStream.end(file.buffer);
  });
};

module.exports = {
  uploadImage,
}; 