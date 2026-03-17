/**
 * Reliance Digital Search Scraper
 * Searches reliancedigital.in for products and extracts structured results.
 *
 * KEY: Reliance Digital is a client-side SPA. Direct URL navigation to
 * /search?q=... returns a 404. We must navigate to the homepage, type
 * the query into the search bar, and press Enter to trigger the SPA router.
 */

const puppeteer = require('puppeteer');

const HOME_URL = 'https://www.reliancedigital.in';
const MAX_RESULTS = 8;
const PAGE_TIMEOUT = 25000;

const randomDelay = (min = 1500, max = 3000) =>
    new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)));

/**
 * Search Reliance Digital for a product query and return structured results.
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of product candidates
 */
async function searchRelianceDigital(query) {
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

        console.log(`[RelianceScraper] Navigating to homepage…`);
        await page.goto(HOME_URL, {
            waitUntil: 'networkidle2',
            timeout: PAGE_TIMEOUT
        });

        await randomDelay(1000, 2000);

        // Find and interact with the search bar
        console.log(`[RelianceScraper] Typing search query: "${query}"`);

        // Click the search input to focus it
        const searchInput = await page.$('input.search-input, input[placeholder*="Search"], input[type="search"], #search, .search-bar input');
        if (!searchInput) {
            console.error('[RelianceScraper] Search input not found on page');
            return [];
        }

        await searchInput.click();
        await randomDelay(300, 500);

        // Clear any existing text and type the query
        await searchInput.evaluate(el => el.value = '');
        await searchInput.type(query, { delay: 30 });
        await randomDelay(500, 800);

        // Press Enter to trigger search
        await page.keyboard.press('Enter');
        console.log(`[RelianceScraper] Search submitted, waiting for results…`);

        // Wait for navigation / search results to load
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {
            console.warn('[RelianceScraper] Navigation timeout — trying to parse current page');
        });

        await randomDelay(2000, 3000);

        // Log the final URL for debugging
        const finalUrl = page.url();
        console.log(`[RelianceScraper] Current URL: ${finalUrl}`);

        // Extract results using page.evaluate — no brittle CSS selectors
        const results = await page.evaluate((maxResults) => {
            const items = [];
            const seenUrls = new Set();

            // Strategy 1: Find all links that point to product pages
            // Reliance Digital product URLs look like /product-name/p/XXXXXXXXXXXX
            const allLinks = document.querySelectorAll('a[href*="/p/"]');

            for (const link of allLinks) {
                if (items.length >= maxResults) break;

                let url = link.href || '';
                if (!url) continue;

                const cleanUrl = url.split('?')[0];
                if (seenUrls.has(cleanUrl)) continue;
                seenUrls.add(cleanUrl);

                // Get the title
                let title = link.getAttribute('title') || '';
                if (!title || title.length < 5) {
                    title = link.innerText?.trim() || '';
                }
                // Clean up title
                title = title.split('\n')[0]?.trim() || title;
                if (!title || title.length < 5) continue;
                // Skip non-product links
                if (/^(home|login|cart|wishlist|orders)/i.test(title)) continue;

                // Try to find a price in the parent container (go up to 5 levels)
                let price = null;
                let container = link.parentElement;
                for (let i = 0; i < 5 && container; i++) {
                    const text = container.innerText || '';
                    const priceMatch = text.match(/₹\s*([\d,]+)/);
                    if (priceMatch) {
                        const parsed = parseInt(priceMatch[1].replace(/,/g, ''), 10);
                        if (parsed && parsed >= 100) {
                            price = parsed;
                            break;
                        }
                    }
                    container = container.parentElement;
                }

                if (!price) continue; // Skip items without price

                // Check availability in the container text
                const containerText = (link.closest('[class*="product"], [class*="card"], li, div') || link.parentElement).innerText?.toLowerCase() || '';
                const availability = containerText.includes('out of stock') || containerText.includes('unavailable')
                    ? 'Out of Stock'
                    : 'In Stock';

                items.push({
                    title: title.substring(0, 200),
                    price,
                    url: cleanUrl,
                    availability,
                    rating: null,
                    platform: 'Reliance Digital'
                });
            }

            // Strategy 2: If no product links found, try looking for product cards
            if (items.length === 0) {
                const cards = document.querySelectorAll('[class*="product"], [class*="card"]');
                for (const card of cards) {
                    if (items.length >= maxResults) break;

                    const text = card.innerText || '';
                    const priceMatch = text.match(/₹\s*([\d,]+)/);
                    if (!priceMatch) continue;

                    const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
                    if (!price || price < 100) continue;

                    const link = card.querySelector('a');
                    if (!link) continue;

                    const title = link.getAttribute('title') || link.innerText?.split('\n')[0]?.trim() || '';
                    if (!title || title.length < 5) continue;

                    const url = link.href || '';
                    const cleanUrl = url.split('?')[0];
                    if (seenUrls.has(cleanUrl)) continue;
                    seenUrls.add(cleanUrl);

                    items.push({
                        title: title.substring(0, 200),
                        price,
                        url: cleanUrl,
                        availability: 'In Stock',
                        rating: null,
                        platform: 'Reliance Digital'
                    });
                }
            }

            return items;
        }, MAX_RESULTS);

        console.log(`[RelianceScraper] Found ${results.length} results for "${query}"`);
        return results;

    } catch (error) {
        console.error(`[RelianceScraper] Error searching for "${query}":`, error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close().catch(() => { });
        }
    }
}

module.exports = { searchRelianceDigital };
