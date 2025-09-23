const axios = require('axios');

const ML_API_URL = process.env.ML_API_URL || 'http://localhost:8000';

async function predictReviewRating(text) {
  const payload = { text };
  const url = `${ML_API_URL}/predict`;
  const response = await axios.post(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000
  });
  return response.data;
}

module.exports = { predictReviewRating };


