// src/controllers/reviewController.js
const pool = require("../db");

// ดึงรีวิวทั้งหมดของหอพัก
exports.getDormitoryReviews = async (req, res) => {
  try {
    const { dormId } = req.params;

    // ตรวจสอบว่าหอพักมีอยู่หรือไม่
    const dormCheck = await pool.query(
      "SELECT dorm_id, dorm_name FROM dormitories WHERE dorm_id = $1",
      [dormId]
    );

    if (dormCheck.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
    }

    // ดึงรีวิวทั้งหมดของหอพัก
    const reviewsQuery = `
      SELECT 
        r.review_id,
        r.rating,
        r.comment,
        r.created_at,
        u.id as user_id,
        u.display_name,
        u.photo_url,
        u.username
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      WHERE r.dorm_id = $1
      ORDER BY r.created_at DESC
    `;

    const reviewsResult = await pool.query(reviewsQuery, [dormId]);

    // คำนวณคะแนนเฉลี่ย
    const avgRatingQuery = `
      SELECT 
        AVG(rating) as average_rating,
        COUNT(*) as total_reviews
      FROM reviews 
      WHERE dorm_id = $1
    `;

    const avgRatingResult = await pool.query(avgRatingQuery, [dormId]);
    const avgRating = avgRatingResult.rows[0];

    res.json({
      dorm_id: parseInt(dormId),
      dorm_name: dormCheck.rows[0].dorm_name,
      average_rating: parseFloat(avgRating.average_rating) || 0,
      total_reviews: parseInt(avgRating.total_reviews) || 0,
      reviews: reviewsResult.rows
    });

  } catch (error) {
    console.error("Error fetching dormitory reviews:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};

// สร้างรีวิวใหม่
exports.createReview = async (req, res) => {
  const client = await pool.connect();
  try {
    const { dormId } = req.params;
    const { uid } = req.user;
    const { rating, comment } = req.body;

    // ตรวจสอบข้อมูลที่จำเป็น
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "กรุณาระบุคะแนนระหว่าง 1-5" });
    }

    if (!comment || comment.trim().length === 0) {
      return res.status(400).json({ message: "กรุณาระบุความคิดเห็น" });
    }

    await client.query('BEGIN');

    // ตรวจสอบข้อมูลผู้ใช้
    const userResult = await client.query(
      "SELECT id, member_type, residence_dorm_id FROM users WHERE firebase_uid = $1",
      [uid]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const user = userResult.rows[0];

    // ตรวจสอบว่าหอพักมีอยู่หรือไม่
    const dormResult = await client.query(
      "SELECT dorm_id, dorm_name FROM dormitories WHERE dorm_id = $1",
      [dormId]
    );

    if (dormResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "ไม่พบข้อมูลหอพัก" });
    }

    // ตรวจสอบว่าผู้ใช้เป็นสมาชิกของหอพักนี้หรือไม่
    if (user.member_type !== 'member' || user.residence_dorm_id !== parseInt(dormId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ 
        message: "เฉพาะสมาชิกของหอพักเท่านั้นที่สามารถรีวิวได้" 
      });
    }

    // ตรวจสอบว่าผู้ใช้เคยรีวิวหอพักนี้แล้วหรือไม่
    const existingReview = await client.query(
      "SELECT review_id FROM reviews WHERE user_id = $1 AND dorm_id = $2",
      [user.id, dormId]
    );

    if (existingReview.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: "คุณเคยรีวิวหอพักนี้แล้ว" });
    }

    // สร้างรีวิวใหม่
    const createReviewQuery = `
      INSERT INTO reviews (user_id, dorm_id, rating, comment, created_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      RETURNING review_id
    `;

    const reviewResult = await client.query(createReviewQuery, [
      user.id,
      dormId,
      rating,
      comment.trim()
    ]);

    await client.query('COMMIT');

    res.status(201).json({
      message: "สร้างรีวิวสำเร็จ",
      review_id: reviewResult.rows[0].review_id
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error creating review:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  } finally {
    client.release();
  }
};

// อัพเดตรีวิว
exports.updateReview = async (req, res) => {
  const client = await pool.connect();
  try {
    const { reviewId } = req.params;
    const { uid } = req.user;
    const { rating, comment } = req.body;

    // ตรวจสอบข้อมูลที่จำเป็น
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "กรุณาระบุคะแนนระหว่าง 1-5" });
    }

    if (!comment || comment.trim().length === 0) {
      return res.status(400).json({ message: "กรุณาระบุความคิดเห็น" });
    }

    await client.query('BEGIN');

    // ตรวจสอบข้อมูลผู้ใช้
    const userResult = await client.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [uid]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const userId = userResult.rows[0].id;

    // ตรวจสอบว่ารีวิวมีอยู่และเป็นของผู้ใช้นี้หรือไม่
    const reviewResult = await client.query(
      "SELECT review_id, user_id FROM reviews WHERE review_id = $1",
      [reviewId]
    );

    if (reviewResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "ไม่พบรีวิว" });
    }

    if (reviewResult.rows[0].user_id !== userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: "ไม่มีสิทธิ์แก้ไขรีวิวนี้" });
    }

    // อัพเดตรีวิว
    await client.query(
      "UPDATE reviews SET rating = $1, comment = $2, updated_at = CURRENT_TIMESTAMP WHERE review_id = $3",
      [rating, comment.trim(), reviewId]
    );

    await client.query('COMMIT');

    res.json({ message: "อัพเดตรีวิวสำเร็จ" });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error updating review:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  } finally {
    client.release();
  }
};

// ลบรีวิว
exports.deleteReview = async (req, res) => {
  const client = await pool.connect();
  try {
    const { reviewId } = req.params;
    const { uid } = req.user;

    await client.query('BEGIN');

    // ตรวจสอบข้อมูลผู้ใช้
    const userResult = await client.query(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [uid]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const userId = userResult.rows[0].id;

    // ตรวจสอบว่ารีวิวมีอยู่และเป็นของผู้ใช้นี้หรือไม่
    const reviewResult = await client.query(
      "SELECT review_id, user_id FROM reviews WHERE review_id = $1",
      [reviewId]
    );

    if (reviewResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: "ไม่พบรีวิว" });
    }

    if (reviewResult.rows[0].user_id !== userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: "ไม่มีสิทธิ์ลบรีวิวนี้" });
    }

    // ลบรีวิว
    await client.query("DELETE FROM reviews WHERE review_id = $1", [reviewId]);

    await client.query('COMMIT');

    res.json({ message: "ลบรีวิวสำเร็จ" });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error deleting review:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  } finally {
    client.release();
  }
};

// ตรวจสอบว่าผู้ใช้สามารถรีวิวได้หรือไม่
exports.checkReviewEligibility = async (req, res) => {
  try {
    const { dormId } = req.params;
    const { uid } = req.user;

    // ตรวจสอบข้อมูลผู้ใช้
    const userResult = await pool.query(
      "SELECT id, member_type, residence_dorm_id FROM users WHERE firebase_uid = $1",
      [uid]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลผู้ใช้" });
    }

    const user = userResult.rows[0];

    // ตรวจสอบว่าผู้ใช้เป็นสมาชิกของหอพักนี้หรือไม่
    const isEligible = user.member_type === 'member' && user.residence_dorm_id === parseInt(dormId);

    // ตรวจสอบว่าผู้ใช้เคยรีวิวแล้วหรือไม่
    let hasReviewed = false;
    if (isEligible) {
      const reviewResult = await pool.query(
        "SELECT review_id FROM reviews WHERE user_id = $1 AND dorm_id = $2",
        [user.id, dormId]
      );
      hasReviewed = reviewResult.rows.length > 0;
    }

    res.json({
      can_review: isEligible && !hasReviewed,
      has_reviewed: hasReviewed,
      reason: !isEligible ? "เฉพาะสมาชิกของหอพักเท่านั้นที่สามารถรีวิวได้" : 
              hasReviewed ? "คุณเคยรีวิวหอพักนี้แล้ว" : null
    });

  } catch (error) {
    console.error("Error checking review eligibility:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};
