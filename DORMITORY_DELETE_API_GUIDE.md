# API Guide: Dormitory Deletion System

## Overview
ระบบลบหอพักที่ได้รับการปรับปรุงให้มีการตรวจสอบสมาชิกก่อนลบและแสดงป๊อปอัพยืนยันที่แตกต่างกันตามจำนวนสมาชิก

## API Endpoints

### 1. ตรวจสอบสมาชิกของหอพักก่อนลบ (สำหรับ Owner)

**Endpoint:** `GET /api/delete-dormitory/:dormId/check-members`

**Headers:**
```
Authorization: Bearer <firebase_token>
```

**Response:**
```json
{
  "dorm_id": 123,
  "dorm_name": "หอโรสริน",
  "member_count": 5,
  "members": [
    {
      "id": 1,
      "username": "user1",
      "display_name": "ผู้ใช้ 1",
      "email": "user1@example.com"
    }
  ],
  "has_members": true,
  "confirmation_message": "ยืนยันการลบหอพัก\nคุณต้องการลบหอพัก \"หอโรสริน\" และ สมาชิกของหอ ใช่หรือไม่ ?"
}
```

### 2. ลบหอพัก (สำหรับ Owner)

**Endpoint:** `DELETE /api/delete-dormitory/:dormId`

**Headers:**
```
Authorization: Bearer <firebase_token>
```

**Query Parameters:**
- `confirm` (optional): `true` หรือ `false` - ยืนยันการลบเมื่อมีสมาชิก

**Response (เมื่อมีสมาชิกและไม่ยืนยัน):**
```json
{
  "message": "ยังมีสมาชิกอาศัยอยู่ในหอพักนี้ ต้องยืนยันก่อนลบ",
  "member_count": 5,
  "dorm_name": "หอโรสริน",
  "require_confirmation": true,
  "confirmation_message": "ยืนยันการลบหอพัก\nคุณต้องการลบหอพัก \"หอโรสริน\" และ สมาชิกของหอ ใช่หรือไม่ ?"
}
```

**Response (เมื่อลบสำเร็จ):**
```json
{
  "message": "ลบหอพัก \"หอโรสริน\" และสมาชิก 5 คนเรียบร้อยแล้ว",
  "dorm_name": "หอโรสริน",
  "member_count": 5
}
```

### 3. ตรวจสอบสมาชิกของหอพักก่อนลบ (สำหรับ Admin)

**Endpoint:** `GET /api/admin-dormitory/:dormId/check-members`

**Headers:**
```
Authorization: Bearer <firebase_token>
```

**Response:** เหมือนกับ endpoint ของ Owner

### 4. ลบหอพัก (สำหรับ Admin)

**Endpoint:** `DELETE /api/admin-dormitory/:dormId`

**Headers:**
```
Authorization: Bearer <firebase_token>
```

**Query Parameters:**
- `confirm` (optional): `true` หรือ `false` - ยืนยันการลบเมื่อมีสมาชิก

**Response:** เหมือนกับ endpoint ของ Owner

## การทำงานของระบบ

### กรณีที่หอพักมีสมาชิกอาศัยอยู่:

1. **ขั้นตอนที่ 1:** เรียก API `GET /check-members` เพื่อตรวจสอบสมาชิก
2. **ขั้นตอนที่ 2:** แสดงป๊อปอัพยืนยัน:
   ```
   ยืนยันการลบหอพัก
   คุณต้องการลบหอพัก "หอโรสริน" และ สมาชิกของหอ ใช่หรือไม่ ?
   ```
3. **ขั้นตอนที่ 3:** หากผู้ใช้ยืนยัน เรียก API `DELETE` พร้อม `confirm=true`
4. **ขั้นตอนที่ 4:** ระบบจะ:
   - บันทึกประวัติการย้ายออกของสมาชิก
   - ปิด stay_history ปัจจุบัน
   - ถอดสมาชิกออกจากหอพัก
   - ลบข้อมูลหอพักและข้อมูลที่เกี่ยวข้อง

### กรณีที่หอพักไม่มีสมาชิก:

1. **ขั้นตอนที่ 1:** เรียก API `GET /check-members` เพื่อตรวจสอบสมาชิก
2. **ขั้นตอนที่ 2:** แสดงป๊อปอัพยืนยัน:
   ```
   ยืนยันการลบหอพัก
   คุณต้องการลบหอพัก "หอโรสริน" ใช่หรือไม่ ?
   ```
3. **ขั้นตอนที่ 3:** หากผู้ใช้ยืนยัน เรียก API `DELETE`
4. **ขั้นตอนที่ 4:** ระบบจะลบข้อมูลหอพักและข้อมูลที่เกี่ยวข้องทันที

## Status Codes

- `200`: สำเร็จ
- `404`: ไม่พบข้อมูลหอพักหรือผู้ใช้
- `403`: ไม่มีสิทธิ์เข้าถึง
- `409`: มีสมาชิกอาศัยอยู่ ต้องยืนยันก่อนลบ
- `500`: เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์

## ตัวอย่างการใช้งาน Frontend

```javascript
// ตรวจสอบสมาชิกก่อนลบ
async function checkMembersBeforeDelete(dormId) {
  try {
    const response = await fetch(`/api/delete-dormitory/${dormId}/check-members`, {
      headers: {
        'Authorization': `Bearer ${firebaseToken}`
      }
    });
    
    const data = await response.json();
    
    if (data.has_members) {
      // แสดงป๊อปอัพยืนยันสำหรับหอพักที่มีสมาชิก
      const confirmed = confirm(data.confirmation_message);
      if (confirmed) {
        await deleteDormitory(dormId, true);
      }
    } else {
      // แสดงป๊อปอัพยืนยันสำหรับหอพักที่ไม่มีสมาชิก
      const confirmed = confirm(data.confirmation_message);
      if (confirmed) {
        await deleteDormitory(dormId, false);
      }
    }
  } catch (error) {
    console.error('Error checking members:', error);
  }
}

// ลบหอพัก
async function deleteDormitory(dormId, confirm = false) {
  try {
    const url = `/api/delete-dormitory/${dormId}${confirm ? '?confirm=true' : ''}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${firebaseToken}`
      }
    });
    
    const data = await response.json();
    
    if (response.status === 409) {
      // มีสมาชิกอาศัยอยู่ ต้องยืนยันอีกครั้ง
      const confirmed = confirm(data.confirmation_message);
      if (confirmed) {
        await deleteDormitory(dormId, true);
      }
    } else if (response.ok) {
      alert(data.message);
      // รีเฟรชหน้าหรือนำทางไปหน้าอื่น
    } else {
      alert(data.message);
    }
  } catch (error) {
    console.error('Error deleting dormitory:', error);
  }
}
```

## หมายเหตุ

- ระบบจะตรวจสอบสิทธิ์การเข้าถึงก่อนดำเนินการใดๆ
- เมื่อลบหอพักที่มีสมาชิก ระบบจะบันทึกประวัติการย้ายออกของสมาชิกทั้งหมด
- การลบหอพักจะลบข้อมูลที่เกี่ยวข้องทั้งหมด (room_types, amenities, images, etc.)
- ระบบใช้ Transaction เพื่อให้แน่ใจว่าการลบข้อมูลสำเร็จทั้งหมดหรือไม่สำเร็จเลย
