/**
 * Review Orchestrator
 * ===================
 * Coordinates the complete review analysis pipeline:
 *
 *   Popup (extension)
 *     └─ Background (extension)
 *          └─ Content script → raw reviews
 *               └─ [HERE] Node orchestrator
 *                    ├─ Validate & sanitise reviews
 *                    ├─ Deduplicate + select 50–70 high-signal reviews
 *                    ├─ Check in-memory cache  (platform:productId)
 *                    ├─ Call Python AI service  (BART + DistilBERT + RoBERTa)
 *                    └─ Cache result + return structured insights
 */

'use strict';

const { extractHighSignalReviews } = require('./reviewExtractionService');
const { sanitizeText } = require('../utils/sanitizer');
const cacheService = require('../utils/cacheService');
const pythonNlpClient = require('./pythonNlpClient');

// ── Platform helpers ──────────────────────────────────────────────────────────

/**
 * Detect the e-commerce platform from a product URL.
 * @param {string} url
 * @returns {{ platform: string, valid: boolean, error?: string }}
 */
function detectPlatform(url) {
  if (!url || typeof url !== 'string') {
    return { platform: 'unknown', valid: false, error: 'Invalid URL' };
  }

  const u = url.toLowerCase();
  if (u.includes('amazon.')) return { platform: 'amazon', valid: true };
  if (u.includes('flipkart.com')) return { platform: 'flipkart', valid: true };
  if (u.includes('reliancedigital.in'))
    return { platform: 'reliancedigital', valid: true };

  return {
    platform: 'unknown',
    valid: false,
    error: 'Unsupported platform. Supported: Amazon, Flipkart, Reliance Digital.',
  };
}

/**
 * Extract a stable product identifier from a URL.
 * @param {string} url
 * @param {string} platform
 * @returns {string}
 */
function extractProductId(url, platform) {
  try {
    if (platform === 'amazon') {
      const m = url.match(/\/dp\/([A-Z0-9]{10})/i);
      return m ? m[1] : _fallbackId(url);
    }
    if (platform === 'flipkart') {
      const m = url.match(/\/p\/itm([a-zA-Z0-9]{16})/);
      return m ? m[1] : _fallbackId(url);
    }
    if (platform === 'reliancedigital') {
      const m = url.match(/\/p\/[^/]+\/(\d+)/);
      return m ? m[1] : _fallbackId(url);
    }
  } catch {
    // fall through
  }
  return _fallbackId(url);
}

function _fallbackId(url) {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).pop() || 'unknown';
  } catch {
    return 'unknown';
  }
}

// ── Review validation & sanitisation ─────────────────────────────────────────

/**
 * Validate and sanitise raw reviews received from the extension.
 * Applies text cleaning, type coercion, and minimum-length filtering.
 *
 * @param {Array} rawReviews  Raw review objects from content script
 * @returns {{ valid: boolean, reviews?: Array, error?: string }}
 */
function validateAndSanitizeReviews(rawReviews) {
  if (!Array.isArray(rawReviews) || rawReviews.length === 0) {
    return { valid: false, error: 'No reviews provided' };
  }

  const sanitized = rawReviews
    .filter((r) => r && typeof r.text === 'string')
    .map((r) => ({
      text: sanitizeText(r.text, { maxLength: 0 }),
      rating: parseFloat(r.rating) || 3.0,
      author: r.author || 'Anonymous',
      title: r.title || '',
      date: r.date || new Date().toISOString(),
      helpfulCount: parseInt(r.helpfulCount, 10) || 0,
    }))
    .filter((r) => r.text.length >= 5);

  if (sanitized.length === 0) {
    return {
      valid: false,
      error:
        'No valid reviews found after sanitisation.',
    };
  }

  return { valid: true, reviews: sanitized };
}

// ── Cache management ─────────────────────────────────────────────────────────

/**
 * Invalidate the cached analysis for a product URL.
 * @param {string} url
 * @returns {{ success: boolean, platform?: string, productId?: string, error?: string }}
 */
function invalidateCache(url) {
  const { platform, valid } = detectPlatform(url);
  if (!valid) return { success: false, error: 'Invalid URL' };

  const productId = extractProductId(url, platform);
  const cacheKey = `${platform}:${productId}`;
  const deleted = cacheService.deleteCache(cacheKey);

  console.log(`[Orchestrator] Cache invalidated: ${cacheKey} (deleted=${deleted})`);
  return { success: deleted, platform, productId };
}

// ── Main orchestration ────────────────────────────────────────────────────────

/**
 * Run the complete review analysis pipeline.
 *
 * @param {string} url         Product page URL (used for platform/ID detection and caching)
 * @param {Array}  rawReviews  Review objects extracted by the content script
 * @param {Object} [options]
 * @param {boolean} [options.skipCache=false]         Force fresh analysis even if cached
 * @param {number}  [options.cacheTtlMs=21600000]     Cache TTL in ms (default 6 hours)
 *
 * @returns {Promise<Object>} Structured analysis result
 */
async function orchestrateAnalysis(url, rawReviews, options = {}) {
  const {
    skipCache = false,
    cacheTtlMs = 6 * 60 * 60 * 1000, // 6 hours
    totalScraped = rawReviews.length, // total scraped by extension (before any NLP filtering)
  } = options;

  const pipelineStart = Date.now();

  // ── 1. Platform detection ─────────────────────────────────────────────────
  const { platform, valid, error: platformError } = detectPlatform(url);
  if (!valid) {
    return {
      success: false,
      error: platformError || 'Unsupported platform',
      platform,
    };
  }

  const productId = extractProductId(url, platform);
  const cacheKey = `${platform}:${productId}`;

  // ── 2. Cache check (fast path) ────────────────────────────────────────────
  if (!skipCache) {
    const cached = cacheService.getCache(cacheKey);
    if (cached) {
      const hitMs = Date.now() - pipelineStart;
      console.log(`⚡ [Orchestrator] Cache HIT — ${cacheKey} (${hitMs}ms)`);
      console.log(`   Cached: ${cached.totalReviews} analyzed / ${cached.totalScraped || '?'} scraped`);
      return { ...cached, fromCache: true, cacheHitTimeMs: hitMs };
    }
  }

  // ── 3. Validate + sanitise reviews ───────────────────────────────────────
  const {
    valid: reviewsValid,
    reviews: sanitizedReviews,
    error: reviewError,
  } = validateAndSanitizeReviews(rawReviews);

  if (!reviewsValid) {
    return { success: false, error: reviewError, platform, productId };
  }

  const droppedBySanitize = rawReviews.length - sanitizedReviews.length;
  console.log(`🧹 [Orchestrator] Step 1 — Sanitize`);
  console.log(`   Input    : ${rawReviews.length} raw reviews`);
  console.log(`   Passed   : ${sanitizedReviews.length} reviews (≥ 5 chars, valid text)`);
  if (droppedBySanitize > 0)
    console.log(`   Dropped  : ${droppedBySanitize} (too short / non-string)`);
  console.log(`   Platform : ${platform}  |  Product: ${productId}`);

  // ── 4. High-signal review extraction (process ALL reviews) ────────────────
  const highSignal = extractHighSignalReviews(sanitizedReviews, {
    targetCount: sanitizedReviews.length,
  });
  const reviewsForAnalysis =
    highSignal.length > 0 ? highSignal : sanitizedReviews;

  const droppedBySignal = sanitizedReviews.length - reviewsForAnalysis.length;
  console.log(`🎯 [Orchestrator] Step 2 — Signal scoring`);
  console.log(`   Scored   : ${reviewsForAnalysis.length} reviews`);
  if (droppedBySignal > 0)
    console.log(`   Dropped  : ${droppedBySignal} (below quality threshold)`);
  console.log(`   Sending → Python AI service…`);

  // ── 5. Python NLP inference (BART + DistilBERT + RoBERTa) ────────────────
  let nlpResult;
  try {
    nlpResult = await pythonNlpClient.analyzeReviews(reviewsForAnalysis, {
      platform,
      productId,
    });
  } catch (err) {
    console.error(`[Orchestrator] Python NLP service error: ${err.message}`);
    return {
      success: false,
      error: `AI service unavailable: ${err.message}`,
      platform,
      productId,
      hint: 'Start the Python service: cd ai-service && uvicorn app:app --port 5001',
    };
  }

  // ── 6. Build result + cache ───────────────────────────────────────────────
  const result = {
    success: true,
    platform,
    productId,
    totalReviews: reviewsForAnalysis.length,   // reviews that went through AI
    totalScraped,                               // total scraped by extension
    sentimentScore: nlpResult.sentimentScore,
    sentimentDistribution: nlpResult.sentimentDistribution,
    pros: nlpResult.pros || [],
    cons: nlpResult.cons || [],
    summary: nlpResult.summary || '',
    processingTimeMs: nlpResult.processingTimeMs,
    pipelineTimeMs: Date.now() - pipelineStart,
    fromCache: false,
    analyzedAt: new Date().toISOString(),
  };

  cacheService.setCache(cacheKey, result, cacheTtlMs);
  console.log(`💾 [Orchestrator] Step 4 — Cached as '${cacheKey}' (TTL 6h)`);
  console.log(`🏁 [Orchestrator] Pipeline complete in ${result.pipelineTimeMs}ms`);
  console.log(`   Scraped  : ${totalScraped}  |  Analyzed: ${reviewsForAnalysis.length}  |  Score: ${result.sentimentScore}`);
  console.log(`   Pros: ${result.pros.length}  |  Cons: ${result.cons.length}  |  Summary: ${result.summary.length} chars`);

  return result;
}

module.exports = {
  orchestrateAnalysis,
  detectPlatform,
  extractProductId,
  invalidateCache,
};
