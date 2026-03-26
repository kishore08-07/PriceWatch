/**
 * Review Analysis Routes
 * ======================
 * POST /api/reviews/analyze-direct   — analyse reviews extracted by the extension
 * POST /api/reviews/invalidate-cache — bust the cache for a product
 * GET  /api/reviews/health           — health check (Node + Python service)
 */

'use strict';

const express = require('express');
const router = express.Router();

const {
  orchestrateAnalysis,
  invalidateCache,
  detectPlatform,
  extractProductId,
} = require('../services/reviewOrchestrator');
const { checkHealth: checkPythonHealth, getCircuitStatus } = require('../services/pythonNlpClient');
const cacheService = require('../utils/cacheService');

// ── POST /api/reviews/analyze-direct ─────────────────────────────────────────

/**
 * Analyse reviews extracted by the extension content script.
 *
 * Body:
 * {
 *   url      : string   — product page URL (platform detection + cache key)
 *   reviews  : Array    — review objects { text, rating, author?, title?, date?, helpfulCount? }
 *   skipCache: boolean? — force fresh analysis (default: false)
 * }
 *
 * Response:
 * {
 *   success, platform, productId, totalReviews,
 *   sentimentScore (0–100), sentimentDistribution,
 *   pros, cons, summary,
 *   processingTimeMs, pipelineTimeMs,
 *   fromCache, analyzedAt
 * }
 */
router.post('/analyze-direct', async (req, res) => {
  try {
    const { url, reviews, skipCache = false, totalScraped, totalPages = 0, cookies = '' } = req.body;

    if (!url || typeof url !== 'string' || url.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_URL',
        message: 'url is required and must be a non-empty string.',
      });
    }

    if (url.length > 2048) {
      return res.status(400).json({
        success: false,
        error: 'URL_TOO_LONG',
        message: 'url must not exceed 2048 characters.',
      });
    }

    if (!Array.isArray(reviews)) {
      return res.status(400).json({
        success: false,
        error: 'NO_REVIEWS',
        message: 'reviews must be an array.',
      });
    }

    const normalizedUrl = url.trim();
    const { platform: detectedPlatform } = detectPlatform(normalizedUrl);
    const productId = extractProductId(normalizedUrl, detectedPlatform);
    const cacheKey = `${detectedPlatform}:${productId}`;
    const supportsServerScrape = detectedPlatform === 'amazon' || detectedPlatform === 'flipkart' || detectedPlatform === 'reliancedigital';

    if (reviews.length === 0 && !supportsServerScrape) {
      return res.status(400).json({
        success: false,
        error: 'NO_REVIEWS',
        message: 'No reviews received from client and server-side scraping is unavailable for this platform.',
      });
    }

    if (reviews.length > 5000) {
      return res.status(400).json({
        success: false,
        error: 'TOO_MANY_REVIEWS',
        message: 'Maximum 5000 reviews allowed per request.',
      });
    }

    console.log(
      `[ReviewRoutes] /analyze-direct: ${reviews.length} reviews for ${url.substring(0, 80)}`
    );

    const freshTotalScraped = Number.isFinite(totalScraped) ? totalScraped : reviews.length;
    const payloadKB = (JSON.stringify(reviews).length / 1024).toFixed(1);

    console.log('\n' + '═'.repeat(60));
    console.log(`📥 REVIEW ANALYSIS REQUEST`);
    console.log(`   URL      : ${url.substring(0, 70)}`);
    console.log(`   Received : ${reviews.length} reviews from extension`);
    console.log(`   Scraped  : ${freshTotalScraped} total scraped (before dedup)`);
    console.log(`   Payload  : ${payloadKB} KB`);
    console.log(`   Cache    : ${skipCache ? 'SKIP (forced)' : 'check'}`);
    console.log('─'.repeat(60));

    // Auto-bust stale cache when the fresh scrape count is significantly larger
    // than what was analyzed in the cached result.
    // Scenario: cache was built when only 14 reviews reached the pipeline (old extension),
    // but now pagination delivers 800+ reviews — the old result is misleading.
    let effectiveSkipCache = Boolean(skipCache);
    if (!effectiveSkipCache && reviews.length === 0 && supportsServerScrape) {
      const cached = cacheService.getCache(cacheKey);
      if (!cached) {
        effectiveSkipCache = true;
        console.log('[ReviewRoutes] No client reviews and no cache entry — forcing fresh server-side scrape (skip cache)');
      } else {
        console.log('[ReviewRoutes] No client reviews but cache exists — allowing cache lookup');
      }
    }

    if (!effectiveSkipCache) {
      const cached = cacheService.getCache(cacheKey);
      if (cached && cached.totalScraped && freshTotalScraped > cached.totalScraped * 2) {
        console.log(
          `[ReviewRoutes] Stale cache detected: cached.totalScraped=${cached.totalScraped}, ` +
          `fresh=${freshTotalScraped} — forcing re-analysis`
        );
        effectiveSkipCache = true;
      }
    }

    const result = await orchestrateAnalysis(normalizedUrl, reviews, {
      skipCache: effectiveSkipCache,
      totalScraped: freshTotalScraped,
      totalPages,
      cookies,
    });

    if (!result.success) {
      return res.status(422).json(result);
    }

    // Surface the most reliable scraped count. Prefer backend orchestration output,
    // then fallback to fresh client count when server-side totals are unavailable.
    const finalResult = {
      ...result,
      totalScraped: Number.isFinite(result.totalScraped) && result.totalScraped > 0
        ? result.totalScraped
        : freshTotalScraped,
    };

    console.log(`✅ RESPONSE SENT`);
    console.log(`   Reviews analyzed : ${finalResult.totalReviews}`);
    console.log(`   Reviews scraped  : ${finalResult.totalScraped}`);
    console.log(`   Sentiment score  : ${finalResult.sentimentScore}`);
    console.log(`   From cache       : ${finalResult.fromCache}`);
    if (finalResult.pipelineTimeMs) console.log(`   Pipeline time    : ${finalResult.pipelineTimeMs}ms`);
    console.log('═'.repeat(60) + '\n');

    return res.status(200).json(finalResult);
  } catch (err) {
    console.error('[ReviewRoutes] /analyze-direct error:', err);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred. Please try again later.',
    });
  }
});

// ── POST /api/reviews/invalidate-cache ───────────────────────────────────────

/**
 * Invalidate the cached analysis result for a product.
 * Body: { url: string }
 */
router.post('/invalidate-cache', (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'INVALID_URL',
        message: 'url is required.',
      });
    }

    const result = invalidateCache(url.trim());
    return res.status(200).json(result);
  } catch (err) {
    console.error('[ReviewRoutes] /invalidate-cache error:', err);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to invalidate cache.',
    });
  }
});

// ── GET /api/reviews/health ───────────────────────────────────────────────────

/**
 * Health check for both the Node review service and the Python AI service.
 */
router.get('/health', async (req, res) => {
  const cacheStats = cacheService.getCacheStats();
  const pythonOk = await checkPythonHealth();
  const circuitStatus = getCircuitStatus();

  return res.status(200).json({
    status: 'ok',
    service: 'review-analysis',
    pythonAiService: pythonOk ? 'reachable' : 'unreachable',
    circuitBreaker: circuitStatus,
    cache: cacheStats,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
