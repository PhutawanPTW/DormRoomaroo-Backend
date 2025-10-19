// src/controllers/reviewController.js
const pool = require("../db");
const { predictReviewRating } = require("../services/mlService");

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
        r.review_date,
        u.id as user_id,
        u.display_name,
        u.photo_url,
        u.username,
        u.residence_dorm_id,
        CASE 
          WHEN u.residence_dorm_id = $1 THEN true
          ELSE false
        END as is_resident
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      WHERE r.dorm_id = $1
      ORDER BY r.review_date DESC
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
    const { comment } = req.body;

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

    // ตรวจสอบกรณีที่ 1: เคยพักอาศัย (ไม่ว่าจะย้ายไปไหนแล้วก็ตาม)
    const pastStayCheck = await client.query(`
      SELECT COUNT(*) AS stay_count
      FROM stay_history
      WHERE user_id = $1 AND dorm_id = $2
        AND is_current = false
    `, [user.id, dormId]);

    // ตรวจสอบกรณีที่ 2: กำลังพักอาศัย (ได้รับการอนุมัติแล้ว)
    const currentStayCheck = await client.query(`
      SELECT COUNT(*) AS approval_count
      FROM member_requests
      WHERE user_id = $1 AND dorm_id = $2 AND status = 'อนุมัติ'
    `, [user.id, dormId]);

    const isEligible = parseInt(pastStayCheck.rows[0].stay_count) > 0 || 
                       parseInt(currentStayCheck.rows[0].approval_count) > 0;

    if (!isEligible) {
      await client.query('ROLLBACK');
      return res.status(403).json({ 
        message: "รีวิวได้เฉพาะผู้ที่เคยพักอาศัยหรือกำลังพักอาศัยในหอนี้ (ต้องได้รับการอนุมัติจากเจ้าของหอ)" 
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

    // เรียก ML เพื่อทำนายคะแนนจากข้อความรีวิว
    let predictedRating = null;
    let predictedConfidence = null;
    try {
      const ml = await predictReviewRating(comment.trim());
      predictedRating = ml?.predicted_rating;
      predictedConfidence = ml?.confidence ?? null;
    } catch (e) {
      // หาก ML ล้มเหลว ไม่บล็อกการสร้างรีวิว แต่ต้องมีคะแนนที่ถูกต้องจาก ML
      await client.query('ROLLBACK');
      return res.status(502).json({ message: "ML service unavailable", details: e.message });
    }

    if (!predictedRating || predictedRating < 1 || predictedRating > 5) {
      await client.query('ROLLBACK');
      return res.status(500).json({ message: "Invalid predicted rating from ML" });
    }

    // สร้างรีวิวใหม่
    const createReviewQuery = `
      INSERT INTO reviews (user_id, dorm_id, rating, comment, review_date)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      RETURNING review_id
    `;

    const reviewResult = await client.query(createReviewQuery, [
      user.id,
      dormId,
      predictedRating,
      comment.trim()
    ]);

    await client.query('COMMIT');

    res.status(201).json({
      message: "สร้างรีวิวสำเร็จ",
      review_id: reviewResult.rows[0].review_id,
      predicted_rating: predictedRating,
      confidence: predictedConfidence
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
    const { comment } = req.body;

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
      "SELECT review_id, user_id, review_date FROM reviews WHERE review_id = $1",
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

    // ตรวจสอบว่ารีวิวยังอยู่ในช่วง 7 วันหรือไม่
    const reviewDate = new Date(reviewResult.rows[0].review_date);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    if (reviewDate < sevenDaysAgo) {
      await client.query('ROLLBACK');
      return res.status(403).json({ 
        message: "ไม่สามารถแก้ไขรีวิวได้ เนื่องจากเกิน 7 วันแล้ว" 
      });
    }

    // เรียก ML เพื่อทำนายคะแนนใหม่จากข้อความที่แก้ไข
    let predictedRating = null;
    let predictedConfidence = null;
    try {
      const ml = await predictReviewRating(comment.trim());
      predictedRating = ml?.predicted_rating;
      predictedConfidence = ml?.confidence ?? null;
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(502).json({ message: "ML service unavailable", details: e.message });
    }

    if (!predictedRating || predictedRating < 1 || predictedRating > 5) {
      await client.query('ROLLBACK');
      return res.status(500).json({ message: "Invalid predicted rating from ML" });
    }

    // อัพเดตรีวิว
    await client.query(
      "UPDATE reviews SET rating = $1, comment = $2 WHERE review_id = $3",
      [predictedRating, comment.trim(), reviewId]
    );

    await client.query('COMMIT');

    res.json({ message: "อัพเดตรีวิวสำเร็จ", predicted_rating: predictedRating, confidence: predictedConfidence });

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

    // ตรวจสอบกรณีที่ 1: เคยพักอาศัย (ไม่ว่าจะย้ายไปไหนแล้วก็ตาม)
    const pastStayCheck = await pool.query(`
      SELECT COUNT(*) AS stay_count
      FROM stay_history
      WHERE user_id = $1 AND dorm_id = $2
        AND is_current = false
    `, [user.id, dormId]);

    // ตรวจสอบกรณีที่ 2: กำลังพักอาศัย (ได้รับการอนุมัติแล้ว)
    const currentStayCheck = await pool.query(`
      SELECT COUNT(*) AS approval_count
      FROM member_requests
      WHERE user_id = $1 AND dorm_id = $2 AND status = 'อนุมัติ'
    `, [user.id, dormId]);

    const isEligible = parseInt(pastStayCheck.rows[0].stay_count) > 0 || 
                       parseInt(currentStayCheck.rows[0].approval_count) > 0;

    // ตรวจสอบว่าผู้ใช้เคยรีวิวแล้วหรือไม่
    let hasReviewed = false;
    if (isEligible) {
      const reviewResult = await pool.query(
        "SELECT review_id FROM reviews WHERE user_id = $1 AND dorm_id = $2",
        [user.id, dormId]
      );
      hasReviewed = reviewResult.rows.length > 0;
    }

    const response = {
      can_review: isEligible && !hasReviewed,
      has_reviewed: hasReviewed,
      reason: !isEligible ? "รีวิวได้เฉพาะผู้ที่เคยพักอาศัยหรือกำลังพักอาศัยในหอนี้ (ต้องได้รับการอนุมัติจากเจ้าของหอ)" : 
              hasReviewed ? "คุณเคยรีวิวหอพักนี้แล้ว" : null
    };

    console.log('=== DEBUG API RESPONSE ===');
    // console.log('Final response being sent:', response);
    console.log('isEligible:', isEligible);
    console.log('hasReviewed:', hasReviewed);
    console.log('can_review:', response.can_review);
    console.log('=== END DEBUG ===');

    res.json(response);

  } catch (error) {
    console.error("Error checking review eligibility:", error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
};