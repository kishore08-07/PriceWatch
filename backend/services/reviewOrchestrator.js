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
const { scrapeReviews } = require('./reviewScrapingService');

// ── Limits & Timeouts ─────────────────────────────────────────────────────────
const MAX_REVIEWS_PER_REQUEST = 2000;   // Hard cap on reviews sent to Python
const MAX_ANALYSIS_REVIEWS = 450;       // Practical cap to keep AI latency low while preserving quality
const MAX_REVIEW_TEXT_CHARS = 5000;     // Per-review text char limit
const PIPELINE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minute total pipeline timeout
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
// Platforms where the extension nearly always gets bot-blocked on pagination
// pages beyond the first. For these, the backend is the AUTHORITATIVE source.
const SERVER_PRIMARY_PLATFORMS = new Set(['amazon', 'flipkart', 'reliancedigital']);

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
      const m = url.match(/\/(?:dp|gp\/product|product-reviews|ASIN)\/([A-Z0-9]{10})/i);
      return m ? m[1].toUpperCase() : _fallbackId(url);
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
    .filter((r) => r && typeof r.text === 'string' && r.text.length > 0)
    .map((r) => {
      let text = sanitizeText(r.text, { maxLength: 0 });
      // Cap individual review text length
      if (text.length > MAX_REVIEW_TEXT_CHARS) {
        text = text.substring(0, MAX_REVIEW_TEXT_CHARS);
      }
      return {
        text,
        rating: parseFloat(r.rating) || 3.0,
      };
    })
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
  const { skipCache = false, cacheTtlMs = 6 * 60 * 60 * 1000, cookies = '' } = options;
  const safeRawReviews = Array.isArray(rawReviews) ? rawReviews : [];
  let effectiveTotalScraped = options.totalScraped || safeRawReviews.length;

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
      const isStaleNoReviewSummary = /be\s+(the\s+)?first\s+one\s+to\s+review|be\s+the\s+first\s+to\s+review/i
        .test(String(cached.summary || ''));
      if (isStaleNoReviewSummary) {
        console.log(`⚠️ [Orchestrator] Ignoring stale cached summary for ${cacheKey}`);
      } else {
      const hitMs = Date.now() - pipelineStart;
      console.log(`⚡ [Orchestrator] Cache HIT — ${cacheKey} (${hitMs}ms)`);
      console.log(`   Cached: ${cached.totalReviews} analyzed / ${cached.totalScraped || '?'} scraped`);
      return { ...cached, fromCache: true, cacheHitTimeMs: hitMs };
      }
    }
  }

  // ── 3. Validate + sanitise extension reviews ─────────────────────────────
  const validationResult = validateAndSanitizeReviews(safeRawReviews);
  let sanitizedReviews = validationResult.valid ? validationResult.reviews : [];

  const droppedBySanitize = safeRawReviews.length - sanitizedReviews.length;
  const reportedClientPages = Number.isFinite(options.totalPages) ? options.totalPages : 0;

  // For Amazon and Flipkart, ALWAYS run server-side scraping because:
  //   1. Extension pagination is consistently bot-blocked after page 1
  //   2. Server-side axios requests lack Sec-Fetch-* headers (no bot detection)
  //   3. Extension reviews are still kept as a deduped supplement
  // For Reliance Digital (SPA with JSON API), the extension typically scrapes
  // single-page reviews accurately, so we only supplement when truly thin.
  const clientCoverageRatio =
    effectiveTotalScraped > 0 ? sanitizedReviews.length / effectiveTotalScraped : 1;
  const shouldRunServerScraping =
    SERVER_PRIMARY_PLATFORMS.has(platform) ||
    sanitizedReviews.length === 0 ||
    (sanitizedReviews.length < 30 && clientCoverageRatio < 0.6);

  console.log(`🧹 [Orchestrator] Step 1 — Sanitize`);
  console.log(`   Input    : ${safeRawReviews.length} raw reviews from extension`);
  console.log(`   Passed   : ${sanitizedReviews.length} reviews (≥ 5 chars, valid text)`);
  if (droppedBySanitize > 0)
    console.log(`   Dropped  : ${droppedBySanitize} (too short / non-string)`);
  console.log(`   Platform : ${platform}  |  Product: ${productId}`);
  if (reportedClientPages > 0) {
    console.log(`   Client pages reported: ${reportedClientPages}`);
  }

  // ── 3b. Server-side scraping (primary for Amazon/Flipkart, supplement for others) ─
  if (shouldRunServerScraping) {
    console.log(
      `📡 [Orchestrator] Server-side scraping ` +
      `(platform=${platform}, client=${sanitizedReviews.length} reviews, coverage=${(clientCoverageRatio * 100).toFixed(1)}%)…`
    );
    try {
      const targetMaxPages = SERVER_PRIMARY_PLATFORMS.has(platform) ? 5 : 3;
      const scrapeResult = await scrapeReviews(url, platform, targetMaxPages, cookies);

      if (Number.isFinite(scrapeResult.totalFound) && scrapeResult.totalFound > 0) {
        effectiveTotalScraped = scrapeResult.totalFound;
      }

      if (scrapeResult.reviews.length > 0) {
        console.log(
          `📡 [Orchestrator] Server scraped: ${scrapeResult.reviews.length} reviews ` +
          `(${scrapeResult.pagesScraped} pages, ${scrapeResult.totalFound || '?'} total on site)`
        );

        // Validate + sanitise server-scraped reviews
        const serverValidation = validateAndSanitizeReviews(scrapeResult.reviews);
        const serverReviews = serverValidation.valid ? serverValidation.reviews : [];

        const shouldPreferServerOnly =
          SERVER_PRIMARY_PLATFORMS.has(platform) &&
          serverReviews.length >= 20;

        // For supported platforms, server scraping is authoritative once we have
        // enough reviews. Client-side reviews are only used as a thin-data supplement.
        const merged = shouldPreferServerOnly
          ? [...serverReviews]
          : [...sanitizedReviews, ...serverReviews];
        const seen = new Set();
        sanitizedReviews = merged.filter((r) => {
          const fp = (r.text || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 120);
          if (fp.length < 10 || seen.has(fp)) return false;
          seen.add(fp);
          return true;
        });

        effectiveTotalScraped = scrapeResult.totalFound || Math.max(effectiveTotalScraped, sanitizedReviews.length);

        console.log(
          `📡 [Orchestrator] After merge + dedup: ${sanitizedReviews.length} unique reviews ` +
          `(site total: ${effectiveTotalScraped})`
        );
      }
    } catch (scrapeErr) {
      console.warn(`[Orchestrator] Server-side scraping failed: ${scrapeErr.message}`);
      // Continue gracefully with extension-only reviews
    }
  }

  // Bail if we still have no reviews after server-side attempt
  if (sanitizedReviews.length === 0) {
    return {
      success: true,
      platform,
      productId,
      totalReviews: 0,
      totalAnalyzed: 0,
      totalScraped: effectiveTotalScraped || 0,
      noReviewsFound: true,
      sentimentScore: 0,
      sentimentDistribution: {
        positive: 0,
        neutral: 0,
        negative: 0,
        total: 0,
      },
      pros: [],
      cons: [],
      summary: 'No reviews found for this product yet.',
      preprocessingStats: null,
      modelDetails: null,
      processingTimeMs: 0,
      pipelineTimeMs: Date.now() - pipelineStart,
      fromCache: false,
      analyzedAt: new Date().toISOString(),
    };
  }

  // ── 4. High-signal review extraction (process ALL reviews) ────────────────
  const analysisTarget = Math.min(sanitizedReviews.length, MAX_ANALYSIS_REVIEWS);
  const highSignal = extractHighSignalReviews(sanitizedReviews, {
    targetCount: analysisTarget,
  });
  const reviewsForAnalysis =
    highSignal.length > 0 ? highSignal : sanitizedReviews;

  const droppedBySignal = sanitizedReviews.length - reviewsForAnalysis.length;
  console.log(`🎯 [Orchestrator] Step 2 — Signal scoring`);
  console.log(`   Scored   : ${reviewsForAnalysis.length} reviews`);
  console.log(`   Target   : up to ${analysisTarget} high-signal reviews`);
  if (droppedBySignal > 0)
    console.log(`   Dropped  : ${droppedBySignal} (below quality threshold)`);
  console.log(`   Sending → Python AI service…`);

  // ── 5. Python NLP inference (BART + DistilBERT + RoBERTa) ────────────────
  // Cap the number of reviews sent to avoid overwhelming the Python service
  let reviewsToSend = reviewsForAnalysis;
  if (reviewsToSend.length > MAX_REVIEWS_PER_REQUEST) {
    console.log(`[Orchestrator] Capping reviews: ${reviewsToSend.length} → ${MAX_REVIEWS_PER_REQUEST}`);
    reviewsToSend = reviewsToSend.slice(0, MAX_REVIEWS_PER_REQUEST);
  }

  let nlpResult;
  try {
    // Wrap the NLP call in a pipeline-level timeout
    nlpResult = await Promise.race([
      pythonNlpClient.analyzeReviews(reviewsToSend, { platform, productId }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Pipeline timeout after ${PIPELINE_TIMEOUT_MS / 1000}s`)),
          PIPELINE_TIMEOUT_MS
        )
      ),
    ]);
  } catch (err) {
    console.error(`[Orchestrator] Python NLP service error: ${err.message}`);
    const circuitStatus = pythonNlpClient.getCircuitStatus
      ? pythonNlpClient.getCircuitStatus()
      : null;
    return {
      success: false,
      error: `AI service unavailable: ${err.message}`,
      platform,
      productId,
      circuitBreaker: circuitStatus,
      hint: 'Start the Python service: cd ai-service && uvicorn app:app --port 5001',
    };
  }

  // ── 6. Build result + cache ───────────────────────────────────────────────
  const result = {
    success: true,
    platform,
    productId,
    totalReviews: nlpResult.totalReviews || reviewsForAnalysis.length,
    totalAnalyzed: nlpResult.totalAnalyzed || reviewsForAnalysis.length,
    totalScraped: effectiveTotalScraped,
    sentimentScore: nlpResult.sentimentScore,
    sentimentDistribution: nlpResult.sentimentDistribution,
    pros: nlpResult.pros || [],
    cons: nlpResult.cons || [],
    summary: nlpResult.summary || '',
    preprocessingStats: nlpResult.preprocessingStats || null,
    modelDetails: nlpResult.modelDetails || null,
    processingTimeMs: nlpResult.processingTimeMs,
    pipelineTimeMs: Date.now() - pipelineStart,
    fromCache: false,
    analyzedAt: new Date().toISOString(),
  };

  cacheService.setCache(cacheKey, result, cacheTtlMs);
  console.log(`💾 [Orchestrator] Step 4 — Cached as '${cacheKey}' (TTL 6h)`);
  console.log(`🏁 [Orchestrator] Pipeline complete in ${result.pipelineTimeMs}ms`);
  console.log(`   Scraped  : ${effectiveTotalScraped}  |  Analyzed: ${reviewsForAnalysis.length}  |  Score: ${result.sentimentScore}`);
  console.log(`   Pros: ${result.pros.length}  |  Cons: ${result.cons.length}  |  Summary: ${result.summary.length} chars`);

  return result;
}

module.exports = {
  orchestrateAnalysis,
  detectPlatform,
  extractProductId,
  invalidateCache,
};
