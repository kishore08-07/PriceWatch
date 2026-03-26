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
const { matchProduct, cosineSimilarity, fuzzyScore, brandMatch, stripVariants } = require('./productMatcher');
const { generateCacheKey, setCache, getCache } = require('../utils/cacheService');

// Marketing noise patterns that appear in product titles on Indian e-commerce sites.
// Stripping these prevents polluted search queries like "Buy Samsung S24 Online India Amazon".
const MARKETING_NOISE_PATTERN = /(?:\|.*$)|(?:[-–]\s*buy\s+online.*$)|(?:[-–]\s*shop\s+online.*$)|\b(?:buy\s+online|shop\s+online|best\s+price|lowest\s+price|free\s+delivery|free\s+shipping|cash\s+on\s+delivery|emi\s+available|bank\s+offer)\b/gi;

/**
 * Strip marketing noise from a raw product title.
 * Removes pipe-separated suffixes and common Indian e-commerce marketing phrases
 * that confuse search scrapers.
 * @param {string} title
 * @returns {string}
 */
function stripMarketingNoise(title) {
    if (!title) return '';
    return title
        .replace(MARKETING_NOISE_PATTERN, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

const COMPARISON_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Map platform names to their scraper functions
const PLATFORM_SCRAPERS = {
    'Amazon': searchAmazon,
    'Flipkart': searchFlipkart,
    'Reliance Digital': searchRelianceDigital,
};

const ALL_PLATFORMS = ['Amazon', 'Flipkart', 'Reliance Digital'];

function getRelaxedMatch(sourceProduct, candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    const sourceTitle = stripVariants(sourceProduct.title || '');
    const sourceBrand = sourceProduct.brand || '';

    const scored = candidates.map((candidate) => {
        const candidateTitle = stripVariants(candidate.title || '');
        const semantic = cosineSimilarity(sourceTitle, candidateTitle);
        const fuzzy = fuzzyScore(sourceTitle, candidateTitle);
        const brand = brandMatch(sourceBrand, candidate.title || '');
        const score = (0.45 * semantic) + (0.35 * fuzzy) + (0.20 * brand);

        return { ...candidate, _relaxedScore: score };
    }).sort((a, b) => b._relaxedScore - a._relaxedScore);

    const best = scored[0];
    if (!best || best._relaxedScore < 0.28) return null;

    const { _relaxedScore, ...result } = best;
    return {
        ...result,
        matchConfidence: Math.max(result.matchConfidence || 0, Math.min(0.44, Math.round(_relaxedScore * 100) / 100)),
        relaxedMatched: true,
    };
}

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

    // Strip marketing noise from title before extracting significant words.
    // This handles titles like "Samsung Galaxy S24 | Buy Online India | Amazon"
    // or "Apple iPhone 15 Pro — Best Price, Free Delivery".
    const cleanTitle = stripMarketingNoise(product.title || '');

    // Extract significant words from cleaned title (skip brand/model words already added)
    if (cleanTitle) {
        const skipWords = new Set([
            ...(product.brand || '').toLowerCase().split(/\s+/),
            ...(product.model || '').toLowerCase().split(/\s+/),
            'buy', 'online', 'india', 'best', 'price', 'new', 'latest',
            'with', 'for', 'and', 'the', 'a', 'an', 'in', 'on', 'of',
            'free', 'shipping', 'delivery', '|', '-', '–', '—'
        ]);

        const titleWords = cleanTitle
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

function buildQueryVariants(product) {
    const base = buildSearchQuery(product);
    // Use cleaned title (not raw) to avoid passing marketing noise as a fallback query.
    const cleanTitle = stripMarketingNoise(product.title || '').replace(/\s+/g, ' ').trim();
    const brandModel = [product.brand, product.model].filter(Boolean).join(' ').trim();

    const variants = [base, brandModel, cleanTitle]
        .map((q) => (q || '').trim())
        .filter((q) => q.length >= 3);

    return [...new Set(variants)].slice(0, 3);
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
async function searchAndMatch(platform, queries, sourceProduct) {
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
        const candidateBuckets = await Promise.all(
            queries.map((q) => scraper(q).catch(() => []))
        );
        const candidates = candidateBuckets
            .flat()
            .filter(Boolean)
            .filter((c) => c.title && c.url);

        const deduped = [];
        const seen = new Set();
        for (const c of candidates) {
            const key = `${(c.url || '').split('?')[0]}::${(c.title || '').toLowerCase()}`;
            if (!seen.has(key)) {
                seen.add(key);
                deduped.push(c);
            }
        }

        if (deduped.length === 0) {
            return {
                platform,
                price: null,
                availability: 'Not Found',
                url: null,
                matchConfidence: 0,
                error: 'No search results found'
            };
        }

        let match = matchProduct(sourceProduct, deduped);
        if (!match) {
            match = getRelaxedMatch(sourceProduct, deduped);
            if (match) {
                console.log(`[PriceComparison] ${platform}: used relaxed fallback match`);
            }
        }

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
    // Key includes brand + model + first 80 chars of cleaned title to prevent
    // cache collisions between products with identical short title prefixes
    // (e.g. "Samsung Galaxy S24" vs "Samsung Galaxy S24+", or two colour variants).
    const cleanTitleForKey = stripMarketingNoise(title).substring(0, 80).toLowerCase();
    const cacheKey = generateCacheKey(
        'comparison',
        `${sourcePlatform}:${(brand || '').toLowerCase()}:${(model || '').toLowerCase()}:${cleanTitleForKey}`
    );
    const cached = getCache(cacheKey);

    if (cached) {
        const hasMissingPlatforms = Array.isArray(cached.results)
            && cached.results.some((r) => !r.isCurrent && (r.availability === 'Not Found' || r.price == null));

        if (!hasMissingPlatforms) {
            console.log('[PriceComparison] Cache hit');
            return { ...cached, fromCache: true };
        }

        console.log('[PriceComparison] Skipping stale/partial cache hit (missing platform data)');
    }

    // ── Build search query ──────────────────────────────────────────────
    const queryVariants = buildQueryVariants(product);
    const query = queryVariants[0];

    // ── Determine target platforms ──────────────────────────────────────
    const targetPlatforms = ALL_PLATFORMS.filter(p => p !== sourcePlatform);

    console.log(`[PriceComparison] Searching ${targetPlatforms.join(', ')} with query variants: ${queryVariants.join(' | ')}`);

    // ── Scrape all target platforms in parallel ─────────────────────────
    const sourceProduct = { title, brand: brand || '', model: model || '', price: normalizePrice(price) };

    const searchPromises = targetPlatforms.map(platform =>
        searchAndMatch(platform, queryVariants, sourceProduct)
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
