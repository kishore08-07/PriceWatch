/**
 * Price Comparison Service — Orchestrator
 *
 * Receives a product from the extension, searches the other two platforms,
 * matches the best product from each, and returns a comparison array.
 * Reuses the existing cacheService for 30-minute TTL caching.
 */

const { searchAmazon } = require('./scrapers/amazonSearchScraper');
const { searchFlipkart } = require('./scrapers/flipkartSearchScraper');
const { searchRelianceDigital } = require('./scrapers/relianceSearchScraper');
const { matchProduct } = require('./productMatcher');
const { generateCacheKey, setCache, getCache } = require('../utils/cacheService');

const COMPARISON_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Map platform names to their scraper functions
const PLATFORM_SCRAPERS = {
    'Amazon': searchAmazon,
    'Flipkart': searchFlipkart,
    'Reliance Digital': searchRelianceDigital,
};

const ALL_PLATFORMS = ['Amazon', 'Flipkart', 'Reliance Digital'];

/**
 * Build a search query from product info.
 * Uses brand + model + first N significant words from title.
 */
function buildSearchQuery(product) {
    const parts = [];

    if (product.brand) {
        parts.push(product.brand);
    }

    if (product.model) {
        parts.push(product.model);
    }

    // Extract significant words from title (skip brand/model words already added)
    if (product.title) {
        const skipWords = new Set([
            ...(product.brand || '').toLowerCase().split(/\s+/),
            ...(product.model || '').toLowerCase().split(/\s+/),
            'buy', 'online', 'india', 'best', 'price', 'new', 'latest',
            'with', 'for', 'and', 'the', 'a', 'an', 'in', 'on', 'of',
            'free', 'shipping', 'delivery', '|', '-', '–', '—'
        ]);

        const titleWords = product.title
            .replace(/[()[\]|–—]/g, ' ')   // Remove brackets and special chars but keep content
            .replace(/[^\w\s]/g, ' ')       // Remove remaining punctuation
            .split(/\s+/)
            .filter(w => w.length > 1 && !skipWords.has(w.toLowerCase()));

        // Take first 6 significant words
        const significantWords = titleWords.slice(0, 6);
        parts.push(...significantWords);
    }

    const query = parts.join(' ').replace(/\s+/g, ' ').trim();
    console.log(`[PriceComparison] Built search query: "${query}"`);
    return query;
}

/**
 * Normalize a price value to an integer.
 */
function normalizePrice(price) {
    if (price === null || price === undefined) return null;
    if (typeof price === 'number') return Math.floor(price);
    const cleaned = String(price).replace(/[₹,\s]/g, '');
    const parsed = parseInt(cleaned, 10);
    return isNaN(parsed) ? null : parsed;
}

/**
 * Search a single platform and match the best product.
 *
 * @param {string} platform - Target platform name
 * @param {string} query - Search query
 * @param {Object} sourceProduct - { title, brand, model }
 * @returns {Object} Result for this platform
 */
async function searchAndMatch(platform, query, sourceProduct) {
    const scraper = PLATFORM_SCRAPERS[platform];
    if (!scraper) {
        return {
            platform,
            price: null,
            availability: 'Unknown',
            url: null,
            matchConfidence: 0,
            error: `No scraper available for ${platform}`
        };
    }

    try {
        const candidates = await scraper(query);

        if (!candidates || candidates.length === 0) {
            return {
                platform,
                price: null,
                availability: 'Not Found',
                url: null,
                matchConfidence: 0,
                error: 'No search results found'
            };
        }

        const match = matchProduct(sourceProduct, candidates);

        if (!match) {
            return {
                platform,
                price: null,
                availability: 'Not Found',
                url: null,
                matchConfidence: 0,
                error: 'No confident match found in search results'
            };
        }

        return {
            platform: match.platform || platform,
            price: normalizePrice(match.price),
            availability: match.availability || 'Unknown',
            url: match.url || null,
            matchConfidence: match.matchConfidence || 0,
            title: match.title || null,
            rating: match.rating || null,
            error: null
        };

    } catch (error) {
        console.error(`[PriceComparison] ${platform} scraping failed:`, error.message);
        return {
            platform,
            price: null,
            availability: 'Error',
            url: null,
            matchConfidence: 0,
            error: error.message
        };
    }
}

/**
 * Compare a product across all supported platforms.
 *
 * @param {Object} product - { title, brand, model, price, platform, url }
 * @returns {Object} { results: [...], fromCache: boolean, searchQuery: string }
 */
async function compareProduct(product) {
    const { title, brand, model, price, platform: sourcePlatform, url: sourceUrl } = product;

    if (!title) {
        throw new Error('Product title is required for comparison');
    }

    // ── Check cache ─────────────────────────────────────────────────────
    const cacheKey = generateCacheKey('comparison', `${sourcePlatform}:${title.substring(0, 50)}`);
    const cached = getCache(cacheKey);

    if (cached) {
        console.log('[PriceComparison] Cache hit');
        return { ...cached, fromCache: true };
    }

    // ── Build search query ──────────────────────────────────────────────
    const query = buildSearchQuery(product);

    // ── Determine target platforms ──────────────────────────────────────
    const targetPlatforms = ALL_PLATFORMS.filter(p => p !== sourcePlatform);

    console.log(`[PriceComparison] Searching ${targetPlatforms.join(', ')} for "${query}"`);

    // ── Scrape all target platforms in parallel ─────────────────────────
    const sourceProduct = { title, brand: brand || '', model: model || '' };

    const searchPromises = targetPlatforms.map(platform =>
        searchAndMatch(platform, query, sourceProduct)
    );

    const otherResults = await Promise.all(searchPromises);

    // ── Add source platform to results ──────────────────────────────────
    const sourceResult = {
        platform: sourcePlatform,
        price: normalizePrice(price),
        availability: 'In Stock',
        url: sourceUrl,
        matchConfidence: 1.0,
        title: title,
        isCurrent: true,
        error: null
    };

    const results = [sourceResult, ...otherResults];

    // ── Sort: source first, then by price ascending (nulls last) ────────
    results.sort((a, b) => {
        if (a.isCurrent) return -1;
        if (b.isCurrent) return 1;
        if (a.price === null && b.price === null) return 0;
        if (a.price === null) return 1;
        if (b.price === null) return -1;
        return a.price - b.price;
    });

    const response = {
        results,
        searchQuery: query,
        fromCache: false,
        comparedAt: new Date().toISOString()
    };

    // ── Cache the result ────────────────────────────────────────────────
    setCache(cacheKey, response, COMPARISON_CACHE_TTL);

    console.log(`[PriceComparison] Comparison complete: ${results.filter(r => r.price).length}/${results.length} platforms with prices`);
    return response;
}

module.exports = { compareProduct, buildSearchQuery, normalizePrice };
