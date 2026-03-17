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
  const seen = new Set();
  const unique = allReviews.filter((r) => {
    const fp = r.text.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 120);
    if (fp.length < 10 || seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });

  const pagesScraped = Math.min(pagesAttempted, totalPages);
  console.log(
    `[ReviewScraper] ✅ Amazon done: ${unique.length} unique reviews from ${pagesScraped} pages ` +
    `(${totalFound || '?'} total on site)`
  );

  return { reviews: unique, totalFound, pagesScraped };
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

  // Flipkart uses obfuscated classes — use rating-pill (single digit 1-5) as anchor
  $('div').each((_i, el) => {
    const $el = $(el);
    const txt = $el.text().trim();
    // Rating pills are divs containing just a single digit 1-5 and no child elements
    if (!/^[1-5]$/.test(txt) || $el.children().length > 1) return;

    const rating = parseInt(txt, 10);

    // Walk up to find the review card container
    let $card = $el.parent();
    for (let i = 0; i < 6; i++) {
      if ($card.text().length > 100) break;
      $card = $card.parent();
    }
    if (!$card.length || $card.text().length < 30) return;

    // Find the longest text block that looks like a review body
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

    if (!reviewText || reviewText.length < 10) return;

    // Avoid duplicate text
    const fp = reviewText.substring(0, 120).toLowerCase();
    if (processedTexts.has(fp)) return;
    processedTexts.add(fp);

    reviews.push({
      text: reviewText,
      rating,
      author: 'Flipkart User',
      title: '',
      date: '',
      platform: 'flipkart',
    });
  });

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
  const seen = new Set();
  const unique = allReviews.filter((r) => {
    const fp = r.text.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 120);
    if (fp.length < 10 || seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });

  console.log(`[ReviewScraper] ✅ Flipkart done: ${unique.length} unique reviews`);
  return {
    reviews: unique,
    totalFound: unique.length,
    pagesScraped: Math.ceil(unique.length / 10) || 1,
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

  switch (p) {
    case 'amazon':
      return scrapeAmazonReviews(productUrl, mp, cookies);
    case 'flipkart':
      return scrapeFlipkartReviews(productUrl, mp, cookies);
    default:
      console.log(`[ReviewScraper] Server-side scraping not available for: ${p}`);
      return { reviews: [], totalFound: 0, pagesScraped: 0 };
  }
}

module.exports = {
  scrapeReviews,
  scrapeAmazonReviews,
  scrapeFlipkartReviews,
  extractAsinFromUrl,
};
