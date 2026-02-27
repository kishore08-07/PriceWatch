/**
 * Review Extraction Service
 * Intelligent filtering and ranking of reviews to select 50-70 high-signal reviews
 * Prioritizes: recent reviews, extreme ratings (1-star, 5-star), helpful count
 */

/**
 * Parse a review date string in multiple formats.
 * Direct new Date() fails for strings like "Reviewed in India on 26 February 2026".
 *
 * Supported formats:
 *   - ISO:    "2026-02-26T00:00:00Z"
 *   - Amazon: "Reviewed in India on 26 February 2026"
 *   - US:     "February 26, 2026"
 *   - Short:  "26 Feb 2026", "Feb 26, 2026"
 *
 * @param {string} dateStr
 * @returns {Date|null} Date object or null if unparseable
 */
function parseReviewDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;

  // Strategy 1: Direct parse (ISO and many standard formats)
  let d = new Date(dateStr);
  if (isFinite(d.getTime())) return d;

  // Strategy 2: "DD Month YYYY" — e.g. "26 February 2026", "on 26 February 2026"
  const m2 = dateStr.match(/(\d{1,2})\s+(\w{3,})\s+(\d{4})/);
  if (m2) {
    d = new Date(`${m2[2]} ${m2[1]}, ${m2[3]}`);
    if (isFinite(d.getTime())) return d;
  }

  // Strategy 3: "Month DD, YYYY" — e.g. "February 26, 2026"
  const m3 = dateStr.match(/(\w{3,})\s+(\d{1,2}),?\s*(\d{4})/);
  if (m3) {
    d = new Date(`${m3[1]} ${m3[2]}, ${m3[3]}`);
    if (isFinite(d.getTime())) return d;
  }

  return null;
}

/**
 * Calculate signal score for each review
 * Combines: recency, rating extremeness, helpfulness, and length appropriateness
 *
 * @param {Object} review - Review object { rating, date, helpfulCount, text }
 * @param {Object} weights - Scoring weights
 * @returns {number} Signal score (0-100)
 */
function calculateSignalScore(review, weights = {}) {
  const {
    recencyWeight = 0.4,
    ratingExtremenessWeight = 0.3,
    helpfulnessWeight = 0.2,
    lengthWeight = 0.1
  } = weights;

  // Score 1: Recency (reviews from last 30 days scored higher)
  const reviewDate = parseReviewDate(review.date);
  const now = Date.now();
  let recencyScore = 0;
  if (reviewDate) {
    const daysSinceReview = (now - reviewDate.getTime()) / (1000 * 60 * 60 * 24);
    recencyScore = Math.max(0, 1 - (daysSinceReview / 30)); // Linear decay over 30 days
  }

  // Score 2: Rating Extremeness (5-star and 1-star most valuable)
  // 1-star: score=1, 2-star: 0.4, 3-star: 0, 4-star: 0.4, 5-star: 1
  const ratingExtremenessScore = Math.abs(review.rating - 3) / 2;

  // Score 3: Helpfulness (normalized to 0-1, most reviews have 0-100 helpful votes)
  const helpfulnessScore = Math.min(1, (review.helpfulCount || 0) / 100);

  // Score 4: Length Appropriateness (100-500 chars = best signal)
  const textLength = (review.text || '').length;
  let lengthScore = 0;
  if (textLength >= 100 && textLength <= 500) lengthScore = 1.0;
  else if (textLength >= 50 && textLength < 100) lengthScore = 0.6;
  else if (textLength > 500 && textLength <= 2000) lengthScore = 0.8;
  else lengthScore = 0.2;

  // Weighted combination
  const finalScore =
    (recencyScore * recencyWeight) +
    (ratingExtremenessScore * ratingExtremenessWeight) +
    (helpfulnessScore * helpfulnessWeight) +
    (lengthScore * lengthWeight);

  return Math.round(finalScore * 100);
}

/**
 * Check if two reviews are duplicates based on text similarity
 * Uses word overlap (Jaccard similarity)
 *
 * @param {string} text1 - First review text
 * @param {string} text2 - Second review text
 * @param {number} threshold - Similarity threshold (0-1, default 0.85)
 * @returns {boolean} True if reviews are likely duplicates
 */
function isTextDuplicate(text1, text2, threshold = 0.85) {
  if (!text1 || !text2) return false;

  // Simple tokenization
  const normalize = (text) =>
    text
      .toLowerCase()
      .split(/[\s\.,!?;:\-\(\)\[\]\{\}]+/)
      .filter((w) => w.length > 2);

  const tokens1 = new Set(normalize(text1));
  const tokens2 = new Set(normalize(text2));

  if (tokens1.size === 0 || tokens2.size === 0) return false;

  // Jaccard similarity: intersection / union
  const intersection = [...tokens1].filter((t) => tokens2.has(t)).length;
  const union = new Set([...tokens1, ...tokens2]).size;
  const similarity = intersection / union;

  return similarity >= threshold;
}

/**
 * Deduplicate reviews using text similarity
 * Keeps the review with highest signal score from each duplicate group
 *
 * @param {Array} reviews - Array of review objects
 * @param {number} similarityThreshold - Threshold for duplicate detection (default 0.85)
 * @returns {Array} Deduplicated reviews
 */
function deduplicateReviews(reviews, similarityThreshold = 0.85) {
  if (!Array.isArray(reviews) || reviews.length === 0) return [];

  const unique = [];
  const seenTexts = [];

  for (const review of reviews) {
    let isDuplicate = false;

    for (const seenText of seenTexts) {
      if (isTextDuplicate(review.text, seenText, similarityThreshold)) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      unique.push(review);
      seenTexts.push(review.text);
    }
  }

  console.log(
    `[ReviewExtraction] Deduplicated: ${reviews.length} → ${unique.length} reviews`
  );
  return unique;
}

/**
 * Filter reviews by quality metrics
 * Removes: too short, too long, non-English (heuristic)
 *
 * @param {Array} reviews - Array of review objects
 * @param {Object} options - Filter options
 * @returns {Array} Filtered reviews
 */
function filterByQuality(
  reviews,
  options = {}
) {
  const {
    minLength = 5,
    maxLength = Infinity,
    removeNonEnglish = false
  } = options;

  if (!Array.isArray(reviews)) return [];

  const filtered = reviews.filter((review) => {
    const text = review.text || '';
    const length = text.length;

    // Minimal length check — accept virtually all reviews
    if (length < minLength) {
      return false;
    }

    // No upper length limit — long reviews are valuable
    if (maxLength !== Infinity && length > maxLength) {
      return false;
    }

    // Simple English detection (if enabled): mostly ASCII + common Latin chars
    if (removeNonEnglish) {
      const asciiCount = (text.match(/[\x00-\x7F]/g) || []).length;
      const asciiRatio = asciiCount / length;
      if (asciiRatio < 0.7) return false;
    }

    return true;
  });

  console.log(
    `[ReviewExtraction] Filtered by quality: ${reviews.length} → ${filtered.length} reviews`
  );
  return filtered;
}

/**
 * Check if a date is considered "recent" (within days)
 * Handles various date formats from e-commerce platforms:
 *   - ISO: "2026-02-26T00:00:00Z"
 *   - Amazon: "Reviewed in India on 26 February 2026"
 *   - US: "February 26, 2026"
 *   - Short: "26 Feb 2026", "Feb 26, 2026"
 *
 * @param {string} dateStr - Date string (may contain extra text)
 * @param {number} days - Days to consider as recent
 * @returns {boolean} True if date is within days
 */
function isRecent(dateStr, days = 30) {
  if (!dateStr || typeof dateStr !== 'string') return false;

  let date;

  // Strategy 1: try direct parse (works for ISO and many standard formats)
  date = new Date(dateStr);
  if (isFinite(date.getTime())) {
    const diffDays = Math.abs(Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays <= days;
  }

  // Strategy 2: extract "DD Month YYYY" from strings like "Reviewed in India on 26 February 2026"
  const ddMonYYYY = dateStr.match(/(\d{1,2})\s+(\w{3,})\s+(\d{4})/);
  if (ddMonYYYY) {
    date = new Date(`${ddMonYYYY[2]} ${ddMonYYYY[1]}, ${ddMonYYYY[3]}`);
    if (isFinite(date.getTime())) {
      const diffDays = Math.abs(Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays <= days;
    }
  }

  // Strategy 3: extract "Month DD, YYYY" from strings
  const monDDYYYY = dateStr.match(/(\w{3,})\s+(\d{1,2}),?\s*(\d{4})/);
  if (monDDYYYY) {
    date = new Date(`${monDDYYYY[1]} ${monDDYYYY[2]}, ${monDDYYYY[3]}`);
    if (isFinite(date.getTime())) {
      const diffDays = Math.abs(Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays <= days;
    }
  }

  return false;
}

/**
 * Stratified sampling to ensure diverse review selection
 * Selects from: recent reviews, 5-star, 1-star, and mixed ratings
 *
 * @param {Array} reviews - Scored reviews array
 * @param {Object} options - Sampling options
 * @returns {Array} 50-70 strategically selected reviews
 */
function stratifiedSampling(reviews, options = {}) {
  const {
    targetCount = 500,
    recentCount = Math.ceil(targetCount * 0.3),
    fiveStarCount = Math.ceil(targetCount * 0.25),
    oneStarCount = Math.ceil(targetCount * 0.25),
    mixedCount = Math.ceil(targetCount * 0.2)
  } = options;

  if (!Array.isArray(reviews) || reviews.length === 0) return [];

  const total = recentCount + fiveStarCount + oneStarCount + mixedCount;
  if (total !== targetCount) {
    console.warn(
      `[ReviewExtraction] Stratum counts don't match target. Will sample ${total} instead of ${targetCount}`
    );
  }

  // Stratum 1: Recent reviews (last 30 days)
  const recent = reviews
    .filter((r) => isRecent(r.date, 30))
    .sort((a, b) => b.signalScore - a.signalScore)
    .slice(0, recentCount);

  // Stratum 2: 5-star reviews (best experiences)
  const fiveStars = reviews
    .filter((r) => r.rating === 5)
    .sort((a, b) => b.signalScore - a.signalScore)
    .slice(0, fiveStarCount);

  // Stratum 3: 1-star reviews (worst experiences, important for cons)
  const oneStars = reviews
    .filter((r) => r.rating === 1)
    .sort((a, b) => b.signalScore - a.signalScore)
    .slice(0, oneStarCount);

  // Stratum 4: Mixed reviews (2-4 stars, balanced perspective)
  const mixed = reviews
    .filter(
      (r) =>
        ![...recent, ...fiveStars, ...oneStars].some(
          (sampled) => sampled.id === r.id
        )
    )
    .filter((r) => r.rating >= 2 && r.rating <= 4)
    .sort((a, b) => b.signalScore - a.signalScore)
    .slice(0, mixedCount);

  // Dedup across strata — a review might match multiple criteria
  const usedIds = new Set();
  const selected = [];
  for (const r of [...recent, ...fiveStars, ...oneStars, ...mixed]) {
    if (!usedIds.has(r.id)) {
      usedIds.add(r.id);
      selected.push(r);
    }
  }
  selected.sort((a, b) => b.signalScore - a.signalScore);

  // If strata didn't fill the target, add remaining scored reviews
  if (selected.length < targetCount) {
    for (const r of reviews) {
      if (selected.length >= targetCount) break;
      if (!usedIds.has(r.id)) {
        usedIds.add(r.id);
        selected.push(r);
      }
    }
  }

  console.log(`🎯 [Extraction] Stratified sampling → target=${targetCount}`);
  console.log(`   recent(30d)=${recent.length}  5★=${fiveStars.length}  1★=${oneStars.length}  mixed=${mixed.length}  total=${selected.length}`);

  return selected;
}

/**
 * Extract high-signal reviews using signal scoring and stratified sampling
 * Main orchestration function
 *
 * @param {Array} reviews - All available reviews
 * @param {Object} options - Extraction options
 * @returns {Array} 50-70 high-quality reviews
 */
function extractHighSignalReviews(reviews, options = {}) {
  const {
    targetCount = 500,
    minLength = 5,
    maxLength = Infinity,
    similarityThreshold = 0.85,
    recencyWeight = 0.4,
    ratingExtremenessWeight = 0.3,
    helpfulnessWeight = 0.2,
    lengthWeight = 0.1
  } = options;

  if (!Array.isArray(reviews) || reviews.length === 0) {
    console.warn('[ReviewExtraction] No reviews to extract');
    return [];
  }

  const startTime = Date.now();

  // ── FAST PATH: when we want ALL reviews ─────────────────────────────────────
  // targetCount >= reviews.length means "keep everything".
  // The content script already fingerprint-deduplicates (prefix+length+tail).
  // Running O(n²) Jaccard similarity on top of that for 500-1000 reviews would
  // block the Node event loop for several seconds. Skip it entirely.
  if (targetCount >= reviews.length) {
    const scored = reviews
      .filter((r) => (r.text || '').length >= minLength)
      .map((review, idx) => ({
        ...review,
        id: review.id || `review_${idx}`,
        signalScore: calculateSignalScore(review, {
          recencyWeight,
          ratingExtremenessWeight,
          helpfulnessWeight,
          lengthWeight,
        }),
      }));

    const elapsed = Date.now() - startTime;
    // Rating distribution for the log
    const ratingCounts = [1,2,3,4,5].map(s => ({
      stars: s,
      count: scored.filter(r => Math.round(r.rating) === s).length
    }));
    const recentCount = scored.filter(r => {
      const d = parseReviewDate(r.date);
      return d && (Date.now() - d.getTime()) < 30 * 24 * 60 * 60 * 1000;
    }).length;
    console.log(`📊 [Extraction] Step 3 — Signal scoring (fast path)`);
    console.log(`   Input    : ${reviews.length}  →  Passed : ${scored.length} (min ${minLength} chars)`);
    console.log(`   Ratings  : ${ratingCounts.map(r => `${r.stars}★=${r.count}`).join('  ')}`);
    console.log(`   Recent   : ${recentCount} reviews (within 30 days)`);
    console.log(`   Time     : ${elapsed}ms`);
    return scored;
  }

  // ── FULL PIPELINE: when we want a subset (stratified sampling) ────────────

  // Step 1: Deduplicate by text similarity (Jaccard)
  let deduplicated = deduplicateReviews(reviews, similarityThreshold);

  // Step 2: Filter by quality metrics
  let filtered = filterByQuality(deduplicated, {
    minLength,
    maxLength
  });

  if (filtered.length === 0) {
    console.warn(
      '[ReviewExtraction] No reviews passed quality filters, using all original reviews'
    );
    filtered = reviews.slice(0, targetCount);
  }

  // Step 3: Calculate signal scores for remaining reviews
  const scored = filtered.map((review, idx) => ({
    ...review,
    id: review.id || `review_${idx}`,
    signalScore: calculateSignalScore(review, {
      recencyWeight,
      ratingExtremenessWeight,
      helpfulnessWeight,
      lengthWeight
    })
  }));

  // Step 4: Stratified sampling to get diverse subset
  const selected = stratifiedSampling(scored, { targetCount });

  const elapsed = Date.now() - startTime;
  console.log(
    `[ReviewExtraction] Complete: ${reviews.length} → ${selected.length} high-signal reviews (${elapsed}ms)`
  );

  return selected;
}

module.exports = {
  parseReviewDate,
  calculateSignalScore,
  isTextDuplicate,
  deduplicateReviews,
  filterByQuality,
  isRecent,
  stratifiedSampling,
  extractHighSignalReviews
};
