const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

// Configure AWS SDK for Cloudflare R2
const s3 = new AWS.S3({
  endpoint: process.env.R2_ENDPOINT,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  region: 'auto',
  signatureVersion: 'v4',
  s3ForcePathStyle: true, // Required for R2
});

const bucketName = process.env.R2_BUCKET_NAME;
const publicDomain = process.env.R2_PUBLIC_DOMAIN;

if (!bucketName || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
  console.error('❌ R2 environment variables are required:');
  console.error('- R2_ENDPOINT');
  console.error('- R2_ACCESS_KEY_ID');
  console.error('- R2_SECRET_ACCESS_KEY');
  console.error('- R2_BUCKET_NAME');
  process.exit(1);
}

console.log('✅ R2 Storage configured successfully');
console.log('Bucket:', bucketName);
console.log('Endpoint:', process.env.R2_ENDPOINT);

/**
 * Uploads a file to Cloudflare R2 and returns the public URL.
 * @param {object} file - The file object from multer (req.file).
 * @param {string} dormName - The dormitory name for folder organization.
 * @returns {Promise<string>} The public URL of the uploaded file.
 */
const uploadImage = async (file, dormName = null) => {
  if (!file) {
    return null;
  }

  try {
    // สร้างชื่อไฟล์ที่ไม่ซ้ำกัน
    const originalName = file.originalname || 'image';
    const extension = originalName.split('.').pop() || 'jpg';
    const shortName = originalName.replace(/\.[^/.]+$/, '').substring(0, 20);
    const uniqueFileName = `${uuidv4()}-${shortName}.${extension}`;
    
    // เลือก path ตาม context
    const folderPath = dormName 
      ? `Dorm_Gallery/${dormName}` 
      : `Profile_Roomaroo`;
    
    const key = `${folderPath}/${uniqueFileName}`;

    // Upload to R2
    const uploadParams = {
      Bucket: bucketName,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      // Metadata for better organization
      Metadata: {
        'uploaded-by': 'dormroomaroo-backend',
        'upload-date': new Date().toISOString(),
        'dorm-name': dormName || 'profile',
      }
    };

    console.log('Uploading to R2:', key);
    const result = await s3.upload(uploadParams).promise();
    
    // Generate public URL
    let publicUrl;
    if (publicDomain) {
      publicUrl = `${publicDomain}/${key}`;
    } else {
      // Use R2 public URL format
      const accountId = process.env.R2_ENDPOINT.match(/https:\/\/(.+?)\.r2\.cloudflarestorage\.com/)?.[1];
      publicUrl = `https://pub-${accountId}.r2.dev/${key}`;
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
  return uploadImage(file, dormName);
};

/**
 * Delete a file from R2 Storage
 * @param {string} fileUrl - The public URL of the file to delete
 * @returns {Promise<boolean>} Success status
 */
const deleteImage = async (fileUrl) => {
  try {
    // Extract key from URL
    const url = new URL(fileUrl);
    let key;
    
    if (publicDomain && fileUrl.includes(publicDomain)) {
      key = url.pathname.substring(1); // Remove leading slash
    } else {
      // Handle R2 public URL format
      key = url.pathname.substring(1);
    }

    const deleteParams = {
      Bucket: bucketName,
      Key: key,
    };

    await s3.deleteObject(deleteParams).promise();
    console.log('✅ File deleted successfully from R2:', key);
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
    const params = {
      Bucket: bucketName,
      Prefix: prefix,
      MaxKeys: 100,
    };

    const result = await s3.listObjectsV2(params).promise();
    return result.Contents || [];

  } catch (error) {
    console.error('❌ R2 list error:', error);
    return [];
  }
};

module.exports = {
  uploadImage,
  uploadDormitoryImage,
  deleteImage,
  listFiles,
};