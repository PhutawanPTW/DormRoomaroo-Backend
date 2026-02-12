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
FIREBASE_STORAGE_BUCKET=projectviewmash-bac0a.appspot.com
ML_API_URL=http://localhost:8000
```

### Firebase Service Account Keys

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
FIREBASE_STORAGE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
```

#### วิธีที่ 2: ใช้ไฟล์ (สำหรับ local development เท่านั้น)

1. วางไฟล์ `firebase-admin-key.json` และ `storage-admin-key.json` ใน root directory
2. ไฟล์เหล่านี้จะถูก ignore โดย git

## การ Deploy

1. Push code ไป repository
2. Render.com จะ deploy อัตโนมัติ
3. ตรวจสอบ logs ว่า Firebase service account โหลดสำเร็จ

## การทดสอบ

รันคำสั่งนี้เพื่อทดสอบการตั้งค่า Firebase:

```bash
node test-firebase-config.js
```

## Troubleshooting

### ปัญหา: "Invalid ID token"
- ตรวจสอบว่า service account key ถูกต้อง
- ตรวจสอบว่า FIREBASE_PROJECT_ID ตรงกับโปรเจคใน Firebase Console
- Restart service หลังจากเปลี่ยน environment variables

### ปัญหา: "Error loading Firebase service account key"
- ตรวจสอบว่าตั้งค่า environment variables ถูกต้อง
- ตรวจสอบ JSON format ใน environment variable
- ตรวจสอบว่าไฟล์ key อยู่ในตำแหน่งที่ถูกต้อง (สำหรับ local development)