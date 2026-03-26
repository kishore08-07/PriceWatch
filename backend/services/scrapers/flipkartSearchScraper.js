/**
 * Flipkart Search Scraper — Pool Edition
 * ========================================
 * Searches Flipkart for products and extracts structured results.
 *
 * Uses the shared Puppeteer browser pool (browserPool.js) instead of launching
 * a new browser per query — eliminates the 3–5 s Chromium startup overhead.
 *
 * Popup dismissal uses text/ARIA matching instead of hardcoded CSS class names
 * that break every time Flipkart rotates its obfuscated class hash.
 */

'use strict';

const { withBrowser } = require('../../utils/browserPool');

const SEARCH_URL = 'https://www.flipkart.com/search';
const MAX_RESULTS = 15;
const PAGE_TIMEOUT = 20000;

const randomDelay = (min = 1000, max = 2500) =>
    new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)));

/**
 * Search Flipkart for a product query and return structured results.
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of product candidates
 */
async function searchFlipkart(query) {
    return withBrowser(async (browser) => {
        let page = null;
        try {
            page = await browser.newPage();

            await page.setViewport({ width: 1366, height: 768 });
            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
            );
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-IN,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            });

            const searchUrl = `${SEARCH_URL}?q=${encodeURIComponent(query)}`;
            console.log(`[FlipkartScraper] Searching: ${searchUrl}`);

            await page.goto(searchUrl, {
                waitUntil: 'domcontentloaded',
                timeout: PAGE_TIMEOUT,
            });

            // Close login popup if it appears.
            // Flipkart uses obfuscated, frequently-rotated CSS class names so we match
            // by close symbol text content or ARIA label instead — far more robust.
            await page.evaluate(() => {
                const closeSymbols = new Set(['\u2715', '\u00d7', '\u2716', '\u2613']);
                const elements = [
                    ...document.querySelectorAll('button, [role="button"], [role="dialog"] span, svg + span'),
                ];
                for (const el of elements) {
                    const txt = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
                    if (closeSymbols.has(txt) || txt.toLowerCase() === 'close') {
                        el.click();
                        return;
                    }
                }
            }).catch(() => { });

            // Wait for product cards (use data-id which is a stable attribute)
            await page.waitForSelector('[data-id]', { timeout: 10000 }).catch(() => {
                console.warn('[FlipkartScraper] [data-id] not found, trying a[href*="/p/"]');
            });

            await randomDelay();

            // Use page.evaluate for resilient extraction — no brittle CSS classes
            const results = await page.evaluate((maxResults) => {
                const items = [];
                const seenUrls = new Set();

                const cards = document.querySelectorAll('[data-id]');

                for (const card of cards) {
                    if (items.length >= maxResults) break;

                    // Skip ads/sponsored
                    const cardText = card.innerText || '';
                    if (/^Sponsored$/mi.test(cardText) || /^Ad$/mi.test(cardText)) continue;

                    const link = card.querySelector('a[href*="/p/"]');
                    if (!link) continue;

                    let url = link.href || '';
                    if (!url) continue;

                    const cleanUrl = url.split('?')[0];
                    if (seenUrls.has(cleanUrl)) continue;
                    seenUrls.add(cleanUrl);

                    // Extract title
                    let title = link.getAttribute('title') || '';
                    if (!title || title.length < 5) {
                        const linkText = link.innerText || '';
                        const lines = linkText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
                        for (const line of lines) {
                            if (!/^(add to|currently|sponsored|ad$)/i.test(line)) {
                                title = line;
                                break;
                            }
                        }
                    }
                    if (!title || title.length < 5) continue;
                    if (/^(coming soon|notify me|sold out|out of stock)$/i.test(title)) continue;

                    // Extract price
                    let price = null;
                    const allText = card.innerText || '';
                    const priceMatches = allText.match(/₹[\s]*([\d,]+)/g);
                    if (priceMatches && priceMatches.length > 0) {
                        for (const pm of priceMatches) {
                            const cleaned = pm.replace(/[₹,\s]/g, '');
                            const parsed = parseInt(cleaned, 10);
                            if (parsed && parsed >= 100) { price = parsed; break; }
                        }
                    }

                    const isUnavailable = /currently unavailable/i.test(allText);
                    const availability = isUnavailable ? 'Out of Stock' : 'In Stock';

                    let rating = null;
                    const ratingMatch = allText.match(/(\d\.?\d?)\s*★/);
                    if (ratingMatch) rating = parseFloat(ratingMatch[1]);

                    items.push({ title, price: price || null, url: cleanUrl, availability, rating, platform: 'Flipkart' });
                }

                return items;
            }, MAX_RESULTS);

            // Filter out items without price (unless out of stock)
            const validResults = results.filter(r => r.price != null || r.availability === 'Out of Stock');

            console.log(`[FlipkartScraper] Found ${validResults.length} results for "${query}"`);
            return validResults;

        } catch (error) {
            console.error(`[FlipkartScraper] Error searching for "${query}":`, error.message);
            throw error;
        } finally {
            if (page) await page.close().catch(() => { });
        }
    });
}

module.exports = { searchFlipkart };
