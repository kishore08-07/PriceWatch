/**
 * Amazon Search Scraper
 * Searches Amazon.in for products and extracts structured results.
 * Uses Puppeteer + page.evaluate for resilient extraction from the live DOM.
 */

const puppeteer = require('puppeteer');

const SEARCH_URL = 'https://www.amazon.in/s';
const MAX_RESULTS = 8;
const PAGE_TIMEOUT = 20000;

const randomDelay = (min = 2000, max = 5000) =>
    new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)));

/**
 * Search Amazon for a product query and return structured results.
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of product candidates
 */
async function searchAmazon(query) {
    let browser = null;

    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1366,768'
            ]
        });

        const page = await browser.newPage();

        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        );

        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-IN,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        });

        const searchUrl = `${SEARCH_URL}?k=${encodeURIComponent(query)}`;
        console.log(`[AmazonScraper] Searching: ${searchUrl}`);

        await page.goto(searchUrl, {
            waitUntil: 'domcontentloaded',
            timeout: PAGE_TIMEOUT
        });

        await page.waitForSelector('[data-component-type="s-search-result"]', {
            timeout: 10000
        }).catch(() => {
            console.warn('[AmazonScraper] Search result selector not found, trying to parse anyway');
        });

        await randomDelay(1000, 2000);

        // Use page.evaluate for resilient extraction from the live DOM
        const results = await page.evaluate((maxResults) => {
            const items = [];
            const seenUrls = new Set();
            const cards = document.querySelectorAll('[data-component-type="s-search-result"]');

            for (const card of cards) {
                if (items.length >= maxResults) break;

                // Skip sponsored results
                const cardText = card.innerText || '';
                if (/Sponsored/i.test(cardText.split('\n').slice(0, 3).join(' '))) continue;

                // --- Title extraction ---
                // Amazon's current DOM: h2 contains just the brand name,
                // and the full product title is in a span with class containing "text-normal"
                const h2 = card.querySelector('h2');
                const brand = h2 ? h2.innerText.trim() : '';

                // The product model/name lives in a span.a-text-normal (outside h2)
                const textNormals = card.querySelectorAll('[class*="text-normal"]');
                let productName = '';
                for (const tn of textNormals) {
                    const t = tn.innerText.trim();
                    if (t.length > 5) { productName = t; break; }
                }

                // Fallback: use the s-image alt attribute
                if (!productName) {
                    const img = card.querySelector('img.s-image');
                    productName = img ? img.getAttribute('alt') || '' : '';
                }

                // Combine brand + product name, avoiding duplication
                let title = '';
                if (productName && brand && !productName.toLowerCase().startsWith(brand.toLowerCase())) {
                    title = `${brand} ${productName}`;
                } else {
                    title = productName || brand;
                }

                if (!title || title.length < 5) continue;

                // --- URL extraction ---
                // Product links contain /dp/ in their href
                const dpLinks = card.querySelectorAll('a[href*="/dp/"]');
                let url = '';
                for (const link of dpLinks) {
                    const href = link.getAttribute('href') || '';
                    if (href) {
                        url = href.startsWith('http') ? href : `https://www.amazon.in${href}`;
                        break;
                    }
                }
                if (!url) continue;

                const cleanUrl = url.split('?')[0];
                if (seenUrls.has(cleanUrl)) continue;
                seenUrls.add(cleanUrl);

                // --- Price extraction ---
                let price = null;

                // Strategy 1: .a-offscreen inside .a-price (most reliable)
                const priceEl = card.querySelector('.a-price:not(.a-text-price) .a-offscreen');
                if (priceEl) {
                    const priceText = priceEl.innerText.replace(/[₹,\s]/g, '');
                    const parsed = parseInt(priceText, 10);
                    if (parsed && parsed >= 100) price = parsed;
                }

                // Strategy 2: .a-price-whole (visible price digits)
                if (!price) {
                    const priceWhole = card.querySelector('.a-price:not(.a-text-price) .a-price-whole');
                    if (priceWhole) {
                        const priceText = priceWhole.innerText.replace(/[.,\s]/g, '');
                        const parsed = parseInt(priceText, 10);
                        if (parsed && parsed >= 100) price = parsed;
                    }
                }

                // Strategy 3: Extract from card text (handles "₹64,900(1 new offer)" etc.)
                if (!price) {
                    const priceMatches = cardText.match(/₹[\s]*([\d,]+)/g);
                    if (priceMatches) {
                        for (const pm of priceMatches) {
                            const cleaned = pm.replace(/[₹,\s]/g, '');
                            const parsed = parseInt(cleaned, 10);
                            if (parsed && parsed >= 100) { price = parsed; break; }
                        }
                    }
                }

                if (!price) continue;

                // --- Availability ---
                const availText = cardText.toLowerCase();
                const availability = availText.includes('unavailable') || availText.includes('out of stock')
                    ? 'Out of Stock'
                    : 'In Stock';

                // --- Rating ---
                let rating = null;
                const ratingMatch = cardText.match(/([\d.]+)\s*out of\s*5/);
                if (ratingMatch) rating = parseFloat(ratingMatch[1]);

                items.push({
                    title,
                    price,
                    url: cleanUrl,
                    availability,
                    rating,
                    platform: 'Amazon'
                });
            }

            return items;
        }, MAX_RESULTS);

        console.log(`[AmazonScraper] Found ${results.length} results for "${query}"`);
        return results;

    } catch (error) {
        console.error(`[AmazonScraper] Error searching for "${query}":`, error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close().catch(() => { });
        }
    }
}

module.exports = { searchAmazon };
