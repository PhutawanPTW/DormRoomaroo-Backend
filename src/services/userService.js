const pool = require('../db');

async function generateUsernameFromEmail(email) {
    let baseUsername = email.split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    baseUsername = baseUsername.substring(0, 15);

    let username = baseUsername + Math.floor(Math.random() * 1000);

    let counter = 0;
    while (counter < 10) {
        const result = await pool.query(
            'SELECT COUNT(*) FROM users WHERE username = $1',
            [username]
        );

        if (result.rows[0].count == 0) {
            return username;
        }

        username = baseUsername + Math.floor(Math.random() * 1000);
        counter++;
    }
    return baseUsername + Date.now().toString().slice(-3);
}

// ปรับปรุง findOrCreateUser เพื่อสร้างผู้ใช้ใหม่พร้อม memberType หากไม่พบ
async function findOrCreateUser({ firebase_uid, email, displayName, photoURL, memberType }) {
    const result = await pool.query(
        'SELECT * FROM users WHERE firebase_uid = $1',
        [firebase_uid]
    );

    if (result.rows.length > 0) {
        // ผู้ใช้มีอยู่แล้ว: อัปเดตข้อมูล Firebase Auth ที่อาจมีการเปลี่ยนแปลง
        const existingUser = result.rows[0];
        const updates = {};
        if (existingUser.email !== email) updates.email = email;
        if (existingUser.display_name !== displayName) updates.display_name = displayName;
        if (existingUser.photo_url !== photoURL) updates.photo_url = photoURL;
        // หากผู้ใช้ยังไม่มี member_type ใน DB แต่มีการส่ง memberType มาให้
        if (memberType && (!existingUser.member_type || existingUser.member_type !== memberType)) {
            updates.member_type = memberType;
        }

        if (Object.keys(updates).length > 0) {
            const updatedResult = await pool.query(
                `UPDATE users SET ${Object.keys(updates).map((k, i) => `${k.replace(/([A-Z])/g, "_$1").toLowerCase()} = $${i + 1}`).join(', ')}, updated_at = NOW() WHERE firebase_uid = $${Object.keys(updates).length + 1} RETURNING *`,
                [...Object.values(updates), firebase_uid]
            );
            return updatedResult.rows[0];
        }
        return existingUser;
    } else {
        // ผู้ใช้ใหม่: สร้าง username และ INSERT ข้อมูลพร้อม memberType ที่ระบุ
        const username = await generateUsernameFromEmail(email);

        const newUserResult = await pool.query(
            `INSERT INTO users (
                firebase_uid, username, email, display_name, photo_url, member_type, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW()) RETURNING *`,
            [firebase_uid, username, email, displayName, photoURL, memberType]
        );
        return newUserResult.rows[0];
    }
}

// ปรับปรุง registerUserWithEmail เพื่อให้สามารถอัปเดตได้หากผู้ใช้มีอยู่แล้ว (กรณีมาจาก Google และกรอกข้อมูลเพิ่มเติม)
async function upsertUserWithEmail({
    firebase_uid,
    email,
    displayName,
    photoUrl,
    memberType,
    phoneNumber,
    residenceDormId
}) {
    const existingUser = await getUserByFirebaseUid(firebase_uid);

    if (existingUser) {
        // ถ้าผู้ใช้มีอยู่แล้ว ให้ทำการอัปเดตข้อมูล
        const updates = {
            email: email || existingUser.email, // ใช้ค่าใหม่ถ้ามี มิฉะนั้นใช้ค่าเดิม
            displayName: displayName || existingUser.display_name,
            photoUrl: photoUrl || existingUser.photo_url,
            memberType: memberType || existingUser.member_type,
            phoneNumber: phoneNumber || existingUser.phone_number,
            residenceDormId: residenceDormId !== undefined ? residenceDormId : existingUser.residence_dorm_id
        };
        return await updateProfile(firebase_uid, updates);
    } else {
        // ถ้าผู้ใช้ยังไม่มี ให้สร้างใหม่
        const username = await generateUsernameFromEmail(email);
        const query = `
            INSERT INTO users (
                firebase_uid, username, email, display_name, photo_url, member_type,
                phone_number, residence_dorm_id,
                created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
            RETURNING *`;

        const values = [
            firebase_uid,
            username,
            email,
            displayName,
            photoUrl,
            memberType,
            phoneNumber,
            (typeof residenceDormId === 'number' || residenceDormId === null) ? residenceDormId : null
        ];

        try {
            const newUserResult = await pool.query(query, values);
            return newUserResult.rows[0];
        } catch (error) {
            console.error('Error inserting user into database:', error);
            throw error;
        }
    }
}

async function getUserByFirebaseUid(firebase_uid) {
    const result = await pool.query(
        'SELECT * FROM users WHERE firebase_uid = $1',
        [firebase_uid]
    );
    return result.rows[0] || null;
}

async function updateProfile(firebase_uid, updates) {
    const fields = [];
    const values = [];
    let queryIndex = 1;

    for (const key in updates) {
        let dbColumnName;
        // Convert camelCase to snake_case for DB columns
        if (key === 'photoUrl') { // handle photoUrl explicitly
            dbColumnName = 'photo_url';
        } else if (key === 'residenceDormId') {
            dbColumnName = 'residence_dorm_id';
        } else if (key === 'memberType') {
            dbColumnName = 'member_type';
        } else if (key === 'phoneNumber') {
            dbColumnName = 'phone_number';
        } else if (key === 'displayName') {
            dbColumnName = 'display_name';
        } else {
            dbColumnName = key.replace(/([A-Z])/g, "_$1").toLowerCase();
        }

        if (updates[key] !== undefined) {
            fields.push(`${dbColumnName} = $${queryIndex++}`);
            values.push(updates[key]);
        }
    }

    if (fields.length === 0) {
        const result = await pool.query(
            'SELECT * FROM users WHERE firebase_uid = $1',
            [firebase_uid]
        );
        return result.rows[0] || null;
    }

    values.push(firebase_uid);
    const query = `UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE firebase_uid = $${queryIndex} RETURNING *`;
    const result = await pool.query(query, values);
    return result.rows[0] || null;
}

module.exports = {
    findOrCreateUser,
    upsertUserWithEmail,
    getUserByFirebaseUid,
    updateProfile,
    generateUsernameFromEmail
};