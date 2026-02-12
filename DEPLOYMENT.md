# DormRoomaroo Backend - Deployment Guide

## Architecture Overview

```
Frontend → Backend → NeonDB (Database)
                  → Firebase (Authentication only)  
                  → Cloudflare R2 (Image Storage)
```

## Environment Variables Required

### Database
```bash
DATABASE_URL=postgresql://username:password@host:port/database?sslmode=require
```

### Firebase (Authentication Only)
```bash
FIREBASE_PROJECT_ID=your-project-id
# For production, use environment variables instead of files:
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
FIREBASE_STORAGE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
```

### Cloudflare R2 Storage
```bash
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-s3-access-key
R2_SECRET_ACCESS_KEY=your-s3-secret-key
R2_BUCKET_NAME=your-bucket-name
R2_PUBLIC_DOMAIN=https://pub-your-hash.r2.dev
```

### Optional
```bash
ML_API_URL=http://localhost:8000
PORT=3000
```

## Deployment Steps

### 1. Set Environment Variables
- Set all required environment variables in your hosting platform
- **NEVER** commit service account keys to repository
- Use environment variables for production secrets

### 2. Database Setup
- Ensure NeonDB is accessible from your hosting environment
- Run any pending migrations if needed

### 3. Firebase Setup
- Firebase is used ONLY for authentication
- Ensure service account keys have proper permissions
- Test authentication endpoints

### 4. Cloudflare R2 Setup
- Create R2 bucket in Cloudflare dashboard
- Generate S3-compatible credentials (recommended over API tokens)
- Configure public domain for image access
- Test upload/download functionality

### 5. Deploy Application
```bash
npm install
npm start
```

## Storage Migration Notes

- **Migrated from Firebase Storage to Cloudflare R2**
- **Benefits**: 10GB free storage + no bandwidth costs vs Firebase's 1GB limit
- **Compatibility**: Uses AWS SDK v3 with S3-compatible API
- **Organization**: Images stored in `Dorm_Gallery/{dorm-name}/` and `Profile_Roomaroo/`

## Security Notes

- Service account keys are in `.gitignore`
- Use environment variables for all secrets in production
- R2 credentials use S3-compatible format for better compatibility
- Firebase Storage bucket kept for potential future use (auth only)

## Testing

Test R2 connection:
```bash
node test-r2-config.js
```

Expected output:
```
✅ R2 connection successful
Found X files in bucket
```