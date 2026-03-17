/**
 * Flipkart Search Scraper
 * Searches Flipkart for products and extracts structured results.
 * Uses Puppeteer + page.evaluate for resilient extraction (no brittle CSS classes).
 */

const puppeteer = require('puppeteer');

const SEARCH_URL = 'https://www.flipkart.com/search';
const MAX_RESULTS = 8;
const PAGE_TIMEOUT = 20000;

const randomDelay = (min = 1500, max = 3000) =>
    new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)));

/**
 * Search Flipkart for a product query and return structured results.
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of product candidates
 */
async function searchFlipkart(query) {
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
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        );

        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-IN,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        });

        const searchUrl = `${SEARCH_URL}?q=${encodeURIComponent(query)}`;
        console.log(`[FlipkartScraper] Searching: ${searchUrl}`);

        await page.goto(searchUrl, {
            waitUntil: 'domcontentloaded',
            timeout: PAGE_TIMEOUT
        });

        // Close login popup if it appears (try multiple strategies)
        await page.evaluate(() => {
            // Strategy 1: Known close button pattern
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                if (b.innerText && (b.innerText.includes('✕') || b.innerText.trim() === '✕')) {
                    b.click();
                    return;
                }
            }
            // Strategy 2: Known class patterns
            const closeBtn = document.querySelector('button._2KpZ6l._2doB4z');
            if (closeBtn) closeBtn.click();
        }).catch(() => { });

        // Wait for product cards (use data-id which is a stable attribute)
        await page.waitForSelector('[data-id]', { timeout: 10000 }).catch(() => {
            console.warn('[FlipkartScraper] [data-id] not found, trying a[href*="/p/"]');
        });

        await randomDelay(1500, 2500);

        // Use page.evaluate for resilient extraction — no brittle CSS classes
        const results = await page.evaluate((maxResults) => {
            const items = [];
            const seenUrls = new Set();

            // Find all product card containers
            const cards = document.querySelectorAll('[data-id]');

            for (const card of cards) {
                if (items.length >= maxResults) break;

                // Skip ads/sponsored
                const cardText = card.innerText || '';
                if (/^Sponsored$/mi.test(cardText) || /^Ad$/mi.test(cardText)) continue;

                // Find the product link
                const link = card.querySelector('a[href*="/p/"]');
                if (!link) continue;

                let url = link.href || '';
                if (!url) continue;

                // Deduplicate
                const cleanUrl = url.split('?')[0];
                if (seenUrls.has(cleanUrl)) continue;
                seenUrls.add(cleanUrl);

                // Extract title from the link or its children
                let title = '';
                // Try the link's title attribute
                title = link.getAttribute('title') || '';
                // Try extracting text from the link itself
                if (!title || title.length < 5) {
                    // Get the text of the link, excluding "Add to Compare" and similar
                    const linkText = link.innerText || '';
                    const lines = linkText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
                    // Find the first line that looks like a product title (not "Add to Compare", "Currently unavailable")
                    for (const line of lines) {
                        if (!/^(add to|currently|sponsored|ad$)/i.test(line)) {
                            title = line;
                            break;
                        }
                    }
                }

                if (!title || title.length < 5) continue;
                // Skip non-product titles
                if (/^(coming soon|notify me|sold out|out of stock)$/i.test(title)) continue;

                // Extract price — find ₹ symbols in the card
                let price = null;
                const allText = card.innerText || '';
                // Match ₹ followed by digits (with optional commas)
                const priceMatches = allText.match(/₹[\s]*([\d,]+)/g);
                if (priceMatches && priceMatches.length > 0) {
                    // Take the first price (usually the selling price)
                    for (const pm of priceMatches) {
                        const cleaned = pm.replace(/[₹,\s]/g, '');
                        const parsed = parseInt(cleaned, 10);
                        if (parsed && parsed >= 100) {
                            price = parsed;
                            break;
                        }
                    }
                }

                // Check availability
                const isUnavailable = /currently unavailable/i.test(allText);
                const availability = isUnavailable ? 'Out of Stock' : 'In Stock';

                // Extract rating
                let rating = null;
                const ratingMatch = allText.match(/(\d\.?\d?)\s*★/);
                if (ratingMatch) {
                    rating = parseFloat(ratingMatch[1]);
                }

                items.push({
                    title,
                    price: price || null,
                    url: cleanUrl,
                    availability,
                    rating,
                    platform: 'Flipkart'
                });
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
        if (browser) {
            await browser.close().catch(() => { });
        }
    }
}

module.exports = { searchFlipkart };
