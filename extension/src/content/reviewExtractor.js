/**
 * Review Extractor for E-commerce Platforms
 * ==========================================
 * Extracts ALL real customer reviews from product pages with full pagination support.
 *
 * Platforms: Amazon (.in/.com/.co.uk), Flipkart, Reliance Digital
 *
 * Key design decisions:
 *   - Multiple fallback selectors per platform (sites change DOM frequently)
 *   - Auto-scroll to the review section to trigger lazy-loaded content
 *   - Deduplication via text fingerprint before returning
 *   - Never rejects — always resolves (empty array = "no reviews")
 *   - No character length limits — ALL reviews are included regardless of length
 *   - Full pagination: navigates through ALL review pages on every platform
 *   - Progress reporting via callback for UI feedback
 */

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Text fingerprint for deduplication. Uses prefix + length + tail to minimise false positives. */
const fingerprint = (t) => {
  const norm = (t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (norm.length < 10) return norm;
  return norm.slice(0, 160) + ':' + norm.length + ':' + norm.slice(-40);
};

/** Clamp a rating to 1–5. */
const clampRating = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : Math.max(1, Math.min(5, n));
};

/** Safe innerText that never throws. */
const safeText = (el) => {
  try {
    return el?.innerText?.trim() || '';
  } catch {
    return '';
  }
};

/** Query first match across multiple selectors. */
const qsFirst = (root, selectors) => {
  for (const s of selectors) {
    try {
      const el = root.querySelector(s);
      if (el) return el;
    } catch { /* invalid selector — skip */ }
  }
  return null;
};

/** Query ALL matches across multiple selectors (deduped by element identity). */
const qsAll = (root, selectors) => {
  const seen = new Set();
  const results = [];
  for (const s of selectors) {
    try {
      root.querySelectorAll(s).forEach((el) => {
        if (!seen.has(el)) {
          seen.add(el);
          results.push(el);
        }
      });
    } catch { /* invalid selector — skip */ }
  }
  return results;
};

/** Sleep helper. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Scroll an element (or the review section) into view and wait for lazy content.
 * Returns after the element is visible or the timeout expires.
 */
async function scrollToReviews(selectors, timeoutMs = 3000) {
  for (const s of selectors) {
    try {
      const el = document.querySelector(s);
      if (el) {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        await sleep(Math.min(timeoutMs, 1500));
        return true;
      }
    } catch { /* skip */ }
  }
  // Fallback: scroll down a large chunk hoping reviews load
  window.scrollBy(0, window.innerHeight * 3);
  await sleep(1000);
  return false;
}

/**
 * Progressively scroll through the entire page to trigger ALL lazy-loaded content.
 * Essential for platforms that only load reviews as you scroll near them.
 */
async function scrollFullPage(stepPx = 800, delayMs = 300) {
  const maxScrolls = Math.ceil(document.body.scrollHeight / stepPx) + 5;
  let lastHeight = document.body.scrollHeight;
  let stableCount = 0;

  for (let i = 0; i < maxScrolls && stableCount < 3; i++) {
    window.scrollBy(0, stepPx);
    await sleep(delayMs);
    const newHeight = document.body.scrollHeight;
    if (newHeight === lastHeight) {
      stableCount++;
    } else {
      stableCount = 0;
      lastHeight = newHeight;
    }
  }
  window.scrollTo(0, 0);
  await sleep(300);
}

/**
 * Detect if a fetched HTML page is a bot/CAPTCHA block rather than real content.
 * Amazon, Flipkart, and Reliance Digital return HTTP 200 with a challenge page when
 * they detect extension-origin or suspicious requests — this looks like a successful
 * fetch but contains no review data.
 *
 * @param {string} html
 * @returns {boolean} true = blocked / empty / CAPTCHA page
 */
function isBotBlockedPage(html) {
  if (!html || html.length < 2000) return true; // Suspiciously tiny
  const lc = html.toLowerCase();
  // Amazon CAPTCHA / bot check
  if (lc.includes('validatecaptcha')) return true;
  if (lc.includes('type the characters you see')) return true;
  if (lc.includes('sorry, we just need to make sure you')) return true;
  if (lc.includes('/errors/validatecaptcha')) return true;
  // Cloudflare / generic challenge
  if (lc.includes('checking your browser') && lc.includes('cloudflare')) return true;
  if (lc.includes('access denied') && html.length < 8000) return true;
  // Flipkart bot block
  if (lc.includes('you have been blocked') || lc.includes('403 forbidden')) return true;
  return false;
}

/**
 * Fetch a page's HTML with two-strategy approach:
 *   Strategy 1 — direct content-script fetch (fast, works on many sites).
 *   Strategy 2 — delegate to background service worker which runs the fetch
 *                inside the page's MAIN world via chrome.scripting.executeScript,
 *                bypassing extension-origin bot detection (Amazon, Flipkart, etc.).
 *
 * @param {string} url
 * @returns {Promise<string|null>} HTML string, or null on total failure
 */
async function fetchPage(url) {
  const FETCH_TIMEOUT_MS = 8000; // 8-second timeout per strategy

  // Strategy 1: Direct fetch from content script (with timeout)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const resp = await fetch(url, {
      credentials: 'include',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (resp.ok) {
      const html = await resp.text();
      if (!isBotBlockedPage(html)) return html;
      console.warn('[fetchPage] Direct fetch returned bot/CAPTCHA page — trying MAIN-world fetch');
    } else {
      console.warn(`[fetchPage] Direct fetch HTTP ${resp.status} for ${url.substring(0, 80)}`);
    }
  } catch (e) {
    console.warn('[fetchPage] Direct fetch failed:', e.message);
  }

  // Strategy 2: Background MAIN-world fetch with timeout
  try {
    const result = await Promise.race([
      chrome.runtime.sendMessage({ action: 'FETCH_PAGE', url }),
      new Promise((resolve) => setTimeout(() => resolve({ error: 'timeout' }), FETCH_TIMEOUT_MS)),
    ]);
    if (result?.html && !isBotBlockedPage(result.html)) return result.html;
    if (result?.html) console.warn('[fetchPage] MAIN-world fetch also returned bot/CAPTCHA page');
    if (result?.error) console.warn('[fetchPage] Background fetch error:', result.error);
  } catch (e) {
    console.warn('[fetchPage] Background fetch also failed:', e.message);
  }

  return null;
}

// ─── Amazon ──────────────────────────────────────────────────────────────────

const AMAZON_REVIEW_SECTION = [
  '#reviews-medley-footer',
  '#customerReviews',
  '#reviewsMedley',
  '[data-hook="reviews-medley"]',
  '#cr-dp-DesktopReviewsSection',
  '#customer-reviews-content',
  '#cm-cr-dp-review-list',
];

const AMAZON_REVIEW_CONTAINERS = [
  '[data-hook="review"]',
  '[data-hook="mob-review"]',
  'div[id^="customer_review-"]',
  '#cm-cr-dp-review-list .review',
  '.cr-widget-FocalReviews .review',
  '#reviewsMedley [data-hook="review"]',
  '.review-views .review',
  '.a-section.review.aok-relative',
];

const AMAZON_REVIEW_BODY = [
  '[data-hook="review-body"] span',
  '[data-hook="review-body"]',
  '.review-text-content span',
  '.review-text-content',
  '.review-text span',
  '.review-text',
];

const AMAZON_REVIEW_RATING = [
  '[data-hook="review-star-rating"] span.a-icon-alt',
  '[data-hook="cmps-review-star-rating"] span.a-icon-alt',
  'i[data-hook="review-star-rating"]',
  'i[data-hook="cmps-review-star-rating"]',
  '.a-icon-star .a-icon-alt',
  'span[class*="a-icon-alt"]',
];

const AMAZON_REVIEW_AUTHOR = [
  '.a-profile-name',
  '[data-hook="genome-widget"] .a-profile-name',
  'span.a-profile-name',
];

const AMAZON_REVIEW_TITLE = [
  '[data-hook="review-title"] span:not(.a-icon-alt)',
  '[data-hook="review-title"]',
  '.review-title span',
  '.review-title',
];

const AMAZON_REVIEW_DATE = [
  '[data-hook="review-date"]',
  'span.review-date',
];

function extractAmazonReviews(root = document) {
  const reviews = [];

  const containers = qsAll(root, AMAZON_REVIEW_CONTAINERS);
  console.log(`[ReviewExtractor:Amazon] Found ${containers.length} review containers`);

  for (const container of containers) {
    try {
      const bodyEl = qsFirst(container, AMAZON_REVIEW_BODY);
      let text = safeText(bodyEl);

      const titleEl = qsFirst(container, AMAZON_REVIEW_TITLE);
      let title = safeText(titleEl);
      title = title.replace(/\d+(\.\d+)?\s*out of\s*\d+\s*stars?\s*/i, '').trim();

      // Combine title + body for short reviews — no upper limit on text length
      if (text.length < 15 && title.length > 2) {
        text = title + (text ? '. ' + text : '');
      }
      if (!text || text.length < 5) continue;

      let rating = 0;
      const ratingEl = qsFirst(container, AMAZON_REVIEW_RATING);
      if (ratingEl) {
        const ratingText = ratingEl.getAttribute('data-rating') || safeText(ratingEl);
        const m = ratingText.match(/(\d+(?:\.\d+)?)/);
        if (m) rating = clampRating(m[1]);
      }
      if (!rating) {
        const starIcon = container.querySelector('i.a-icon.a-icon-star, i.a-icon.a-icon-star-mini');
        if (starIcon) {
          const alt = starIcon.querySelector('.a-icon-alt');
          const m = safeText(alt).match(/(\d+(?:\.\d+)?)/);
          if (m) rating = clampRating(m[1]);
        }
      }
      if (!rating) rating = 3;

      const authorEl = qsFirst(container, AMAZON_REVIEW_AUTHOR);
      const author = safeText(authorEl) || 'Amazon Customer';

      const dateEl = qsFirst(container, AMAZON_REVIEW_DATE);
      const dateText = safeText(dateEl);

      reviews.push({ text, rating, author, title, date: dateText, platform: 'amazon' });
    } catch (e) {
      console.warn('[ReviewExtractor:Amazon] Skipped review:', e.message);
    }
  }

  // Fallback: top reviews section blocks
  if (reviews.length === 0) {
    console.log('[ReviewExtractor:Amazon] Trying top-reviews fallback…');
    const topReviewBlocks = root.querySelectorAll(
      '#cm-cr-dp-review-list .a-section.celwidget, ' +
      '.cr-widget-FocalReviews .a-section.celwidget'
    );
    for (const block of topReviewBlocks) {
      const text = safeText(block);
      if (text && text.length > 15) {
        reviews.push({
          text,
          rating: 3,
          author: 'Amazon Customer',
          title: '',
          date: '',
          platform: 'amazon',
        });
      }
    }
  }

  console.log(`[ReviewExtractor:Amazon] Total reviews extracted: ${reviews.length}`);
  return reviews;
}

// ─── Amazon Pagination ───────────────────────────────────────────────────────

/**
 * Extract ASIN (Amazon Standard Identification Number) from a URL.
 * Supports /dp/ASIN, /gp/product/ASIN, /product-reviews/ASIN, /ASIN/ patterns.
 *
 * @param {string} url
 * @returns {string|null}
 */
function extractAsin(url) {
  // Standard patterns: /dp/ASIN, /gp/product/ASIN, /product-reviews/ASIN
  const m = url.match(/\/(?:dp|gp\/product|product-reviews|ASIN)\/([A-Z0-9]{10})/i);
  if (m) return m[1].toUpperCase();

  // Fallback: look for any 10-char alphanumeric segment that looks like an ASIN
  const segments = url.split('/').filter(Boolean);
  for (const seg of segments) {
    if (/^[A-Z0-9]{10}$/i.test(seg) && /[A-Z]/i.test(seg) && /\d/.test(seg)) {
      return seg.toUpperCase();
    }
  }

  return null;
}

/**
 * Fetch ALL reviews from Amazon's paginated all-reviews page.
 *
 * Strategy:
 *   1. If already on /product-reviews/ page, use that URL.
 *   2. Try to find "See all reviews" link in the DOM.
 *   3. Extract ASIN from the current URL and construct the all-reviews URL directly.
 *   4. As last resort, extract ASIN from <link rel="canonical"> or page meta.
 *
 * Fetches page 1 first to determine total review count, then paginates.
 * Deduplication happens in getRealReviews(), so overlap with product-page reviews is fine.
 *
 * @param {number} maxPages  Safety limit (default 50 → up to ~500 reviews)
 * @returns {Promise<Array>} Reviews from ALL pages
 */
async function fetchAmazonPaginatedReviews(maxPages = 50) {
  const allReviews = [];

  try {
    const currentUrl = window.location.href;
    const origin = window.location.origin; // e.g. https://www.amazon.in
    let baseUrl = null;

    // ── Strategy 1: Already on the all-reviews page ──────────────────────────
    if (currentUrl.includes('/product-reviews/')) {
      baseUrl = new URL(currentUrl);
      console.log('[ReviewExtractor:Amazon] Already on all-reviews page');
    }

    // ── Strategy 2: Find "See all reviews" link in DOM ───────────────────────
    if (!baseUrl) {
      const allReviewsLink = document.querySelector(
        'a[data-hook="see-all-reviews-link-foot"], ' +
        '#reviews-medley-footer a[href*="/product-reviews/"], ' +
        '#customerReviews a[href*="/product-reviews/"], ' +
        'a[href*="/product-reviews/"][data-hook]'
      );
      if (allReviewsLink?.href) {
        baseUrl = new URL(allReviewsLink.href, origin);
        console.log('[ReviewExtractor:Amazon] Found all-reviews link in DOM:', baseUrl.toString());
      }
    }

    // ── Strategy 3: Construct URL from ASIN in current page URL ──────────────
    if (!baseUrl) {
      const asin = extractAsin(currentUrl);
      if (asin) {
        baseUrl = new URL(`${origin}/product-reviews/${asin}/ref=cm_cr_dp_d_show_all_btm`);
        console.log(`[ReviewExtractor:Amazon] Constructed URL from ASIN ${asin}`);
      }
    }

    // ── Strategy 4: Extract ASIN from <link rel="canonical"> or og:url ───────
    if (!baseUrl) {
      const canonical = document.querySelector('link[rel="canonical"]')?.href
                     || document.querySelector('meta[property="og:url"]')?.content;
      if (canonical) {
        const asin = extractAsin(canonical);
        if (asin) {
          baseUrl = new URL(`${origin}/product-reviews/${asin}/ref=cm_cr_dp_d_show_all_btm`);
          console.log(`[ReviewExtractor:Amazon] Constructed URL from canonical ASIN ${asin}`);
        }
      }
    }

    // ── Strategy 5: Find ASIN in page data attributes ────────────────────────
    if (!baseUrl) {
      const asinEl = document.querySelector('[data-asin]:not([data-asin=""])');
      const asin = asinEl?.getAttribute('data-asin');
      if (asin && /^[A-Z0-9]{10}$/i.test(asin)) {
        baseUrl = new URL(`${origin}/product-reviews/${asin.toUpperCase()}/ref=cm_cr_dp_d_show_all_btm`);
        console.log(`[ReviewExtractor:Amazon] Constructed URL from data-asin ${asin}`);
      }
    }

    if (!baseUrl) {
      console.log('[ReviewExtractor:Amazon] Could not determine all-reviews URL — skipping pagination');
      return [];
    }

    // Ensure correct query params
    baseUrl.searchParams.set('reviewerType', 'all_reviews');
    baseUrl.searchParams.set('pageNumber', '1');

    // ── Fetch page 1 to discover total review count ──────────────────────────
    console.log('[ReviewExtractor:Amazon] Fetching page 1:', baseUrl.toString());

    const firstHtml = await fetchPage(baseUrl.toString());
    if (!firstHtml) {
      console.warn('[ReviewExtractor:Amazon] Page 1 fetch failed — aborting pagination');
      return [];
    }

    const firstDoc = new DOMParser().parseFromString(firstHtml, 'text/html');

    // Extract reviews from page 1 of the all-reviews page
    const page1Reviews = extractAmazonReviews(firstDoc);
    console.log(`[ReviewExtractor:Amazon] Page 1: ${page1Reviews.length} reviews`);
    allReviews.push(...page1Reviews);

    // ── Determine total page count ─────────────────────────────────────────
    let totalReviews = 0;

    // Method A: data-hook count elements (most reliable on all-reviews page)
    const countSelectors = [
      '[data-hook="cr-filter-info-review-rating-count"]',
      '[data-hook="total-review-count"]',
      '#filter-info-section span[data-hook]',
    ];
    for (const sel of countSelectors) {
      const el = firstDoc.querySelector(sel);
      if (el) {
        const text = safeText(el);
        // "Showing 1-10 of 170 reviews" or "1-10 of 17"
        const m = text.match(/of\s+(\d[\d,]*)/i)
               || text.match(/(\d[\d,]*)\s*(?:total\s*)?(?:global\s*)?(?:customer\s*)?(?:ratings?|reviews?)/i);
        if (m) {
          totalReviews = parseInt(m[1].replace(/,/g, ''), 10);
          break;
        }
      }
    }

    // Method B: broad text search on the fetched all-reviews page
    if (!totalReviews) {
      const candidates = firstDoc.querySelectorAll('span, div');
      for (const el of candidates) {
        if (totalReviews) break;
        const t = safeText(el);
        const m = t.match(/of\s+(\d[\d,]*)\s*(?:reviews?|ratings?)/i)
               || t.match(/(\d[\d,]*)\s+(?:global\s+)?(?:customer\s+)?reviews?/i);
        if (m) totalReviews = parseInt(m[1].replace(/,/g, ''), 10);
      }
    }

    // Method C: detect "Next page" link in pagination
    const hasNextPage = !!firstDoc.querySelector(
      'li.a-last:not(.a-disabled) a, .a-pagination .a-last:not(.a-disabled) a'
    );
    if (!totalReviews && hasNextPage) {
      totalReviews = maxPages * 10; // assume maxPages pages
      console.log('[ReviewExtractor:Amazon] Next-page link found — will paginate up to', maxPages, 'pages');
    }

    // ── CRITICAL BUG FIX: NEVER early-return when count detection failed ─────
    // Old: if (totalReviews <= 10) → fires when totalReviews = 0 (parse failed)
    // Fix: only skip pagination when count was successfully parsed AND is tiny
    if (totalReviews > 0 && totalReviews <= 10) {
      console.log(`[ReviewExtractor:Amazon] Only ${totalReviews} total reviews — no more pages`);
      return allReviews;
    }

    // ── Pagination loop: page by page until empty or maxPages ────────────────
    // When totalReviews = 0 (count parsing failed), we still try paginating —
    // the loop stops naturally when a page returns 0 reviews.
    const reviewsPerPage = 10;
    const estimatedPages = totalReviews > 0
      ? Math.min(Math.ceil(totalReviews / reviewsPerPage), maxPages)
      : maxPages; // when count unknown, try up to maxPages

    console.log(
      `[ReviewExtractor:Amazon] Pagination: ${totalReviews > 0 ? '~' + totalReviews + ' reviews across ~' + estimatedPages : 'unknown total — up to ' + estimatedPages} pages. ` +
      `Fetching pages 2–${estimatedPages}…`
    );

    // ── Fetch remaining pages ────────────────────────────────────────────────
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 2; // Fail fast — backend will supplement via server-side scraping
    const PAGINATION_TIMEOUT_MS = 30_000; // 30-second overall pagination timeout
    const paginationStart = Date.now();

    for (let page = 2; page <= estimatedPages; page++) {
      // Check overall timeout
      if (Date.now() - paginationStart > PAGINATION_TIMEOUT_MS) {
        console.log(`[ReviewExtractor:Amazon] Pagination timeout (${PAGINATION_TIMEOUT_MS / 1000}s) — stopping`);
        break;
      }

      try {
        baseUrl.searchParams.set('pageNumber', String(page));

        const html = await fetchPage(baseUrl.toString());
        if (!html) {
          console.warn(`[ReviewExtractor:Amazon] Page ${page}: fetch failed`);
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.warn('[ReviewExtractor:Amazon] Too many consecutive failures — backend will supplement');
            break;
          }
          continue;
        }

        consecutiveFailures = 0;
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const pageReviews = extractAmazonReviews(doc);
        console.log(`[ReviewExtractor:Amazon] Page ${page}: ${pageReviews.length} reviews`);

        if (pageReviews.length === 0) {
          console.log('[ReviewExtractor:Amazon] Empty page — stopping pagination');
          break;
        }

        allReviews.push(...pageReviews);
        if (page < estimatedPages) await sleep(350);
      } catch (err) {
        console.warn(`[ReviewExtractor:Amazon] Page ${page} failed:`, err.message);
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
      }
    }
  } catch (err) {
    console.error('[ReviewExtractor:Amazon] Pagination error:', err);
  }

  console.log(`[ReviewExtractor:Amazon] Pagination total: ${allReviews.length} additional reviews`);
  return allReviews;
}

// ─── Flipkart ────────────────────────────────────────────────────────────────

const FLIPKART_REVIEW_SECTION = [
  '#productReviews_TP498',
  '[data-id="productReviews"]',
  'div[class*="productReviews"]',
  '#customer-review-section',
  'div[class*="_1AtVbE"]',
  'div[class*="EKFha-"]',
  'div[class*="RatingsReviews"]',
];

const FLIPKART_REVIEW_CONTAINERS = [
  'div[class*="_27M-vq"]',
  'div.col._2wzgFH',
  'div[class*="ZmyHeo"]',
  'div[class*="EKFha-"]',
  'div[class*="review-card"]',
  'div[class*="t-ZTKy"]',
  'div[class*="col-12-12"]',
  'div[class*="row-base-row"]',
  'div[class*="UserReviewCard"]',
  'div[class*="user-review"]',
];

const FLIPKART_REVIEW_BODY = [
  // Current known class names
  'div[class*="_6K-7Co"]',
  'div[class*="t-ZTKy"]',
  'div.t-ZTKy',
  'div[class*="ZmyHeo"]',
  'p[class*="z9E0IG"]',
  // Semantic / structural variants
  'div[class*="review-text"]',
  'div[class*="reviewText"]',
  'div[class*="reviewBody"]',
  'div[class*="review-body"]',
  'div[class*="reviewContent"]',
  'div[class*="review-content"]',
  'span[class*="reviewBody"]',
  'p[class*="reviewBody"]',
  'p[class*="review-text"]',
  // All-reviews page SSR fallback
  '[itemprop="reviewBody"]',
  '[itemprop="description"]',
  'div[class*="row"] > p',
];

const FLIPKART_RATING_SELECTORS = [
  // Known hash-based class names
  'div[class*="_3LWZlK"]',
  'div[class*="XQDdHH"]',
  'span[class*="_2_R_DZ"]',
  'div[class*="hGSR34"]',
  // Semantic / structural variants
  'div[class*="rating"] span',
  'div[class*="Rating"] span',
  'span[class*="ratingStar"]',
  'span[class*="RatingStar"]',
  'div[class*="starRating"]',
  'div[class*="star-rating"]',
  // ARIA / schema attributes
  '[aria-label*="star"]',
  '[aria-label*="Rating"]',
  '[itemprop="ratingValue"]',
];

/**
 * Find the "Ratings & Reviews" section.
 */
function findFlipkartReviewSection() {
  const candidates = document.querySelectorAll(
    'h1, h2, h3, h4, h5, h6, div[class*="header"], div[class*="heading"], div[class*="title"]'
  );
  for (const el of candidates) {
    const t = el.innerText?.trim();
    if (t === 'Ratings & Reviews' || t === 'Ratings and Reviews' || t === 'Customer Reviews') {
      let parent = el.parentElement;
      for (let i = 0; i < 6 && parent; i++) {
        if (parent.querySelectorAll('div, p, span').length > 10) {
          return parent;
        }
        parent = parent.parentElement;
      }
    }
  }
  return null;
}

/**
 * Parse a single Flipkart review card. No upper char limit.
 */
function parseFlipkartCard(container) {
  const ratingEl = qsFirst(container, FLIPKART_RATING_SELECTORS);
  let rating = 0;
  if (ratingEl) {
    const m = safeText(ratingEl).match(/^(\d)(?:\.\d)?$/);
    if (m) rating = clampRating(m[1]);
  }

  const bodyEl = qsFirst(container, FLIPKART_REVIEW_BODY);
  let text = safeText(bodyEl);

  const titleEl = container.querySelector(
    'p[class*="_2-N8zT"], p[class*="title"], b, [class*="reviewTitle"]'
  );
  const title = safeText(titleEl);

  if (text.length < 15 && title.length > 2) {
    text = title + (text ? '. ' + text : '');
  }

  if (!text || text.length < 5) return null;

  const authorEl = container.querySelector(
    'p[class*="_2sc7ZR"], span[class*="reviewer"], span[class*="author"], [class*="name"]'
  );
  const author = safeText(authorEl) || 'Flipkart User';

  return { text, rating: rating || 3, author, title: title || '', date: '', platform: 'flipkart' };
}

function extractFlipkartReviews() {
  const reviews = [];

  // Strategy 1: Standard known class-name containers
  let containers = qsAll(document, FLIPKART_REVIEW_CONTAINERS);
  console.log(`[ReviewExtractor:Flipkart] Strategy 1: ${containers.length} containers`);

  if (containers.length > 0) {
    for (const c of containers) {
      const r = parseFlipkartCard(c);
      if (r) reviews.push(r);
    }
  }

  // Strategy 2: Find "Ratings & Reviews" heading
  if (reviews.length === 0) {
    console.log('[ReviewExtractor:Flipkart] Strategy 2: heading-based search…');
    const section = findFlipkartReviewSection();
    if (section) {
      const ratingPills = qsAll(section, FLIPKART_RATING_SELECTORS);
      const cardSet = new Set();
      for (const pill of ratingPills) {
        const pillText = safeText(pill).trim();
        if (!/^[1-5](\.\d)?$/.test(pillText)) continue;
        let el = pill.parentElement;
        for (let i = 0; i < 6 && el && el !== section; i++) {
          const innerText = safeText(el);
          if (innerText.length > 20 && !cardSet.has(el)) {
            cardSet.add(el);
            const r = parseFlipkartCard(el);
            if (r) reviews.push(r);
            break;
          }
          el = el.parentElement;
        }
      }
      console.log(`[ReviewExtractor:Flipkart] Strategy 2: ${reviews.length} reviews`);
    }
  }

  // Strategy 3: "READ MORE" link anchors → walk up to card
  if (reviews.length === 0) {
    console.log('[ReviewExtractor:Flipkart] Strategy 3: READ MORE approach…');
    const cardSet = new Set();
    document.querySelectorAll('span, a, button').forEach((el) => {
      if (safeText(el) !== 'READ MORE') return;
      let parent = el.parentElement;
      for (let i = 0; i < 8 && parent; i++) {
        if (cardSet.has(parent)) break;
        const t = safeText(parent);
        if (t.length > 30) {
          const hasRating = qsFirst(parent, FLIPKART_RATING_SELECTORS);
          if (hasRating) {
            cardSet.add(parent);
            const r = parseFlipkartCard(parent);
            if (r) reviews.push(r);
            break;
          }
        }
        parent = parent.parentElement;
      }
    });
    console.log(`[ReviewExtractor:Flipkart] Strategy 3: ${reviews.length} reviews`);
  }

  // Strategy 4: Rating-pill walk-up (scoped to review section)
  if (reviews.length === 0) {
    console.log('[ReviewExtractor:Flipkart] Strategy 4: rating-pill walk-up…');
    const reviewArea = findFlipkartReviewSection() || document;
    const ratingPills = qsAll(reviewArea, FLIPKART_RATING_SELECTORS);
    const parentSet = new Set();
    for (const pill of ratingPills) {
      const pillText = safeText(pill).trim();
      if (!/^[1-5](\.\d)?$/.test(pillText)) continue;
      let el = pill;
      for (let i = 0; i < 6 && el?.parentElement; i++) {
        el = el.parentElement;
        const text = safeText(el);
        if (text.length > 20 && !parentSet.has(el)) {
          parentSet.add(el);
          const r = parseFlipkartCard(el);
          if (r) reviews.push(r);
          break;
        }
      }
    }
    console.log(`[ReviewExtractor:Flipkart] Strategy 4: ${reviews.length} reviews`);
  }

  console.log(`[ReviewExtractor:Flipkart] Total: ${reviews.length}`);
  return reviews;
}

// ─── Flipkart Pagination ─────────────────────────────────────────────────────

/**
 * Navigate through Flipkart's "All Reviews" page to fetch ALL reviews.
 *
 * @param {number} maxPages Safety limit (default 50)
 * @returns {Promise<Array>} All paginated reviews
 */
async function fetchFlipkartPaginatedReviews(maxPages = 50) {
  const allReviews = [];

  try {
    const currentUrl = window.location.href;
    let allReviewsHref = null;

    // ── Strategy 1: Already on a reviews page ────────────────────────────────
    if (currentUrl.includes('/product-reviews/')) {
      allReviewsHref = currentUrl;
    }

    // ── Strategy 2: Find "All Reviews" link in DOM ───────────────────────────
    if (!allReviewsHref) {
      const links = document.querySelectorAll('a[href*="/product-reviews/"], a[href*="page="]');
      for (const link of links) {
        const href = link.getAttribute('href');
        if (href && (href.includes('/product-reviews/') || href.includes('page='))) {
          allReviewsHref = href.startsWith('http') ? href : `https://www.flipkart.com${href}`;
          break;
        }
      }
    }

    // ── Strategy 3: Check "All N Reviews" text buttons ───────────────────────
    if (!allReviewsHref) {
      const allReviewButtons = document.querySelectorAll('span, a, div');
      for (const el of allReviewButtons) {
        const text = safeText(el).toLowerCase();
        if (text.match(/all\s+\d+\s*reviews?/i) || text === 'all reviews') {
          const link = el.closest('a') || el.querySelector('a');
          if (link?.href) {
            allReviewsHref = link.href;
            break;
          }
        }
      }
    }

    // ── Strategy 4: Construct URL from product slug in current URL ───────────
    //    Flipkart product URLs look like: /product-name/p/itmXXX?pid=YYY
    //    → construct /product-name/product-reviews/itmXXX?pid=YYY
    if (!allReviewsHref) {
      const flipkartSlugMatch = currentUrl.match(
        /flipkart\.com\/([^?#]+?)\/p\/(itm[a-z0-9]+)/i
      );
      if (flipkartSlugMatch) {
        const slug = flipkartSlugMatch[1];
        const itemId = flipkartSlugMatch[2];
        // Carry the pid param — Flipkart uses it to identify the exact product variant
        const pid = new URL(currentUrl).searchParams.get('pid') || '';
        const pidSuffix = pid ? `?pid=${encodeURIComponent(pid)}` : '';
        allReviewsHref = `https://www.flipkart.com/${slug}/product-reviews/${itemId}${pidSuffix}`;
        console.log(`[ReviewExtractor:Flipkart] Constructed URL from slug: ${allReviewsHref}`);
      }
    }

    if (!allReviewsHref) {
      console.log('[ReviewExtractor:Flipkart] No all-reviews link found — skipping pagination');
      return [];
    }

    console.log('[ReviewExtractor:Flipkart] All-reviews URL:', allReviewsHref);

    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 2; // Fail fast — backend will supplement
    const PAGINATION_TIMEOUT_MS = 30_000;
    const paginationStart = Date.now();
    let consecutiveEmpty = 0;

    for (let page = 1; page <= maxPages; page++) {
      if (Date.now() - paginationStart > PAGINATION_TIMEOUT_MS) {
        console.log(`[ReviewExtractor:Flipkart] Pagination timeout — stopping`);
        break;
      }

      try {
        const pageUrl = new URL(allReviewsHref);
        pageUrl.searchParams.set('page', String(page));

        const html = await fetchPage(pageUrl.toString());
        if (!html) {
          console.warn(`[ReviewExtractor:Flipkart] Page ${page}: fetch failed`);
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
          continue;
        }

        consecutiveFailures = 0;
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const pageReviews = [];
        const containers = qsAll(doc, FLIPKART_REVIEW_CONTAINERS);
        for (const c of containers) {
          const r = parseFlipkartCard(c);
          if (r) pageReviews.push(r);
        }

        // Fallback 1: rating pill walk-up on fetched doc
        if (pageReviews.length === 0) {
          const ratingPills = qsAll(doc, FLIPKART_RATING_SELECTORS);
          const cardSet = new Set();
          for (const pill of ratingPills) {
            const pillText = safeText(pill).trim();
            if (!/^[1-5](\.\d)?$/.test(pillText)) continue;
            let el = pill.parentElement;
            for (let i = 0; i < 6 && el; i++) {
              const text = safeText(el);
              if (text.length > 20 && !cardSet.has(el)) {
                cardSet.add(el);
                const r = parseFlipkartCard(el);
                if (r) pageReviews.push(r);
                break;
              }
              el = el.parentElement;
            }
          }
        }

        // Fallback 2: any element whose class contains "review" / "Review"
        // Catches Flipkart SSR pages that use class names we haven't seen before
        if (pageReviews.length === 0) {
          const reviewLike = doc.querySelectorAll(
            '[class*="review"],[class*="Review"],[class*="rating-card"],[class*="RatingCard"]'
          );
          const seen = new Set();
          for (const el of reviewLike) {
            if (seen.has(el)) continue;
            const text = safeText(el);
            if (text.length > 20) {
              seen.add(el);
              // Mark ancestors to avoid double-counting parent containers
              let p = el.parentElement;
              for (let i = 0; i < 4 && p; i++) { seen.add(p); p = p.parentElement; }
              const r = parseFlipkartCard(el);
              if (r) pageReviews.push(r);
            }
          }
          if (pageReviews.length > 0) {
            console.log(`[ReviewExtractor:Flipkart] Class fallback: ${pageReviews.length} reviews on page ${page}`);
          }
        }

        console.log(`[ReviewExtractor:Flipkart] Page ${page}: ${pageReviews.length} reviews`);

        if (pageReviews.length === 0) {
          consecutiveEmpty++;
          if (consecutiveEmpty >= 2) {
            console.log('[ReviewExtractor:Flipkart] No more reviews — stopping pagination');
            break;
          }
        } else {
          consecutiveEmpty = 0;
          allReviews.push(...pageReviews);
        }

        if (page < maxPages) await sleep(400);
      } catch (err) {
        console.warn(`[ReviewExtractor:Flipkart] Page ${page} failed:`, err.message);
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
      }
    }
  } catch (err) {
    console.error('[ReviewExtractor:Flipkart] Pagination error:', err);
  }

  console.log(`[ReviewExtractor:Flipkart] Pagination total: ${allReviews.length} additional reviews`);
  return allReviews;
}

// ─── Reliance Digital ────────────────────────────────────────────────────────

const RELIANCE_REVIEW_SECTION = [
  '#ratings-and-reviews',
  '[data-testid="ratings-and-reviews"]',
  'div[class*="review"]',
  '#ReviewComponent',
  'div[class*="pdp__reviews"]',
  'div[class*="customer-reviews"]',
];

const RELIANCE_REVIEW_CONTAINERS = [
  '[data-testid*="review-card"]',
  '[data-testid*="reviewCard"]',
  '[data-testid*="review-item"]',
  '[data-testid*="reviewItem"]',
  'div[class*="review-card"]',
  'div[class*="reviewCard"]',
  'div[class*="ReviewCard"]',
  'div[class*="user-review"]',
  'div[class*="UserReview"]',
  'div[class*="reviewItem"]',
  'div[class*="review-item"]',
  'div[class*="reviewWrapper"]',
  'div[class*="review-wrapper"]',
  'article[class*="review"]',
  'li[class*="review"]',
];

const RELIANCE_REVIEW_BODY = [
  '[data-testid*="review-text"]',
  'div[class*="review-text"]',
  'div[class*="reviewContent"]',
  'p[class*="review"]',
  'span[class*="review"]',
  'div[class*="reviewBody"]',
  'div[class*="review-body"]',
];

const RELIANCE_RATING_SELECTORS = [
  '[data-testid*="star-rating"]',
  '[data-testid*="starRating"]',
  '[data-testid*="rating"]',
  'div[class*="star-rating"]',
  'div[class*="starRating"]',
  'span[class*="rating"]',
  'div[class*="rating"]',
  '[aria-label*="out of 5"]',
  '[aria-label*="stars"]',
  '[aria-label*="rating"]',
  '[itemprop="ratingValue"]',
];

function extractRelianceReviews() {
  const reviews = [];

  let containers = qsAll(document, RELIANCE_REVIEW_CONTAINERS);

  // Fallback: any element with "review" in class
  if (containers.length === 0) {
    containers = Array.from(
      document.querySelectorAll('[class*="review"], [class*="Review"]')
    ).filter((el) => {
      const t = safeText(el);
      return t.length > 20;
    });
  }

  console.log(`[ReviewExtractor:Reliance] Found ${containers.length} containers`);

  for (const container of containers) {
    try {
      const bodyEl = qsFirst(container, RELIANCE_REVIEW_BODY);
      let text = safeText(bodyEl);
      if (!text || text.length < 10) text = safeText(container);
      if (!text || text.length < 5) continue;

      let rating = 0;
      const ratingEl = qsFirst(container, RELIANCE_RATING_SELECTORS);
      if (ratingEl) {
        const m = safeText(ratingEl).match(/(\d+(?:\.\d+)?)/);
        if (m) rating = clampRating(m[1]);
      }
      if (!rating) {
        const starEl = container.querySelector('[aria-label*="star"], [aria-label*="rating"]');
        if (starEl) {
          const m = starEl.getAttribute('aria-label').match(/(\d+(?:\.\d+)?)/);
          if (m) rating = clampRating(m[1]);
        }
      }
      if (!rating) rating = 3;

      const authorEl = container.querySelector('[class*="author"], [class*="user"], [class*="name"]');
      const author = safeText(authorEl) || 'Reliance User';

      reviews.push({
        text,
        rating,
        author,
        title: '',
        date: '',
        platform: 'reliancedigital',
      });
    } catch (e) {
      console.warn('[ReviewExtractor:Reliance] Skipped:', e.message);
    }
  }

  console.log(`[ReviewExtractor:Reliance] Total: ${reviews.length}`);
  return reviews;
}

// ─── Reliance Digital Pagination ─────────────────────────────────────────────

/**
 * Reliance Digital uses "Load More" / "Show More" buttons.
 * Clicks them repeatedly to load all reviews, then extracts.
 *
 * @param {number} maxClicks Safety limit for load-more clicks
 * @returns {Promise<Array>} All reviews after full expansion
 */
async function fetchReliancePaginatedReviews(maxClicks = 30) {
  try {
    // First, scroll to the review section
    await scrollToReviews(RELIANCE_REVIEW_SECTION, 2000);

    const loadMoreSelectors = [
      // Class-name patterns
      'button[class*="load-more"]',
      'button[class*="loadMore"]',
      'button[class*="show-more"]',
      'button[class*="showMore"]',
      'button[class*="view-more"]',
      'button[class*="viewMore"]',
      'a[class*="load-more"]',
      'a[class*="show-more"]',
      'a[class*="view-more"]',
      'div[class*="load-more"]',
      'span[class*="load-more"]',
      // data-testid patterns (Reliance Digital uses them extensively)
      '[data-testid*="load-more"]',
      '[data-testid*="loadMore"]',
      '[data-testid*="show-more"]',
      '[data-testid*="view-more"]',
    ];

    let clickCount = 0;
    let lastReviewCount = 0;
    let stableCount = 0;

    while (clickCount < maxClicks && stableCount < 3) {
      let clicked = false;

      // Try known selectors first
      for (const sel of loadMoreSelectors) {
        try {
          const btn = document.querySelector(sel);
          if (btn && btn.offsetParent !== null) {
            btn.scrollIntoView({ behavior: 'instant', block: 'center' });
            await sleep(200);
            btn.click();
            clicked = true;
            clickCount++;
            await sleep(1500);
            break;
          }
        } catch { /* skip */ }
      }

      // Fallback: generic buttons with "load more" text
      if (!clicked) {
        const buttons = document.querySelectorAll('button, a, span');
        for (const btn of buttons) {
          const text = safeText(btn).toLowerCase();
          if (
            (text.includes('load more') || text.includes('show more') || text.includes('view more')) &&
            text.length < 30 &&
            btn.offsetParent !== null
          ) {
            btn.scrollIntoView({ behavior: 'instant', block: 'center' });
            await sleep(200);
            btn.click();
            clicked = true;
            clickCount++;
            await sleep(1500);
            break;
          }
        }
      }

      if (!clicked) {
        // No button found — try scrolling down
        const reviewSection = qsFirst(document, RELIANCE_REVIEW_SECTION);
        if (reviewSection) {
          reviewSection.scrollIntoView({ behavior: 'instant', block: 'end' });
        } else {
          window.scrollBy(0, window.innerHeight);
        }
        await sleep(1000);
      }

      // Check if new reviews appeared
      const currentReviewCount = qsAll(document, RELIANCE_REVIEW_CONTAINERS).length;
      if (currentReviewCount === lastReviewCount) {
        stableCount++;
      } else {
        stableCount = 0;
        lastReviewCount = currentReviewCount;
      }
    }

    // Extract all reviews from the fully expanded page
    const reviews = extractRelianceReviews();
    console.log(`[ReviewExtractor:Reliance] After expansion: ${reviews.length} total reviews`);
    return reviews;
  } catch (err) {
    console.error('[ReviewExtractor:Reliance] Pagination error:', err);
    return [];
  }
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * Detect platform and extract reviews from current page DOM.
 */
export const extractReviews = () => {
  const url = window.location.href.toLowerCase();

  if (url.includes('amazon.')) return extractAmazonReviews();
  if (url.includes('flipkart.com')) return extractFlipkartReviews();
  if (url.includes('reliancedigital.in')) return extractRelianceReviews();

  console.warn('[ReviewExtractor] Unsupported platform:', url);
  return [];
};

/**
 * Detect which platform we're on.
 */
export const detectPlatform = () => {
  const url = window.location.href.toLowerCase();
  if (url.includes('amazon.')) return 'amazon';
  if (url.includes('flipkart.com')) return 'flipkart';
  if (url.includes('reliancedigital.in')) return 'reliancedigital';
  return 'unknown';
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get ALL reviews from the current page, including ALL paginated pages.
 *
 * Steps:
 *   1. Scroll the review section into view (triggers lazy-loaded content)
 *   2. Wait for DOM to settle
 *   3. Extract reviews from current page with platform-specific logic
 *   4. Fetch ALL additional pages via pagination (Amazon, Flipkart, Reliance)
 *   5. Deduplicate — NO artificial cap on review count
 *   6. ALWAYS resolves (never rejects) — empty array on failure
 *
 * @returns {Promise<{reviews: Array, platform: string, totalPages: number, totalRaw: number}>}
 */
export const getRealReviews = async () => {
  try {
    const url = window.location.href.toLowerCase();
    const platform = detectPlatform();

    let scrollTargets = [];
    if (platform === 'amazon') scrollTargets = AMAZON_REVIEW_SECTION;
    else if (platform === 'flipkart') scrollTargets = FLIPKART_REVIEW_SECTION;
    else if (platform === 'reliancedigital') scrollTargets = RELIANCE_REVIEW_SECTION;

    // Step 1: Scroll to reviews section
    console.log('[ReviewExtractor] Scrolling to review section…');
    await scrollToReviews(scrollTargets, 3000);

    // Step 2: Wait for DOM to stabilise
    await sleep(800);

    // Step 3: Extract from current page DOM
    let reviews = extractReviews();
    console.log(`[ReviewExtractor] Current page: ${reviews.length} reviews`);

    // Step 3b: If empty, do full-page scroll to trigger lazy content
    if (reviews.length === 0) {
      console.log('[ReviewExtractor] No reviews — scrolling full page…');
      await scrollFullPage(600, 250);
      await sleep(1000);
      reviews = extractReviews();
      console.log(`[ReviewExtractor] After full scroll: ${reviews.length} reviews`);
    }

    // Step 3c: If still empty, retry after short wait
    if (reviews.length === 0) {
      console.log('[ReviewExtractor] Retrying after 2s…');
      await sleep(2000);
      reviews = extractReviews();
      console.log(`[ReviewExtractor] Third pass: ${reviews.length} reviews`);
    }

    // Step 4: Fetch ALL additional pages via pagination
    let totalPages = 1;

    if (platform === 'amazon') {
      try {
        const paginatedReviews = await fetchAmazonPaginatedReviews(50);
        if (paginatedReviews.length > 0) {
          totalPages += Math.ceil(paginatedReviews.length / 10);
          console.log(`[ReviewExtractor] Amazon pagination added ${paginatedReviews.length} reviews`);
          reviews.push(...paginatedReviews);
        }
      } catch (err) {
        console.warn('[ReviewExtractor] Amazon pagination failed:', err.message);
      }
    } else if (platform === 'flipkart') {
      try {
        const paginatedReviews = await fetchFlipkartPaginatedReviews(50);
        if (paginatedReviews.length > 0) {
          totalPages += Math.ceil(paginatedReviews.length / 10);
          console.log(`[ReviewExtractor] Flipkart pagination added ${paginatedReviews.length} reviews`);
          reviews.push(...paginatedReviews);
        }
      } catch (err) {
        console.warn('[ReviewExtractor] Flipkart pagination failed:', err.message);
      }
    } else if (platform === 'reliancedigital') {
      try {
        const expandedReviews = await fetchReliancePaginatedReviews(30);
        if (expandedReviews.length > reviews.length) {
          reviews = expandedReviews;
          console.log(`[ReviewExtractor] Reliance expanded to ${reviews.length} reviews`);
        }
      } catch (err) {
        console.warn('[ReviewExtractor] Reliance pagination failed:', err.message);
      }
    }

    // Step 5: Deduplicate — NO artificial cap
    const seen = new Set();
    const unique = [];
    for (const r of reviews) {
      const fp = fingerprint(r.text);
      if (fp.length < 5) continue;
      if (seen.has(fp)) continue;
      seen.add(fp);
      unique.push(r);
    }

    console.log(
      `[ReviewExtractor] Final: ${unique.length} unique reviews (from ${reviews.length} raw, ${totalPages} pages, platform: ${platform})`
    );

    return {
      reviews: unique,
      platform,
      totalPages,
      totalRaw: reviews.length,
    };
  } catch (err) {
    console.error('[ReviewExtractor] Fatal error:', err);
    return { reviews: [], platform: detectPlatform(), totalPages: 0, totalRaw: 0 };
  }
};
