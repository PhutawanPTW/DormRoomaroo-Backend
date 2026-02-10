// src/script/seedReviews.js
// Script สำหรับเพิ่มข้อมูลรีวิวตัวอย่างลงฐานข้อมูล

const pool = require('../db');

// รีวิวตัวอย่างภาษาไทย (หลากหลายรูปแบบ)
const SAMPLE_REVIEWS = {
  excellent: [
    { rating: 5, comment: "หอพักสะอาดมาก ห้องกว้าง เจ้าของใจดี แนะนำเลยครับ!" },
    { rating: 5, comment: "อยู่มา 2 ปีแล้ว ประทับใจมากๆ ปลอดภัย ใกล้มหาลัย สะดวกสบายสุดๆ" },
    { rating: 5, comment: "ราคาคุ้มค่ามาก WiFi แรง แอร์เย็น ไม่มีปัญหาอะไรเลย" },
    { rating: 5, comment: "เจ้าของหอดูแลดีมาก มีปัญหาอะไรแก้ให้เร็วทันใจ รักหอนี้มาก" },
    { rating: 5, comment: "ห้องน้ำสะอาด มีน้ำอุ่น ใกล้ร้านสะดวกซื้อ ชอบมากครับ" },
  ],
  good: [
    { rating: 4, comment: "หอพักโอเคครับ สะอาด เงียบสงบ แต่ที่จอดรถอาจจะน้อยไปหน่อย" },
    { rating: 4, comment: "ห้องสะอาด ราคาถูก ทำเลดี แต่ WiFi บางทีช้าหน่อย" },
    { rating: 4, comment: "เจ้าของใจดี ห้องกว้าง แต่ตอนเย็นรถติดนิดหน่อย" },
    { rating: 4, comment: "ประทับใจครับ ห้องใหม่ สิ่งอำนวยความสะดวกครบ แต่อยากให้มีลิฟต์" },
    { rating: 4, comment: "อยู่สบาย เงียบสงบ ปลอดภัยดี แต่ค่าน้ำค่าไฟแพงไปหน่อย" },
  ],
  average: [
    { rating: 3, comment: "หอพักพอใช้ได้ครับ ไม่ได้ดีมากแต่ก็ไม่แย่ ราคาก็โอเค" },
    { rating: 3, comment: "สะอาดพอใช้ได้ แต่ห้องค่อนข้างเล็ก เหมาะกับคนอยู่คนเดียว" },
    { rating: 3, comment: "ทำเลดี ใกล้มหาลัย แต่หอค่อนข้างเก่า ต้องปรับปรุงบ้าง" },
    { rating: 3, comment: "เจ้าของโอเค แต่บางทีซ่อมบำรุงช้า อยู่ได้แต่ไม่ได้ประทับใจมาก" },
    { rating: 3, comment: "ราคาถูก แต่ห้องเล็ก WiFi ไม่ค่อยแรง พอใช้ได้ถ้าไม่เรื่องมาก" },
  ],
  poor: [
    { rating: 2, comment: "หอเก่ามาก ห้องน้ำมีปัญหาบ่อย เจ้าของซ่อมช้า" },
    { rating: 2, comment: "เสียงดังมากจากห้องข้างๆ นอนไม่ค่อยหลับ ไม่แนะนำ" },
    { rating: 2, comment: "ราคาถูกก็จริง แต่ความสะอาดไม่ค่อยโอเค ต้องปรับปรุง" },
    { rating: 2, comment: "แมลงสาบเยอะ ห้องไม่สะอาด ติดต่อเจ้าของยาก" },
  ],
  veryPoor: [
    { rating: 1, comment: "แย่มาก ไม่แนะนำเลย ห้องสกปรก เจ้าของไม่ดูแล" },
    { rating: 1, comment: "หอเก่ามาก น้ำรั่ว ไฟดับบ่อย ไม่คุ้มราคาเลย" },
  ]
};

// ฟังก์ชันสุ่มเลือกรีวิว
function getRandomReviews(count) {
  const allReviews = [
    ...SAMPLE_REVIEWS.excellent,
    ...SAMPLE_REVIEWS.excellent,  // เพิ่มน้ำหนักให้รีวิวดี
    ...SAMPLE_REVIEWS.good,
    ...SAMPLE_REVIEWS.good,
    ...SAMPLE_REVIEWS.good,       // รีวิว 4 ดาวควรเยอะสุด
    ...SAMPLE_REVIEWS.average,
    ...SAMPLE_REVIEWS.average,
    ...SAMPLE_REVIEWS.poor,
    ...SAMPLE_REVIEWS.veryPoor,
  ];

  const shuffled = allReviews.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

// ฟังก์ชันสุ่มวันที่ย้อนหลัง (1-365 วัน)
function getRandomPastDate(maxDaysAgo = 365) {
  const now = new Date();
  const daysAgo = Math.floor(Math.random() * maxDaysAgo) + 1;
  const pastDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return pastDate.toISOString();
}

async function seedReviews() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 เริ่มต้น Seed ข้อมูลรีวิว...\n');

    // 1. ดึงรายการหอพักที่อนุมัติแล้ว
    const dormsResult = await client.query(`
      SELECT dorm_id, dorm_name 
      FROM dormitories 
      WHERE approval_status = 'อนุมัติ'
      ORDER BY dorm_id
    `);

    if (dormsResult.rows.length === 0) {
      console.log('❌ ไม่พบหอพักที่อนุมัติแล้วในระบบ');
      return;
    }

    console.log(`📋 พบหอพัก ${dormsResult.rows.length} แห่งที่อนุมัติแล้ว`);

    // 2. ดึงรายการผู้ใช้ที่เป็น member
    const usersResult = await client.query(`
      SELECT id, display_name 
      FROM users 
      WHERE member_type = 'member'
      ORDER BY id
    `);

    if (usersResult.rows.length === 0) {
      console.log('❌ ไม่พบผู้ใช้ประเภท member ในระบบ');
      console.log('💡 กำลังสร้างผู้ใช้จำลองสำหรับรีวิว...');
      
      // สร้างผู้ใช้จำลองสำหรับรีวิว
      const fakeUsers = [
        { name: 'สมชาย ใจดี', username: 'somchai_review1' },
        { name: 'สมหญิง รักสะอาด', username: 'somying_review2' },
        { name: 'วิชัย มั่นคง', username: 'wichai_review3' },
        { name: 'อรุณ ประทับใจ', username: 'arun_review4' },
        { name: 'นภา สุขใจ', username: 'napa_review5' },
        { name: 'กิตติ ยิ้มแย้ม', username: 'kitti_review6' },
        { name: 'พิมพ์ชนก สดใส', username: 'pimchanok_review7' },
        { name: 'ธนกร รักเรียน', username: 'thanakorn_review8' },
        { name: 'ปิยะ หอพักดี', username: 'piya_review9' },
        { name: 'ศิริ มีสุข', username: 'siri_review10' },
      ];

      for (const fakeUser of fakeUsers) {
        await client.query(`
          INSERT INTO users (firebase_uid, username, email, display_name, member_type, created_at, updated_at)
          VALUES ($1, $2, $3, $4, 'member', NOW(), NOW())
          ON CONFLICT (firebase_uid) DO NOTHING
        `, [
          `fake_review_user_${fakeUser.username}`,
          fakeUser.username,
          `${fakeUser.username}@example.com`,
          fakeUser.name
        ]);
      }

      // ดึงผู้ใช้อีกครั้ง
      const newUsersResult = await client.query(`
        SELECT id, display_name 
        FROM users 
        WHERE member_type = 'member'
        ORDER BY id
      `);
      usersResult.rows = newUsersResult.rows;
    }

    console.log(`👥 พบผู้ใช้ member ${usersResult.rows.length} คน`);

    // 3. Insert รีวิวสำหรับแต่ละหอพัก
    let totalReviewsAdded = 0;

    for (const dorm of dormsResult.rows) {
      // สุ่มจำนวนรีวิวต่อหอพัก (3-10 รีวิว)
      const reviewCount = Math.floor(Math.random() * 8) + 3;
      const reviews = getRandomReviews(reviewCount);
      
      // สุ่มเลือกผู้ใช้ที่จะรีวิว
      const shuffledUsers = usersResult.rows.sort(() => 0.5 - Math.random());
      const selectedUsers = shuffledUsers.slice(0, Math.min(reviewCount, shuffledUsers.length));

      console.log(`\n🏠 หอพัก: ${dorm.dorm_name} (ID: ${dorm.dorm_id})`);
      
      let dormReviewsAdded = 0;

      for (let i = 0; i < selectedUsers.length && i < reviews.length; i++) {
        const user = selectedUsers[i];
        const review = reviews[i];
        const reviewDate = getRandomPastDate(365);

        // ตรวจสอบว่าผู้ใช้นี้เคยรีวิวหอนี้หรือยัง
        const existingReview = await client.query(
          'SELECT review_id FROM reviews WHERE user_id = $1 AND dorm_id = $2',
          [user.id, dorm.dorm_id]
        );

        if (existingReview.rows.length === 0) {
          // เพิ่ม stay_history เพื่อให้ผู้ใช้มีสิทธิ์รีวิว
          await client.query(`
            INSERT INTO stay_history (user_id, dorm_id, start_date, end_date, is_current, status)
            VALUES ($1, $2, $3, $4, false, 'ย้ายออก')
            ON CONFLICT DO NOTHING
          `, [
            user.id, 
            dorm.dorm_id,
            new Date(new Date(reviewDate).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            reviewDate
          ]);

          // Insert รีวิว
          await client.query(`
            INSERT INTO reviews (user_id, dorm_id, rating, comment, review_date)
            VALUES ($1, $2, $3, $4, $5)
          `, [user.id, dorm.dorm_id, review.rating, review.comment, reviewDate]);

          console.log(`   ⭐ ${review.rating} ดาว - "${review.comment.substring(0, 30)}..." โดย ${user.display_name}`);
          dormReviewsAdded++;
          totalReviewsAdded++;
        }
      }

      console.log(`   ✅ เพิ่มรีวิว ${dormReviewsAdded} รายการ`);
    }

    console.log(`\n🎉 Seed ข้อมูลรีวิวสำเร็จ!`);
    console.log(`📊 สรุป: เพิ่มรีวิวทั้งหมด ${totalReviewsAdded} รายการ`);

  } catch (error) {
    console.error('❌ เกิดข้อผิดพลาด:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// รัน script
seedReviews();
