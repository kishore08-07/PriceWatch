/**
 * Server-Side Review Scraping Service
 * =====================================
 * Fetches review pages from Amazon / Flipkart using Node.js axios.
 *
 * WHY server-side?
 *   Browser fetch() automatically attaches Sec-Fetch-Mode: cors and
 *   Sec-Fetch-Dest: empty headers that Amazon's bot detection uses to
 *   block non-navigation requests. Server-side HTTP has no such restriction.
 *
 * Features:
 *   • Concurrent batch fetching with configurable concurrency
 *   • User-Agent rotation
 *   • Exponential backoff on failures
 *   • CAPTCHA / bot-block detection
 *   • cheerio-based HTML parsing (same data-hook selectors as content script)
 *   • Deduplication by text fingerprint
 *   • Graceful degradation (never throws — returns empty on total failure)
 */

'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { withBrowser } = require('../utils/browserPool');
const cacheService = require('../utils/cacheService');

// ── Configuration ─────────────────────────────────────────────────────────────

const CONFIG = {
  MAX_PAGES_DEFAULT: 100,                 // 100 pages × 10 reviews = 1 000 reviews
  CONCURRENCY: 3,                         // Simultaneous page fetches per batch
  BATCH_DELAY_MS: 1200,                   // Base delay between batches
  BATCH_JITTER_MS: 600,                   // Random jitter added to delay
  REQUEST_TIMEOUT_MS: 12_000,             // Per-request HTTP timeout
  MAX_RETRIES: 2,                         // Per-page retry count
  RETRY_DELAY_MS: 2000,                   // Base delay between retries
  MAX_CONSECUTIVE_BATCH_FAILURES: 3,      // Stop pagination after N failed batches
  AMAZON_MIN_TARGET_PAGES: 3,
  AMAZON_MAX_TARGET_PAGES: 5,
  REVIEW_SCRAPE_CACHE_TTL_MS: 20 * 60 * 1000,
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
];

let _uaIdx = 0;
const nextUA = () => USER_AGENTS[_uaIdx++ % USER_AGENTS.length];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Shared helpers ────────────────────────────────────────────────────────────

function extractAsinFromUrl(url) {
  if (!url) return null;
  const m = url.match(/\/(?:dp|gp\/product|product-reviews|ASIN)\/([A-Z0-9]{10})/i);
  return m ? m[1].toUpperCase() : null;
}

function getOrigin(url) {
  try { return new URL(url).origin; }
  catch { return 'https://www.amazon.in'; }
}

function isBotBlocked(html) {
  if (!html || html.length < 1500) return true;
  const lc = html.toLowerCase();
  return (
    lc.includes('validatecaptcha') ||
    lc.includes('type the characters you see') ||
    lc.includes('sorry, we just need to make sure you') ||
    lc.includes('/errors/validatecaptcha') ||
    lc.includes('you have been blocked') ||
    lc.includes('403 forbidden') ||
    (lc.includes('access denied') && html.length < 5000)
  );
}

function parseCookieHeader(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return [];
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf('=');
      if (idx <= 0) return null;
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (!name) return null;
      return { name, value };
    })
    .filter(Boolean);
}

function dedupeReviews(reviews) {
  const seen = new Set();
  return (reviews || []).filter((r) => {
    const fp = (r.text || '').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 120);
    if (fp.length < 10 || seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });
}

function sanitizeExtractedReviewText(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';

  const noReviewPatterns = [
    /be\s+(the\s+)?first\s+one\s+to\s+review/i,
    /be\s+the\s+first\s+to\s+review/i,
    /no\s+reviews?\s+(yet|available|found)/i,
    /write\s+(a\s+)?review/i,
    /start\s+the\s+conversation/i,
  ];

  if (noReviewPatterns.some((pattern) => pattern.test(rawText))) {
    return '';
  }

  let text = rawText
    .replace(/\bverified\s+purchase\b/gi, ' ')
    .replace(/\bcertified\s+buyer\b/gi, ' ')
    .replace(/\b\d+\s*(day|days|month|months|year|years)\s+ago\b/gi, ' ')
    .replace(/\bbought\b[^.]{0,120}?\bago\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*out\s+of\s*\d+\s*stars?\b/gi, ' ')
    .replace(/\breviewed\s+in\s+[A-Za-z]+(?:\s+on\s+[A-Za-z]+\s+\d{1,2},?\s*\d{2,4})?/gi, ' ')
    .replace(/\b\d+\s+(?:people|person|customer)s?\s+found\s+this\s+(?:helpful|useful)\b/gi, ' ')
    .replace(/\b\d[\d,]*\s+(?:global\s+)?(?:customer\s+)?(?:ratings?|reviews?)(?:\s+and\s+\d[\d,]*\s+(?:ratings?|reviews?))?\b/gi, ' ')
    .replace(/\bshowing\s+\d+[\-–]\d+\s+of\s+\d+\b/gi, ' ')
    .replace(/\ball\s+\d[\d,]*\s+reviews?\b/gi, ' ')
    .replace(/\bHelpful\b/g, ' ')
    .replace(/\bReport\b(?=[.\s]|$)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (noReviewPatterns.some((pattern) => pattern.test(text))) {
    return '';
  }

  return text;
}

// ── HTTP fetch with retry ─────────────────────────────────────────────────────

async function fetchPageHtml(url, retries = CONFIG.MAX_RETRIES, cookies = '') {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = {
        'User-Agent': nextUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
      };
      // Forward browser cookies so Amazon/Flipkart treat the request as authenticated
      if (cookies) headers['Cookie'] = cookies;

      const resp = await axios.get(url, {
        timeout: CONFIG.REQUEST_TIMEOUT_MS,
        headers,
        maxRedirects: 5,
        validateStatus: (s) => s < 500,
      });

      if (resp.status === 200) {
        const html = typeof resp.data === 'string' ? resp.data : String(resp.data);
        if (isBotBlocked(html)) {
          console.warn(`[ReviewScraper] Bot-blocked on attempt ${attempt + 1}: ${url.substring(0, 80)}…`);
          if (attempt < retries) { await sleep(CONFIG.RETRY_DELAY_MS * (attempt + 1)); continue; }
          return null;
        }
        return html;
      }

      if (resp.status === 429) {
        console.warn(`[ReviewScraper] Rate-limited (429) — backing off`);
        await sleep(4000 * (attempt + 1));
        continue;
      }

      console.warn(`[ReviewScraper] HTTP ${resp.status} for ${url.substring(0, 80)}`);
      return null;
    } catch (err) {
      console.warn(`[ReviewScraper] Fetch error attempt ${attempt + 1}: ${err.message}`);
      if (attempt < retries) await sleep(CONFIG.RETRY_DELAY_MS * (attempt + 1));
    }
  }
  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  AMAZON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function parseAmazonReviewPage(html) {
  const $ = cheerio.load(html);
  const reviews = [];

  $('[data-hook="review"]').each((_i, el) => {
    try {
      const $r = $(el);

      // ── Body text ────────────────────────────────────────────────
      let text = $r.find('[data-hook="review-body"] span').first().text().trim();
      if (!text) text = $r.find('[data-hook="review-body"]').text().trim();
      if (!text) text = $r.find('.review-text-content span').first().text().trim();

      // ── Title (skip "X out of 5 stars" spans) ────────────────────
      let title = '';
      $r.find('[data-hook="review-title"] span').each((_j, span) => {
        const t = $(span).text().trim();
        if (t && !/\d+(\.\d+)?\s*out of\s*\d+\s*stars?/i.test(t)) title = t;
      });

      if (text.length < 15 && title.length > 2) {
        text = title + (text ? '. ' + text : '');
      }
      text = sanitizeExtractedReviewText(text);
      if (!text || text.length < 5) return;

      // ── Rating ───────────────────────────────────────────────────
      let rating = 0;
      const alt =
        $r.find('[data-hook="review-star-rating"] .a-icon-alt').first().text() ||
        $r.find('[data-hook="cmps-review-star-rating"] .a-icon-alt').first().text() ||
        $r.find('.a-icon-star .a-icon-alt').first().text();
      const rm = alt.match(/(\d+(\.\d+)?)/);
      if (rm) rating = Math.max(1, Math.min(5, parseFloat(rm[1])));
      if (!rating) rating = 3;

      // ── Author + Date ────────────────────────────────────────────
      const author = $r.find('.a-profile-name').first().text().trim() || 'Amazon Customer';
      const date = $r.find('[data-hook="review-date"]').text().trim();

      reviews.push({ text, rating, author, title, date, platform: 'amazon' });
    } catch (_e) { /* skip malformed review */ }
  });

  return reviews;
}

function parseAmazonTotalCount(html) {
  const $ = cheerio.load(html);

  // Method 1: dedicated count element
  for (const sel of [
    '[data-hook="cr-filter-info-review-rating-count"]',
    '[data-hook="total-review-count"]',
    '#filter-info-section span[data-hook]',
  ]) {
    const text = $(sel).text();
    const m =
      text.match(/of\s+(\d[\d,]*)/i) ||
      text.match(/(\d[\d,]*)\s*(?:total\s*)?(?:global\s*)?(?:customer\s*)?(?:ratings?|reviews?)/i);
    if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  }

  // Method 2: broader text search
  const body = $('body').text();
  const m =
    body.match(/(\d[\d,]*)\s+(?:global\s+)?(?:customer\s+)?reviews?/i) ||
    body.match(/of\s+(\d[\d,]*)\s+reviews?/i);
  if (m) return parseInt(m[1].replace(/,/g, ''), 10);

  return 0;
}

/**
 * Scrape Amazon product reviews server-side.
 *
 * @param {string} productUrl   Any Amazon URL containing the ASIN
 * @param {number} [maxPages]   Maximum pages to fetch (default 100 → 1 000 reviews)
 * @returns {Promise<{reviews: Array, totalFound: number, pagesScraped: number}>}
 */
async function scrapeAmazonReviews(productUrl, maxPages = CONFIG.MAX_PAGES_DEFAULT, cookies = '') {
  const asin = extractAsinFromUrl(productUrl);
  if (!asin) {
    console.warn('[ReviewScraper] Cannot extract ASIN from:', productUrl);
    return { reviews: [], totalFound: 0, pagesScraped: 0 };
  }

  const origin = getOrigin(productUrl);
  const base = `${origin}/product-reviews/${asin}`;

  console.log(`[ReviewScraper] 🔍 Amazon scrape — ASIN=${asin} origin=${origin} cookies=${cookies ? 'yes' : 'no'}`);

  // ── Page 1: discover total count + first batch of reviews ─────────────────
  const page1Url = `${base}?ie=UTF8&reviewerType=all_reviews&pageNumber=1`;
  const page1Html = await fetchPageHtml(page1Url, CONFIG.MAX_RETRIES, cookies);

  if (!page1Html) {
    console.warn('[ReviewScraper] Page 1 fetch failed — cannot scrape');
    return { reviews: [], totalFound: 0, pagesScraped: 0 };
  }

  const allReviews = parseAmazonReviewPage(page1Html);
  const totalFound = parseAmazonTotalCount(page1Html);

  console.log(`[ReviewScraper] Page 1: ${allReviews.length} reviews | total on site: ${totalFound || '?'}`);

  // If total is tiny, no need to paginate
  if (totalFound > 0 && totalFound <= 10) {
    return { reviews: allReviews, totalFound, pagesScraped: 1 };
  }

  // ── Determine how many pages to fetch ─────────────────────────────────────
  const totalPages = totalFound > 0
    ? Math.min(Math.ceil(totalFound / 10), maxPages)
    : maxPages;

  console.log(`[ReviewScraper] Fetching pages 2–${totalPages} (batches of ${CONFIG.CONCURRENCY})…`);

  // ── Fetch remaining pages in concurrent batches ───────────────────────────
  let consecutiveBatchFailures = 0;
  let pagesAttempted = 1;

  for (let batchStart = 2; batchStart <= totalPages; batchStart += CONFIG.CONCURRENCY) {
    const batchEnd = Math.min(batchStart + CONFIG.CONCURRENCY - 1, totalPages);
    const pageNums = Array.from({ length: batchEnd - batchStart + 1 }, (_, i) => batchStart + i);

    const batchResults = await Promise.all(
      pageNums.map(async (pageNum) => {
        const url = `${base}?ie=UTF8&reviewerType=all_reviews&pageNumber=${pageNum}`;
        const html = await fetchPageHtml(url, 1, cookies); // 1 retry in batch context
        return html ? parseAmazonReviewPage(html) : [];
      })
    );

    let batchReviews = 0;
    let batchEmpty = 0;
    for (const pageReviews of batchResults) {
      pagesAttempted++;
      if (pageReviews.length > 0) {
        allReviews.push(...pageReviews);
        batchReviews += pageReviews.length;
      } else {
        batchEmpty++;
      }
    }

    if (batchReviews > 0 || batchEmpty < pageNums.length) {
      // At least one page in the batch succeeded
      consecutiveBatchFailures = 0;
    } else {
      consecutiveBatchFailures++;
    }

    // Log progress every few batches
    if (batchStart % (CONFIG.CONCURRENCY * 5) === 2 || batchEnd === totalPages) {
      console.log(
        `[ReviewScraper] Progress: pages ${batchStart}–${batchEnd} → +${batchReviews} reviews ` +
        `(${batchEmpty} failed) | total so far: ${allReviews.length}`
      );
    }

    if (consecutiveBatchFailures >= CONFIG.MAX_CONSECUTIVE_BATCH_FAILURES) {
      console.warn(`[ReviewScraper] ${consecutiveBatchFailures} consecutive batch failures — stopping`);
      break;
    }

    // Inter-batch delay with jitter
    if (batchEnd < totalPages) {
      await sleep(CONFIG.BATCH_DELAY_MS + Math.floor(Math.random() * CONFIG.BATCH_JITTER_MS));
    }
  }

  // ── Deduplicate ───────────────────────────────────────────────────────────
  let unique = dedupeReviews(allReviews);

  const pagesScraped = Math.min(pagesAttempted, totalPages);

  const targetPages = Math.max(
    CONFIG.AMAZON_MIN_TARGET_PAGES,
    Math.min(CONFIG.AMAZON_MAX_TARGET_PAGES, maxPages)
  );

  // If HTTP scraping was blocked/thin, use real browser fallback to hit 3–5 pages.
  if (pagesScraped < targetPages || unique.length < 20) {
    console.log(
      `[ReviewScraper] Amazon HTTP scrape thin (${unique.length} reviews, ${pagesScraped} pages). ` +
      `Trying browser fallback up to ${targetPages} pages…`
    );
    const browserFallback = await scrapeAmazonReviewsWithBrowser(productUrl, targetPages, cookies);
    if (browserFallback.reviews.length > unique.length) {
      unique = dedupeReviews(browserFallback.reviews);
      console.log(
        `[ReviewScraper] Amazon browser fallback improved results: ${unique.length} reviews ` +
        `(${browserFallback.pagesScraped} pages)`
      );
      return {
        reviews: unique,
        totalFound: Math.max(totalFound || 0, browserFallback.totalFound || unique.length),
        pagesScraped: Math.max(pagesScraped, browserFallback.pagesScraped || 0),
      };
    }
  }

  console.log(
    `[ReviewScraper] ✅ Amazon done: ${unique.length} unique reviews from ${pagesScraped} pages ` +
    `(${totalFound || '?'} total on site)`
  );

  return { reviews: unique, totalFound, pagesScraped };
}

async function scrapeAmazonReviewsWithBrowser(productUrl, maxPages = 5, cookies = '') {
  const asin = extractAsinFromUrl(productUrl);
  if (!asin) return { reviews: [], totalFound: 0, pagesScraped: 0 };

  const origin = getOrigin(productUrl);
  const base = `${origin}/product-reviews/${asin}`;
  const host = new URL(origin).hostname;

  return withBrowser(async (browser) => {
    let page = null;
    try {
      page = await browser.newPage();
      await page.setViewport({ width: 1366, height: 768 });
      await page.setUserAgent(nextUA());
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
      });

      const parsedCookies = parseCookieHeader(cookies).map((c) => ({
        ...c,
        domain: host,
        path: '/',
      }));
      if (parsedCookies.length > 0) {
        await page.setCookie(...parsedCookies).catch(() => {});
      }

      const allReviews = [];
      let totalFound = 0;
      let pagesScraped = 0;
      let consecutiveEmpty = 0;

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const url = `${base}?ie=UTF8&reviewerType=all_reviews&pageNumber=${pageNum}&sortBy=recent`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        const html = await page.content();

        if (isBotBlocked(html)) {
          console.warn(`[ReviewScraper] Browser fallback page ${pageNum} appears bot-blocked`);
          consecutiveEmpty++;
          if (consecutiveEmpty >= 2) break;
          continue;
        }

        const pageReviews = parseAmazonReviewPage(html);
        if (pageNum === 1) {
          totalFound = parseAmazonTotalCount(html);
        }

        if (pageReviews.length === 0) {
          consecutiveEmpty++;
          if (consecutiveEmpty >= 2) break;
        } else {
          consecutiveEmpty = 0;
          pagesScraped++;
          allReviews.push(...pageReviews);
        }

        await sleep(700);
      }

      return {
        reviews: dedupeReviews(allReviews),
        totalFound: totalFound || allReviews.length,
        pagesScraped,
      };
    } catch (err) {
      console.warn(`[ReviewScraper] Browser fallback failed: ${err.message}`);
      return { reviews: [], totalFound: 0, pagesScraped: 0 };
    } finally {
      if (page) await page.close().catch(() => {});
    }
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  FLIPKART
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function extractFlipkartInfo(url) {
  if (!url) return null;
  const m = url.match(/flipkart\.com\/([^?#]+?)\/p\/(itm[a-z0-9]+)/i);
  if (!m) return null;
  let pid = '';
  try { pid = new URL(url).searchParams.get('pid') || ''; } catch { /* ignore */ }
  return { slug: m[1], itemId: m[2], pid };
}

function parseFlipkartReviewPage(html) {
  const $ = cheerio.load(html);
  const reviews = [];
  const processedTexts = new Set();

  function _addReview(text, rating) {
    if (!text || text.length < 10) return;
    text = sanitizeExtractedReviewText(text);
    if (text.length < 10) return;
    const fp = text.substring(0, 120).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (fp.length < 10 || processedTexts.has(fp)) return;
    processedTexts.add(fp);
    reviews.push({
      text,
      rating: rating || 3,
      author: 'Flipkart User',
      title: '',
      date: '',
      platform: 'flipkart',
    });
  }

  // Strategy 1: Rating-pill anchor (single digit 1-5) → walk up to card
  $('div').each((_i, el) => {
    const $el = $(el);
    const txt = $el.text().trim();
    if (!/^[1-5]$/.test(txt) || $el.children().length > 1) return;

    const rating = parseInt(txt, 10);
    let $card = $el.parent();
    for (let i = 0; i < 6; i++) {
      if ($card.text().length > 100) break;
      $card = $card.parent();
    }
    if (!$card.length || $card.text().length < 30) return;

    let reviewText = '';
    $card.find('p, div').each((_j, child) => {
      const t = $(child).text().trim();
      if (
        t.length > reviewText.length &&
        t.length > 20 &&
        t.length < 5000 &&
        !/^\d+\s+(month|year|day|week)/i.test(t)
      ) {
        reviewText = t;
      }
    });
    _addReview(reviewText, rating);
  });

  // Strategy 2: itemprop / semantic selectors (works on Flipkart SSR pages)
  if (reviews.length === 0) {
    $('[itemprop="reviewBody"], [class*="reviewBody"], [class*="review-body"]').each((_i, el) => {
      const text = $(el).text().trim();
      let rating = 3;
      // Look for rating in parent/sibling
      const $parent = $(el).closest('[itemprop="review"], [class*="review-card"], [class*="ReviewCard"]');
      const rEl = $parent.find('[itemprop="ratingValue"], [class*="rating"]').first();
      if (rEl.length) {
        const m = rEl.text().trim().match(/^([1-5])/);
        if (m) rating = parseInt(m[1], 10);
      }
      _addReview(text, rating);
    });
  }

  // Strategy 3: Any element whose class contains "review" with substantial text
  if (reviews.length === 0) {
    const cards = $('[class*="review"],[class*="Review"],[class*="UserReview"],[class*="user-review"]');
    const seenEls = new Set();
    cards.each((_i, el) => {
      if (seenEls.has(el)) return;
      seenEls.add(el);
      const text = $(el).text().trim();
      if (text.length > 30 && text.length < 5000) {
        // Avoid double-counting parent containers
        let p = $(el).parent();
        for (let i = 0; i < 3 && p.length; i++) { seenEls.add(p[0]); p = p.parent(); }
        _addReview(text, 3);
      }
    });
  }

  return reviews;
}

/**
 * Scrape Flipkart product reviews server-side.
 */
async function scrapeFlipkartReviews(productUrl, maxPages = CONFIG.MAX_PAGES_DEFAULT, cookies = '') {
  const info = extractFlipkartInfo(productUrl);
  if (!info) {
    console.warn('[ReviewScraper] Cannot extract Flipkart info from:', productUrl);
    return { reviews: [], totalFound: 0, pagesScraped: 0 };
  }

  const pidParam = info.pid ? `&pid=${encodeURIComponent(info.pid)}` : '';
  const base = `https://www.flipkart.com/${info.slug}/product-reviews/${info.itemId}`;

  console.log(`[ReviewScraper] 🔍 Flipkart scrape — item=${info.itemId} cookies=${cookies ? 'yes' : 'no'}`);

  const allReviews = [];
  let consecutiveEmpty = 0;
  let consecutiveFailures = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = `${base}?page=${page}${pidParam}`;
    const html = await fetchPageHtml(url, 1, cookies);

    if (!html) {
      consecutiveFailures++;
      if (consecutiveFailures >= 5) break;
      continue;
    }
    consecutiveFailures = 0;

    const pageReviews = parseFlipkartReviewPage(html);

    if (pageReviews.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 2) break;
    } else {
      consecutiveEmpty = 0;
      allReviews.push(...pageReviews);
    }

    if (page < maxPages) await sleep(CONFIG.BATCH_DELAY_MS);
  }

  // Dedup
  let unique = dedupeReviews(allReviews);

  const pagesScraped = Math.ceil(unique.length / 10) || 1;
  const targetPages = Math.max(3, Math.min(5, maxPages));

  // If HTTP scraping was blocked/thin, use browser fallback (like Amazon)
  if (pagesScraped < targetPages || unique.length < 15) {
    console.log(
      `[ReviewScraper] Flipkart HTTP scrape thin (${unique.length} reviews, ${pagesScraped} pages). ` +
      `Trying browser fallback up to ${targetPages} pages…`
    );
    const browserFallback = await scrapeFlipkartReviewsWithBrowser(productUrl, targetPages, cookies);
    if (browserFallback.reviews.length > unique.length) {
      unique = dedupeReviews(browserFallback.reviews);
      console.log(
        `[ReviewScraper] Flipkart browser fallback improved results: ${unique.length} reviews ` +
        `(${browserFallback.pagesScraped} pages)`
      );
      return {
        reviews: unique,
        totalFound: Math.max(unique.length, browserFallback.totalFound || unique.length),
        pagesScraped: Math.max(pagesScraped, browserFallback.pagesScraped || 0),
      };
    }
  }

  console.log(`[ReviewScraper] ✅ Flipkart done: ${unique.length} unique reviews`);
  return {
    reviews: unique,
    totalFound: unique.length,
    pagesScraped,
  };
}

/**
 * Browser-based Flipkart review scraper (fallback when HTTP is blocked).
 * Uses the shared browser pool. Dismisses login popups by text, not class name.
 */
async function scrapeFlipkartReviewsWithBrowser(productUrl, maxPages = 5, cookies = '') {
  const info = extractFlipkartInfo(productUrl);
  if (!info) return { reviews: [], totalFound: 0, pagesScraped: 0 };

  const pidParam = info.pid ? `&pid=${encodeURIComponent(info.pid)}` : '';
  const base = `https://www.flipkart.com/${info.slug}/product-reviews/${info.itemId}`;

  return withBrowser(async (browser) => {
    let page = null;
    try {
      page = await browser.newPage();
      await page.setViewport({ width: 1366, height: 768 });
      await page.setUserAgent(nextUA());
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-IN,en;q=0.9' });

      const parsedCookies = parseCookieHeader(cookies).map((c) => ({
        ...c,
        domain: '.flipkart.com',
        path: '/',
      }));
      if (parsedCookies.length > 0) {
        await page.setCookie(...parsedCookies).catch(() => {});
      }

      const allReviews = [];
      let pagesScraped = 0;
      let consecutiveEmpty = 0;

      for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const url = `${base}?page=${pageNum}${pidParam}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});

        // Dismiss Flipkart login popup by text (not fragile class names)
        await page.evaluate(() => {
          for (const btn of document.querySelectorAll('button, [role="button"], span')) {
            const txt = (btn.innerText || btn.getAttribute('aria-label') || '').trim();
            if (/^[✕×✖]$/.test(txt) || txt.toLowerCase() === 'close' || txt === '✕') {
              btn.click(); return;
            }
          }
        }).catch(() => {});

        await sleep(500);
        const html = await page.content();

        if (isBotBlocked(html)) {
          console.warn(`[ReviewScraper] Flipkart browser page ${pageNum} bot-blocked`);
          consecutiveEmpty++;
          if (consecutiveEmpty >= 2) break;
          continue;
        }

        const pageReviews = parseFlipkartReviewPage(html);
        if (pageReviews.length === 0) {
          consecutiveEmpty++;
          if (consecutiveEmpty >= 2) break;
        } else {
          consecutiveEmpty = 0;
          pagesScraped++;
          allReviews.push(...pageReviews);
        }

        await sleep(700);
      }

      return {
        reviews: dedupeReviews(allReviews),
        totalFound: allReviews.length,
        pagesScraped,
      };
    } catch (err) {
      console.warn(`[ReviewScraper] Flipkart browser fallback failed: ${err.message}`);
      return { reviews: [], totalFound: 0, pagesScraped: 0 };
    } finally {
      if (page) await page.close().catch(() => {});
    }
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  RELIANCE DIGITAL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Extract the numeric SKU from a Reliance Digital product URL.
 * URL pattern: https://www.reliancedigital.in/<name>/p/<SKU>
 * @param {string} url
 * @returns {string|null}
 */
function extractRelianceSku(url) {
  if (!url) return null;
  const m = url.match(/\/p\/(\d{6,15})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

/**
 * Scrape Reliance Digital product reviews using their internal JSON API.
 *
 * Reliance Digital exposes a paginated review API — no HTML parsing, no
 * CAPTCHA, no Puppeteer required. Each page returns up to PAGE_SIZE reviews.
 *
 * Endpoint:
 *   GET https://www.reliancedigital.in/rildigitalws/v2/rrldigital/cms/pagedata
 *       ?pageName=pdp&format=json&productCode={SKU}&currentPage={N}&pageSize={SIZE}
 *
 * @param {string} productUrl
 * @param {number} [maxPages]
 * @returns {Promise<{reviews: Array, totalFound: number, pagesScraped: number}>}
 */
async function scrapeRelianceReviews(productUrl, maxPages = CONFIG.MAX_PAGES_DEFAULT) {
  const sku = extractRelianceSku(productUrl);
  if (!sku) {
    console.warn('[ReviewScraper] Cannot extract SKU from Reliance Digital URL:', productUrl);
    return { reviews: [], totalFound: 0, pagesScraped: 0 };
  }

  const PAGE_SIZE = 20;
  const API_BASE = 'https://www.reliancedigital.in/rildigitalws/v2/rrldigital/cms/pagedata';
  const allReviews = [];
  let totalFound = 0;
  let pagesScraped = 0;
  let consecutiveEmpty = 0;

  console.log(`[ReviewScraper] 🔍 Reliance Digital JSON API — SKU=${sku}`);

  for (let page = 0; page < maxPages; page++) {
    const url = `${API_BASE}?pageName=pdp&format=json&productCode=${sku}&currentPage=${page}&pageSize=${PAGE_SIZE}`;

    let json;
    try {
      const resp = await axios.get(url, {
        timeout: CONFIG.REQUEST_TIMEOUT_MS,
        headers: {
          'User-Agent': nextUA(),
          'Accept': 'application/json',
          'Accept-Language': 'en-IN,en;q=0.9',
          'Referer': productUrl,
        },
        validateStatus: (s) => s < 500,
      });

      if (resp.status !== 200) {
        console.warn(`[ReviewScraper] Reliance API HTTP ${resp.status} on page ${page}`);
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) break;
        continue;
      }

      json = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
    } catch (err) {
      console.warn(`[ReviewScraper] Reliance API fetch error page ${page}: ${err.message}`);
      consecutiveEmpty++;
      if (consecutiveEmpty >= 3) break;
      continue;
    }

    // Navigate the JSON to reviews. API paths vary across product types.
    const reviewsRaw =
      json?.pageData?.ratingAndReviews?.reviews ||
      json?.pageData?.ratingsReviews?.reviews ||
      json?.pageData?.reviews ||
      json?.ratingsAndReviews?.reviews ||
      json?.ratingsAndReviews ||
      json?.reviews ||
      json?.data?.reviews ||
      [];

    if (page === 0) {
      totalFound =
        json?.pageData?.ratingAndReviews?.totalCount ||
        json?.pageData?.ratingsReviews?.totalCount ||
        json?.pageData?.ratingAndReviews?.totalReviews ||
        json?.totalCount ||
        json?.total ||
        json?.data?.totalCount ||
        0;
      console.log(`[ReviewScraper] Reliance Digital total reviews: ${totalFound || '?'}`);
    }

    if (!Array.isArray(reviewsRaw) || reviewsRaw.length === 0) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 2) break;
      continue;
    }

    consecutiveEmpty = 0;
    pagesScraped++;

    for (const r of reviewsRaw) {
      const text = sanitizeExtractedReviewText((
        r.reviewDescription || r.comments || r.review || r.body || r.content || ''
      ).trim());
      if (!text || text.length < 5) continue;

      const rating = Math.max(1, Math.min(5, parseFloat(r.rating || r.overallRating || r.starRating || 3) || 3));
      const author = r.nickname || r.authorName || r.name || 'Reliance Customer';
      const title  = r.headline || r.title || r.subject || '';
      const date   = r.submissionTime || r.createdDate || r.date || '';

      allReviews.push({ text, rating, author, title, date, platform: 'reliancedigital' });
    }

    console.log(`[ReviewScraper] Reliance page ${page}: +${reviewsRaw.length} reviews (total so far: ${allReviews.length})`);

    if (totalFound > 0 && allReviews.length >= totalFound) break;
    await sleep(800);
  }

  // Deduplicate
  const seen = new Set();
  const unique = allReviews.filter((r) => {
    const fp = r.text.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 120);
    if (fp.length < 10 || seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });

  console.log(`[ReviewScraper] ✅ Reliance Digital done: ${unique.length} unique reviews from ${pagesScraped} pages`);
  return {
    reviews: unique,
    totalFound: totalFound || unique.length,
    pagesScraped,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  PUBLIC API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function detectPlatformFromUrl(url) {
  if (!url) return 'unknown';
  const lc = url.toLowerCase();
  if (lc.includes('amazon.')) return 'amazon';
  if (lc.includes('flipkart.com')) return 'flipkart';
  if (lc.includes('reliancedigital.in')) return 'reliancedigital';
  return 'unknown';
}

/**
 * Scrape reviews for any supported platform.
 *
 * @param {string} productUrl  Product or review-page URL
 * @param {string} [platform]  'amazon' | 'flipkart' (auto-detected if omitted)
 * @param {number} [maxPages]  Override max pages (default 100)
 * @returns {Promise<{reviews: Array, totalFound: number, pagesScraped: number}>}
 */
async function scrapeReviews(productUrl, platform, maxPages, cookies) {
  const p = platform || detectPlatformFromUrl(productUrl);
  const mp = maxPages || CONFIG.MAX_PAGES_DEFAULT;

  let scrapeId = null;
  if (p === 'amazon') scrapeId = extractAsinFromUrl(productUrl);
  else if (p === 'flipkart') scrapeId = extractFlipkartInfo(productUrl)?.itemId || null;
  else if (p === 'reliancedigital') scrapeId = extractRelianceSku(productUrl);

  const scrapeCacheKey = scrapeId ? `reviewscrape:${p}:${scrapeId}:${mp}` : null;
  if (scrapeCacheKey) {
    const cached = cacheService.getCache(scrapeCacheKey);
    if (cached && Array.isArray(cached.reviews)) {
      console.log(`[ReviewScraper] Cache hit for ${scrapeCacheKey}`);
      return { ...cached, fromCache: true };
    }
  }

  let result;

  switch (p) {
    case 'amazon':
      result = await scrapeAmazonReviews(productUrl, mp, cookies);
      break;
    case 'flipkart':
      result = await scrapeFlipkartReviews(productUrl, mp, cookies);
      break;
    case 'reliancedigital':
      result = await scrapeRelianceReviews(productUrl, mp);
      break;
    default:
      console.log(`[ReviewScraper] Server-side scraping not available for: ${p}`);
      result = { reviews: [], totalFound: 0, pagesScraped: 0 };
  }

  if (scrapeCacheKey && result?.reviews?.length > 0) {
    cacheService.setCache(scrapeCacheKey, result, CONFIG.REVIEW_SCRAPE_CACHE_TTL_MS);
  }

  return result;
}

module.exports = {
  scrapeReviews,
  scrapeAmazonReviews,
  scrapeFlipkartReviews,
  scrapeRelianceReviews,
  extractAsinFromUrl,
  extractRelianceSku,
};
