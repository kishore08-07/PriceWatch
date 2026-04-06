/**
 * Reliance Digital Search Scraper — Pool Edition
 * =================================================
 * Searches reliancedigital.in for products and extracts structured results.
 *
 * Uses the shared Puppeteer browser pool (browserPool.js) instead of launching
 * a new browser per query — eliminates the 3–5 s Chromium startup overhead.
 *
 * KEY: Reliance Digital is a client-side SPA. Direct URL navigation to
 * /search?q=... returns a 404. We must navigate to the homepage, type
 * the query into the search bar, and press Enter to trigger the SPA router.
 */

'use strict';

const axios = require('axios');
const { withBrowser } = require('../../utils/browserPool');

const HOME_URL = 'https://www.reliancedigital.in';
const MAX_RESULTS = 15;
const PAGE_TIMEOUT = 18000;

const randomDelay = (min = 250, max = 700) =>
    new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)));

function toAbsoluteRelianceUrl(pathOrUrl) {
    if (!pathOrUrl) return '';
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    const normalized = String(pathOrUrl).startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
    return `${HOME_URL}${normalized}`;
}

function normalizePriceValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    const parsed = parseInt(String(value).replace(/[^\d]/g, ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function mapCatalogItemToResult(item) {
    const title = (item?.name || item?.attributes?.description || '').trim();
    if (!title) return null;

    const slug = item?.slug || item?.action?.page?.params?.slug?.[0] || '';
    const url = toAbsoluteRelianceUrl(item?.action?.page?.url || (slug ? `/product/${slug}` : ''));
    if (!url || !/\/(?:product|p)\//i.test(url)) return null;

    const effectivePrice = normalizePriceValue(item?.price?.effective?.min);
    const markedPrice = normalizePriceValue(item?.price?.marked?.min);
    const price = effectivePrice || markedPrice || null;
    const sellable = item?.sellable;

    return {
        title: title.substring(0, 200),
        price,
        url: url.split('?')[0],
        availability: sellable === false ? 'Out of Stock' : 'In Stock',
        rating: normalizePriceValue(item?.rating?.value) || null,
        platform: 'Reliance Digital',
    };
}

async function searchRelianceViaCatalogApi(query) {
    const endpoint = `${HOME_URL}/ext/raven-api/catalog/v1.0/products`;
    const response = await axios.get(endpoint, {
        params: {
            q: query,
            f: 'page_type:number',
            page_id: '*',
            page_no: 1,
            page_size: 12,
            page_type: 'number',
        },
        timeout: 12000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': `${HOME_URL}/products?q=${encodeURIComponent(query)}`,
            'Origin': HOME_URL,
        },
        validateStatus: (s) => s >= 200 && s < 500,
    });

    if (response.status !== 200) return [];
    const items = Array.isArray(response.data?.items) ? response.data.items : [];
    const mapped = items
        .map(mapCatalogItemToResult)
        .filter(Boolean)
        .slice(0, MAX_RESULTS);

    return mapped;
}

/**
 * Search Reliance Digital for a product query and return structured results.
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of product candidates
 */
async function searchRelianceDigital(query, options = {}) {
    const { browserFallback = false } = options;

    // Fast path: Reliance catalog API is significantly faster and more stable than UI scraping.
    try {
        const apiResults = await searchRelianceViaCatalogApi(query);
        if (apiResults.length > 0) {
            console.log(`[RelianceScraper] API found ${apiResults.length} results for "${query}"`);
            return apiResults;
        }
    } catch (err) {
        console.warn(`[RelianceScraper] API search failed for "${query}": ${err.message}`);
    }

    if (!browserFallback) {
        return [];
    }

    // Fallback path: browser scraping.
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

            console.log(`[RelianceScraper] Navigating to homepage…`);
            await page.goto(HOME_URL, {
                waitUntil: 'domcontentloaded',
                timeout: PAGE_TIMEOUT,
            });

            await randomDelay(800, 1500);

            // Find and interact with the search bar
            console.log(`[RelianceScraper] Typing search query: "${query}"`);

            const searchInput = await page.$(
                'input.search-input, input[placeholder*="Search"], input[type="search"], #search, .search-bar input'
            );
            if (!searchInput) {
                console.error('[RelianceScraper] Search input not found on page');
                return [];
            }

            await searchInput.click();
            await randomDelay(200, 400);

            await searchInput.evaluate(el => el.value = '');
            await searchInput.type(query, { delay: 30 });
            await randomDelay(400, 700);

            await page.keyboard.press('Enter');
            console.log(`[RelianceScraper] Search submitted, waiting for results…`);

            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 }).catch(() => {
                console.warn('[RelianceScraper] Navigation timeout — trying to parse current page');
            });

            await page.waitForFunction(
                () => document.querySelectorAll('a[href*="/product/"], a[href*="/p/"]').length > 0,
                { timeout: 7000 }
            ).catch(() => {
                console.warn('[RelianceScraper] Result links not detected within timeout');
            });

            await randomDelay();

            const finalUrl = page.url();
            console.log(`[RelianceScraper] Current URL: ${finalUrl}`);

            const results = await page.evaluate((maxResults) => {
                const items = [];
                const seenUrls = new Set();

                // Strategy 1: Find all links that point to product pages
                const allLinks = document.querySelectorAll('a[href*="/product/"], a[href*="/p/"]');

                for (const link of allLinks) {
                    if (items.length >= maxResults) break;

                    let url = link.href || '';
                    if (!url) continue;
                    if (!/\/(?:product|p)\//i.test(url)) continue;

                    const cleanUrl = url.split('?')[0];
                    if (seenUrls.has(cleanUrl)) continue;
                    seenUrls.add(cleanUrl);

                    let title = link.getAttribute('title') || '';
                    if (!title || title.length < 5) {
                        title = link.innerText?.trim() || '';
                    }
                    if (!title || title.length < 5) {
                        const imgAlt = link.querySelector('img')?.getAttribute('alt') || '';
                        title = imgAlt.trim();
                    }
                    if (!title || title.length < 5) {
                        const cardText = (link.closest('[class*="product"], [class*="card"], li, div')?.innerText || '').trim();
                        const firstLine = cardText.split('\n').map((s) => s.trim()).find((s) => s.length >= 8);
                        title = firstLine || '';
                    }
                    title = title.split('\n')[0]?.trim() || title;
                    if (!title || title.length < 5) continue;
                    if (/^(home|login|cart|wishlist|orders)/i.test(title)) continue;

                    let price = null;
                    let container = link.parentElement;
                    for (let i = 0; i < 5 && container; i++) {
                        const text = container.innerText || '';
                        const priceMatch = text.match(/₹\s*([\d,.]+)/);
                        if (priceMatch) {
                            const parsed = parseInt(priceMatch[1].replace(/[^\d]/g, ''), 10);
                            if (parsed && parsed >= 100) { price = parsed; break; }
                        }
                        container = container.parentElement;
                    }

                    const containerText = (
                        link.closest('[class*="product"], [class*="card"], li, div') || link.parentElement
                    ).innerText?.toLowerCase() || '';
                    const availability = containerText.includes('out of stock') || containerText.includes('unavailable')
                        ? 'Out of Stock'
                        : 'In Stock';

                    items.push({
                        title: title.substring(0, 200),
                        price: price || null,
                        url: cleanUrl,
                        availability,
                        rating: null,
                        platform: 'Reliance Digital',
                    });
                }

                // Strategy 2: product cards fallback
                if (items.length === 0) {
                    const cards = document.querySelectorAll('[class*="product"], [class*="card"], [class*="plp"]');
                    for (const card of cards) {
                        if (items.length >= maxResults) break;

                        const text = card.innerText || '';
                        const priceMatch = text.match(/₹\s*([\d,.]+)/);
                        if (!priceMatch) continue;

                        const price = parseInt(priceMatch[1].replace(/[^\d]/g, ''), 10);
                        if (!price || price < 100) continue;

                        const link = card.querySelector('a');
                        if (!link) continue;
                        if (!/\/(?:product|p)\//i.test(link.href || '')) continue;

                        const title = link.getAttribute('title') || link.innerText?.split('\n')[0]?.trim() || '';
                        if (!title || title.length < 5) continue;

                        const url = link.href || '';
                        const cleanUrl = url.split('?')[0];
                        if (seenUrls.has(cleanUrl)) continue;
                        seenUrls.add(cleanUrl);

                        items.push({
                            title: title.substring(0, 200),
                            price: price || null,
                            url: cleanUrl,
                            availability: 'In Stock',
                            rating: null,
                            platform: 'Reliance Digital',
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
            if (page) await page.close().catch(() => { });
        }
    });
}

module.exports = { searchRelianceDigital };
