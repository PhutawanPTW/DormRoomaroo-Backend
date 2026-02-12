# Deployment Guide

## Environment Variables Setup

### For Render.com Deployment

1. ไปที่ Render.com Dashboard
2. เลือก Service ของคุณ
3. ไปที่ Environment tab
4. เพิ่ม Environment Variables ต่อไปนี้:

```
DATABASE_URL=postgresql://username:password@host:port/database?sslmode=require
FIREBASE_PROJECT_ID=projectroomaroo
PORT=3000
ML_API_URL=http://localhost:8000
```

### Firebase Service Account Keys (สำหรับ Authentication)

**สำคัญ:** ไม่ควรเก็บ service account key ใน repository

#### วิธีที่ 1: ใช้ Environment Variables (แนะนำสำหรับ production)

1. ไปที่ [Firebase Console](https://console.firebase.google.com)
2. เลือกโปรเจค "projectroomaroo"
3. Project Settings → Service accounts
4. Generate new private key (ดาวน์โหลดไฟล์ JSON)
5. Copy เนื้อหาในไฟล์ JSON
6. ตั้งค่า Environment Variables:

```
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"projectroomaroo",...}
```

### Cloudflare R2 Storage Setup (สำหรับเก็บรูปภาพ)

#### ขั้นตอนที่ 1: สร้าง R2 Bucket

1. ไปที่ https://dash.cloudflare.com
2. ล็อกอิน/สมัครสมาชิก
3. ไปที่ **R2 Object Storage**
4. คลิก **Create bucket**
5. ตั้งชื่อ: `dormroomaroo-storage`
6. เลือก region ใกล้ไทย (Singapore)

#### ขั้นตอนที่ 2: สร้าง API Token

1. ใน R2 dashboard → **Manage R2 API tokens**
2. คลิก **Create API token**
3. ตั้งชื่อ: `DormRoomaroo Backend`
4. Permissions: **Object Read and Write**
5. เก็บ **Access Key ID** และ **Secret Access Key**

#### ขั้นตอนที่ 3: ตั้งค่า Environment Variables

```
R2_ENDPOINT=https://[your-account-id].r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-access-key-id
R2_SECRET_ACCESS_KEY=your-secret-access-key
R2_BUCKET_NAME=dormroomaroo-storage
R2_PUBLIC_DOMAIN=https://your-custom-domain.com
```

**หมายเหตุ:** 
- `R2_ENDPOINT` หาได้จาก R2 dashboard
- `R2_PUBLIC_DOMAIN` เป็น optional สำหรับ custom domain

## การ Deploy

1. Push code ไป repository
2. Render.com จะ deploy อัตโนมัติ
3. ตรวจสอบ logs ว่า Firebase และ R2 โหลดสำเร็จ

## การทดสอบ

### ทดสอบ Firebase:
```bash
node test-firebase-config.js
```

### ทดสอบ R2:
```bash
node test-r2-config.js
```

## Troubleshooting

### ปัญหา: "Invalid ID token"
- ตรวจสอบว่า Firebase service account key ถูกต้อง
- ตรวจสอบว่า FIREBASE_PROJECT_ID ตรงกับโปรเจคใน Firebase Console
- Restart service หลังจากเปลี่ยน environment variables

### ปัญหา: "R2 upload error"
- ตรวจสอบว่า R2 credentials ถูกต้อง
- ตรวจสอบว่า bucket name ถูกต้อง
- ตรวจสอบว่า API token มี permissions ที่เหมาะสม

### ปัญหา: "Could not upload file to R2 Storage"
- ตรวจสอบ R2_ENDPOINT format
- ตรวจสอบว่า bucket เปิดให้ public access
- ตรวจสอบ network connectivity

## Architecture

```
Frontend → Backend → NeonDB (ข้อมูล)
                  → Firebase (Authentication)
                  → Cloudflare R2 (รูปภาพ)
```

**ข้อดี:**
- NeonDB: PostgreSQL ฟรี 512MB
- Firebase: Authentication ที่เสถียร
- R2: Storage ฟรี 10GB + ไม่มีค่า bandwidth