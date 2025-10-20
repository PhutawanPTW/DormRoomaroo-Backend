# API Documentation: Member Request Management

## Overview
This document describes the APIs for managing member requests in the dormitory system, specifically for rejecting and canceling tenant approvals with response notes.

## Base URL
```
http://localhost:3000/api/dormitories
```

## Authentication
All endpoints require Firebase authentication token in the Authorization header:
```
Authorization: Bearer <firebase-token>
```

---

## 1. Reject Tenant Request

### Endpoint
```
PUT /:dormId/tenants/:userId/reject
```

### Description
Rejects a pending member request and optionally adds a response note explaining the rejection reason.

### Parameters
- **dormId** (path): ID of the dormitory
- **userId** (path): ID of the user whose request is being rejected

### Request Body
```json
{
  "response_note": "ไม่ใช่คนของหอค่ะ" // Optional: Reason for rejection
}
```

### Response
**Success (200):**
```json
{
  "message": "ปฏิเสธผู้เช่าสำเร็จ"
}
```

**Error (403):**
```json
{
  "message": "ไม่มีสิทธิ์เข้าถึงข้อมูลหอพักนี้"
}
```

**Error (404):**
```json
{
  "message": "ไม่พบคำขอที่รออนุมัติ"
}
```

### Example Usage
```javascript
// Frontend code example
const rejectTenant = async (dormId, userId, responseNote) => {
  try {
    const response = await fetch(`/api/dormitories/${dormId}/tenants/${userId}/reject`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${firebaseToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        response_note: responseNote
      })
    });

    if (response.ok) {
      const result = await response.json();
      console.log('Rejection successful:', result.message);
      return result;
    } else {
      const error = await response.json();
      throw new Error(error.message);
    }
  } catch (error) {
    console.error('Error rejecting tenant:', error);
    throw error;
  }
};

// Usage
rejectTenant(143, 122, 'ไม่ใช่คนของหอค่ะ');
```

---

## 2. Cancel Tenant Approval

### Endpoint
```
PUT /:dormId/tenants/:userId/cancel
```

### Description
Cancels an approved tenant's membership and optionally adds a response note explaining the cancellation reason.

### Parameters
- **dormId** (path): ID of the dormitory
- **userId** (path): ID of the user whose approval is being canceled

### Request Body
```json
{
  "response_note": "ยกเลิกการอนุมัติเนื่องจากเหตุผลส่วนตัว" // Optional: Reason for cancellation
}
```

### Response
**Success (200):**
```json
{
  "message": "ยกเลิกการยืนยันผู้เช่าสำเร็จ"
}
```

**Error (403):**
```json
{
  "message": "ไม่มีสิทธิ์เข้าถึงข้อมูลหอพักนี้"
}
```

### Example Usage
```javascript
// Frontend code example
const cancelTenantApproval = async (dormId, userId, responseNote) => {
  try {
    const response = await fetch(`/api/dormitories/${dormId}/tenants/${userId}/cancel`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${firebaseToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        response_note: responseNote
      })
    });

    if (response.ok) {
      const result = await response.json();
      console.log('Cancellation successful:', result.message);
      return result;
    } else {
      const error = await response.json();
      throw new Error(error.message);
    }
  } catch (error) {
    console.error('Error canceling tenant approval:', error);
    throw error;
  }
};

// Usage
cancelTenantApproval(143, 122, 'ยกเลิกการอนุมัติเนื่องจากเหตุผลส่วนตัว');
```

---

## Database Schema

### member_requests Table
The `response_note` field is updated in the `member_requests` table:

```sql
-- Table structure
CREATE TABLE member_requests (
  request_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  dorm_id INTEGER NOT NULL,
  request_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'รอพิจารณา',
  approved_date TIMESTAMP,
  response_note TEXT -- This field stores the rejection/cancellation reason
);
```

### Status Values
- `รออนุมัติ`: Pending approval
- `อนุมัติ`: Approved
- `ปฏิเสธ`: Rejected
- `ยกเลิก`: Canceled

---

## Error Handling

### Common Error Codes
- **400**: Bad Request - Missing required parameters
- **401**: Unauthorized - Invalid or missing Firebase token
- **403**: Forbidden - User doesn't have permission to access the dormitory
- **404**: Not Found - Dormitory, user, or request not found
- **500**: Internal Server Error - Server-side error

### Frontend Error Handling Example
```javascript
const handleApiError = (error) => {
  if (error.response) {
    // Server responded with error status
    const { status, data } = error.response;
    switch (status) {
      case 403:
        alert('คุณไม่มีสิทธิ์เข้าถึงข้อมูลหอพักนี้');
        break;
      case 404:
        alert('ไม่พบข้อมูลที่ต้องการ');
        break;
      default:
        alert(data.message || 'เกิดข้อผิดพลาด');
    }
  } else {
    // Network error
    alert('ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้');
  }
};
```

---

## Testing

Use the provided test script `test-member-request-apis.js` to test the APIs:

```bash
# Install axios if not already installed
npm install axios

# Run the test script
node test-member-request-apis.js
```

Make sure to update the test configuration with valid tokens and IDs before running.

---

## Notes

1. **Response Note Field**: The `response_note` field is optional. If not provided, it will be set to `null`.

2. **Transaction Safety**: Both APIs use database transactions to ensure data consistency.

3. **User Status Management**: When rejecting/canceling, the system automatically handles user residence status and stay history.

4. **Permission Check**: Only dormitory owners can reject or cancel tenant requests for their own dormitories.

5. **Status Updates**: The APIs automatically update the `member_requests` table with the new status and response note.
