const { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');

// Cloudflare R2 Configuration using AWS SDK v3
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY_ID; // S3 Access Key
const R2_SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY; // S3 Secret Key
const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN;

// Create S3 client for R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  },
  forcePathStyle: true,
});

if (!R2_ENDPOINT || !R2_ACCESS_KEY || !R2_SECRET_KEY || !R2_BUCKET) {
  console.error('❌ R2 environment variables are required:');
  console.error('- R2_ENDPOINT');
  console.error('- R2_ACCESS_KEY_ID');
  console.error('- R2_SECRET_ACCESS_KEY');
  console.error('- R2_BUCKET_NAME');
  process.exit(1);
}

console.log('✅ R2 Storage configured successfully');
console.log('Bucket:', R2_BUCKET);
console.log('Endpoint:', R2_ENDPOINT);

/**
 * Initialize fetch dynamically
 */
const getFetch = async () => {
  if (!fetch) {
    const { default: nodeFetch } = await import('node-fetch');
    fetch = nodeFetch;
  }
  return fetch;
};

/**
 * Upload file to Cloudflare R2 using AWS SDK v3
 * @param {object} file - The file object from multer (req.file).
 * @param {string} folderType - Type of folder: 'profile', 'dorm', 'review', etc.
 * @param {string} subFolder - Sub-folder name (optional, e.g., dorm name).
 * @returns {Promise<string>} The public URL of the uploaded file.
 */
const uploadImage = async (file, folderType = 'profile', subFolder = null) => {
  if (!file) {
    return null;
  }

  try {
    // สร้างชื่อไฟล์ที่ไม่ซ้ำกัน
    const originalName = file.originalname || 'image';
    const extension = originalName.split('.').pop() || 'jpg';
    const shortName = originalName.replace(/\.[^/.]+$/, '').substring(0, 20);
    const uniqueFileName = `${uuidv4()}-${shortName}.${extension}`;
    
    // กำหนด folder structure ตามประเภท
    let folderPath;
    switch (folderType) {
      case 'profile':
        folderPath = 'User_Profiles';
        break;
      case 'dorm':
        folderPath = subFolder ? `Dorm_Gallery/${subFolder}` : 'Dorm_Gallery/General';
        break;
      case 'review':
        folderPath = subFolder ? `Review_Images/${subFolder}` : 'Review_Images/General';
        break;
      case 'admin':
        folderPath = 'Admin_Uploads';
        break;
      default:
        folderPath = 'Misc_Uploads';
    }
    
    const objectKey = `${folderPath}/${uniqueFileName}`;

    console.log('Uploading to R2:', objectKey);

    // Upload using AWS SDK v3
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: objectKey,
      Body: file.buffer,
      ContentType: file.mimetype,
      Metadata: {
        'uploaded-by': 'dormroomaroo-backend',
        'upload-date': new Date().toISOString(),
        'folder-type': folderType,
        'sub-folder': encodeURIComponent(subFolder || 'none'), // เข้ารหัส URL เพื่อรองรับตัวอักษรไทย
      }
    });

    await s3Client.send(command);

    // Generate public URL
    let publicUrl;
    if (R2_PUBLIC_DOMAIN) {
      publicUrl = `${R2_PUBLIC_DOMAIN}/${objectKey}`;
    } else {
      // Extract account ID from endpoint for pub URL
      const accountId = R2_ENDPOINT.match(/https:\/\/(.+?)\.r2\.cloudflarestorage\.com/)?.[1];
      publicUrl = `https://pub-${accountId}.r2.dev/${objectKey}`;
    }

    console.log('✅ File uploaded successfully to R2');
    console.log('Public URL:', publicUrl);
    return publicUrl;

  } catch (error) {
    console.error('❌ R2 upload error:', error);
    throw new Error(`Could not upload file to R2 Storage: ${error.message}`);
  }
};

/**
 * Uploads dormitory image to R2 Storage in Dorm_Gallery folder.
 * @param {object} file - The file object from multer (req.file).
 * @param {string} dormName - The dormitory name for folder organization.
 * @returns {Promise<string>} The public URL of the uploaded file.
 */
const uploadDormitoryImage = (file, dormName) => {
  return uploadImage(file, 'dorm', dormName);
};

/**
 * Uploads user profile image to R2 Storage in User_Profiles folder.
 * @param {object} file - The file object from multer (req.file).
 * @returns {Promise<string>} The public URL of the uploaded file.
 */
const uploadProfileImage = (file) => {
  return uploadImage(file, 'profile');
};

/**
 * Uploads review image to R2 Storage in Review_Images folder.
 * @param {object} file - The file object from multer (req.file).
 * @param {string} dormName - The dormitory name for folder organization.
 * @returns {Promise<string>} The public URL of the uploaded file.
 */
const uploadReviewImage = (file, dormName) => {
  return uploadImage(file, 'review', dormName);
};

/**
 * Delete a file from R2 Storage
 * @param {string} fileUrl - The public URL of the file to delete
 * @returns {Promise<boolean>} Success status
 */
const deleteImage = async (fileUrl) => {
  try {
    // Extract object key from URL
    const url = new URL(fileUrl);
    let objectKey;
    
    if (R2_PUBLIC_DOMAIN && fileUrl.includes(R2_PUBLIC_DOMAIN)) {
      objectKey = url.pathname.substring(1); // Remove leading slash
    } else {
      // Handle R2 public URL format
      objectKey = url.pathname.substring(1);
    }

    const command = new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: objectKey,
    });

    await s3Client.send(command);
    console.log('✅ File deleted successfully from R2:', objectKey);
    return true;

  } catch (error) {
    console.error('❌ R2 delete error:', error);
    return false;
  }
};

/**
 * List files in R2 bucket (for debugging)
 * @param {string} prefix - Folder prefix to filter
 * @returns {Promise<Array>} List of files
 */
const listFiles = async (prefix = '') => {
  try {
    const command = new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: prefix,
      MaxKeys: 100,
    });

    const response = await s3Client.send(command);
    return response.Contents || [];

  } catch (error) {
    console.error('❌ R2 list error:', error);
    return [];
  }
};

module.exports = {
  uploadImage,
  uploadDormitoryImage,
  uploadProfileImage,
  uploadReviewImage,
  deleteImage,
  listFiles,
};