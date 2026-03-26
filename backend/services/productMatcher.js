/**
 * Product Matcher — Pure-JS implementation
 * Uses cosine similarity, Levenshtein distance, and fuzzy matching
 * to find the best product match from search results.
 */

// ── Noise words to strip before comparison ──────────────────────────────
const NOISE_WORDS = new Set([
    'with', 'for', 'and', 'the', 'a', 'an', 'in', 'on', 'of', 'by',
    'buy', 'online', 'india', 'best', 'price', 'new', 'latest',
    'free', 'shipping', 'delivery', 'offer', 'discount', 'sale',
    'pack', 'combo', 'bundle', 'set', 'kit'
]);

// ── Variant keywords to strip ───────────────────────────────────────────
const VARIANT_PATTERN = /\b(\d+\s*gb|\d+\s*tb|\d+\s*mb|\d+\s*ram|\d+\s*rom|\d+\s*storage)\b/gi;
const COLOR_PATTERN = /\b(black|white|silver|gold|blue|red|green|grey|gray|pink|purple|titanium|midnight|starlight|graphite|phantom|cosmic|mystic|onyx|ivory|cream|bronze|copper|coral|lavender|mint|sage|yellow|orange)\b/gi;
const PARENTHETICAL = /\([^)]*\)/g;
const MODEL_TOKEN_PATTERN = /\b[a-z]*\d+[a-z\d-]*\b/gi;
const STORAGE_NUMERIC_TOKENS = new Set(['8', '16', '32', '64', '128', '256', '512', '1024', '2048']);

/**
 * Normalize a product title for comparison.
 */
function normalizeTitle(title) {
    if (!title) return '';
    return title
        .toLowerCase()
        .replace(PARENTHETICAL, ' ')     // Remove parenthetical info
        .replace(/[^\w\s]/g, ' ')         // Remove punctuation
        .replace(/\s+/g, ' ')            // Collapse whitespace
        .trim();
}

/**
 * Tokenize a string into significant words.
 */
function tokenize(text) {
    return normalizeTitle(text)
        .split(/\s+/)
        .filter(w => w.length > 1 && !NOISE_WORDS.has(w));
}

/**
 * Strip variant-specific info (color, storage) for core model comparison.
 */
function stripVariants(text) {
    if (!text) return '';
    return text
        .replace(VARIANT_PATTERN, '')
        .replace(COLOR_PATTERN, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// ── Levenshtein Distance ────────────────────────────────────────────────

function levenshteinDistance(a, b) {
    if (!a || !b) return Math.max((a || '').length, (b || '').length);

    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();

    if (aLower === bLower) return 0;

    const aLen = aLower.length;
    const bLen = bLower.length;

    // Optimized single-row DP
    const row = Array.from({ length: bLen + 1 }, (_, i) => i);

    for (let i = 1; i <= aLen; i++) {
        let prev = i;
        for (let j = 1; j <= bLen; j++) {
            const cost = aLower[i - 1] === bLower[j - 1] ? 0 : 1;
            const val = Math.min(
                row[j] + 1,         // deletion
                prev + 1,           // insertion
                row[j - 1] + cost   // substitution
            );
            row[j - 1] = prev;
            prev = val;
        }
        row[bLen] = prev;
    }

    return row[bLen];
}

/**
 * Normalized Levenshtein similarity (0–1).
 */
function levenshteinSimilarity(a, b) {
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    return 1 - levenshteinDistance(a, b) / maxLen;
}

// ── Cosine Similarity ───────────────────────────────────────────────────

/**
 * Build a term-frequency map from tokens.
 */
function termFrequency(tokens) {
    const tf = {};
    for (const token of tokens) {
        tf[token] = (tf[token] || 0) + 1;
    }
    return tf;
}

/**
 * Cosine similarity between two strings based on word tokens.
 */
function cosineSimilarity(a, b) {
    const tokensA = tokenize(a);
    const tokensB = tokenize(b);

    if (tokensA.length === 0 || tokensB.length === 0) return 0;

    const tfA = termFrequency(tokensA);
    const tfB = termFrequency(tokensB);

    // All unique terms
    const allTerms = new Set([...Object.keys(tfA), ...Object.keys(tfB)]);

    let dotProduct = 0;
    let magA = 0;
    let magB = 0;

    for (const term of allTerms) {
        const valA = tfA[term] || 0;
        const valB = tfB[term] || 0;
        dotProduct += valA * valB;
        magA += valA * valA;
        magB += valB * valB;
    }

    const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Build TF-IDF vectors for a small local corpus and compute cosine similarity.
 */
function tfidfCosineSimilarity(sourceText, candidateText, corpus = []) {
    const docs = [sourceText, candidateText, ...corpus].map((d) => tokenize(d));
    if (docs[0].length === 0 || docs[1].length === 0) return 0;

    const termDocFreq = {};
    for (const tokens of docs) {
        const uniq = new Set(tokens);
        for (const token of uniq) {
            termDocFreq[token] = (termDocFreq[token] || 0) + 1;
        }
    }

    const docCount = docs.length;
    const idf = {};
    for (const term of Object.keys(termDocFreq)) {
        idf[term] = Math.log((docCount + 1) / (termDocFreq[term] + 1)) + 1;
    }

    const vectorize = (tokens) => {
        const tf = termFrequency(tokens);
        const vec = {};
        for (const term of Object.keys(tf)) {
            vec[term] = tf[term] * (idf[term] || 0);
        }
        return vec;
    };

    const a = vectorize(docs[0]);
    const b = vectorize(docs[1]);
    const allTerms = new Set([...Object.keys(a), ...Object.keys(b)]);

    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (const term of allTerms) {
        const va = a[term] || 0;
        const vb = b[term] || 0;
        dot += va * vb;
        magA += va * va;
        magB += vb * vb;
    }

    const mag = Math.sqrt(magA) * Math.sqrt(magB);
    return mag === 0 ? 0 : dot / mag;
}

// ── Fuzzy Score ─────────────────────────────────────────────────────────

/**
 * Word-overlap ratio between two strings.
 */
function wordOverlap(a, b) {
    const wordsA = new Set(tokenize(a));
    const wordsB = new Set(tokenize(b));

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const w of wordsA) {
        if (wordsB.has(w)) intersection++;
    }

    // Jaccard-like coefficient
    return intersection / Math.min(wordsA.size, wordsB.size);
}

/**
 * Combined fuzzy score: 60% normalized Levenshtein + 40% word overlap.
 */
function fuzzyScore(a, b) {
    const normA = normalizeTitle(a);
    const normB = normalizeTitle(b);
    const levSim = levenshteinSimilarity(normA, normB);
    const overlap = wordOverlap(a, b);
    return 0.6 * levSim + 0.4 * overlap;
}

// ── Model Number Matching ───────────────────────────────────────────────

/**
 * Check if model numbers match (exact or substring).
 * Returns 1 for match, 0 for no match.
 */
function modelMatch(sourceModel, candidateTitle) {
    if (!sourceModel || sourceModel.length < 3) return 0;

    const model = sourceModel.toLowerCase().replace(/[\s-]/g, '');
    const title = candidateTitle.toLowerCase().replace(/[\s-]/g, '');

    // Exact substring match
    if (title.includes(model)) return 1;

    // Try partial match (at least 80% of model chars match)
    const modelParts = sourceModel.toLowerCase().split(/[\s-]+/).filter(p => p.length >= 2);
    if (modelParts.length === 0) return 0;

    let partsMatched = 0;
    for (const part of modelParts) {
        if (title.includes(part.replace(/[\s-]/g, ''))) {
            partsMatched++;
        }
    }

    return partsMatched / modelParts.length >= 0.8 ? 0.8 : 0;
}

/**
 * Check if brand names match.
 * Returns 1 for match, 0 for no match.
 */
function brandMatch(sourceBrand, candidateTitle) {
    if (!sourceBrand || sourceBrand.length < 2) return 0;

    const brand = sourceBrand.toLowerCase().trim();
    const title = candidateTitle.toLowerCase();

    // Direct match
    if (title.includes(brand)) return 1;

    // Common brand aliases
    const aliases = {
        'samsung': ['samsung', 'galaxy'],
        'apple': ['apple', 'iphone', 'ipad', 'macbook', 'airpods'],
        'oneplus': ['oneplus', 'one plus', '1+'],
        'lg': ['lg', 'life\'s good'],
        'hp': ['hp', 'hewlett'],
        'dell': ['dell'],
        'lenovo': ['lenovo', 'thinkpad', 'ideapad'],
        'mi': ['mi', 'xiaomi', 'redmi', 'poco'],
        'xiaomi': ['xiaomi', 'mi', 'redmi', 'poco'],
        'realme': ['realme'],
        'oppo': ['oppo'],
        'vivo': ['vivo'],
        'asus': ['asus', 'rog', 'zenbook'],
        'acer': ['acer', 'nitro', 'predator'],
        'sony': ['sony', 'playstation', 'bravia'],
        'boat': ['boat', 'boAt'],
        'jbl': ['jbl'],
        'bose': ['bose'],
        'google': ['google', 'pixel'],
        'nothing': ['nothing'],
    };

    const brandAliases = aliases[brand] || [brand];
    for (const alias of brandAliases) {
        if (title.includes(alias)) return 1;
    }

    return 0;
}

// ── Storage Capacity Matching ───────────────────────────────────────────

/**
 * Extract storage capacities from text (e.g., "256 GB", "1 TB").
 * Normalizes to GB for comparison.
 */
function extractStorage(text) {
    if (!text) return [];
    const matches = text.match(/(\d+)\s*(gb|tb)/gi);
    if (!matches) return [];
    return matches.map(m => {
        const [, num, unit] = m.match(/(\d+)\s*(gb|tb)/i);
        const val = parseInt(num, 10);
        return unit.toLowerCase() === 'tb' ? val * 1024 : val;
    // Filter out values below 32 GB — 16 GB is a common RAM size and causes
    // false storage mismatches. Legitimate storage starts at 32 GB for most
    // consumer electronics (phones, laptops, tablets, pendrives).
    }).filter(v => v >= 32);
}

/**
 * Check if storage capacities match between source and candidate.
 * Returns 1 if both have same storage, 0 if mismatch, 0.5 if one/both don't specify.
 */
function storageMatch(sourceTitle, candidateTitle) {
    const sourceStorage = extractStorage(sourceTitle);
    const candidateStorage = extractStorage(candidateTitle);

    // If neither specifies storage, neutral
    if (sourceStorage.length === 0 && candidateStorage.length === 0) return 0.5;
    // If only one specifies, mildly penalize
    if (sourceStorage.length === 0 || candidateStorage.length === 0) return 0.3;

    // Check if any storage values match
    for (const s of sourceStorage) {
        for (const c of candidateStorage) {
            if (s === c) return 1;
        }
    }

    // Storage specified on both but doesn't match — strong penalty
    return 0;
}

function extractModelTokens(text) {
    if (!text) return [];
    const matches = normalizeTitle(text).match(MODEL_TOKEN_PATTERN) || [];
    return matches
        .map((m) => m.replace(/[^a-z0-9]/gi, ''))
    .filter((m) => /\d/.test(m) && m.length >= 2)
        .filter((m) => !/^\d+(gb|tb|mb|ram|rom|storage)$/i.test(m))
    .filter((m) => !( /^\d+$/.test(m) && STORAGE_NUMERIC_TOKENS.has(m) ));
}

function modelTokenConsistency(sourceTitle, sourceModel, candidateTitle) {
    const srcTokens = new Set([
        ...extractModelTokens(sourceTitle),
        ...extractModelTokens(sourceModel || ''),
    ]);
    const candTokens = new Set(extractModelTokens(candidateTitle));

    if (srcTokens.size === 0 || candTokens.size === 0) return 0.5;

    let overlap = 0;
    for (const t of srcTokens) {
        if (candTokens.has(t)) overlap++;
    }

    if (overlap > 0) return 1;

    // Both sides have model tokens but none overlap → wrong variant/model.
    // Use 0.1 instead of 0 to avoid catastrophically capping confidence for
    // products with phrase-only names (e.g. "AirPods Pro", "Galaxy Buds") where
    // model token extraction produces no tokens on one or both sides at inference
    // time, but the mismatch is genuine here (both have tokens, none match).
    return 0.1;
}

function pricePlausibility(sourcePrice, candidatePrice) {
    if (!sourcePrice || !candidatePrice) return 0.5;
    if (sourcePrice <= 0 || candidatePrice <= 0) return 0.5;
    const ratio = candidatePrice / sourcePrice;
    if (ratio >= 0.55 && ratio <= 1.8) return 1;
    if (ratio >= 0.4 && ratio <= 2.3) return 0.6;
    return 0.1;
}

// ── Main Matching Function ──────────────────────────────────────────────

// Raised from 0.35 → 0.45: the old threshold was too permissive and allowed
// products sharing only a brand name or a storage size to be treated as matches.
// 0.45 requires at least moderate title similarity AND model/brand agreement.
const CONFIDENCE_THRESHOLD = 0.45;

/**
 * Match a source product against a list of candidates.
 *
 * @param {Object} sourceProduct - { title, brand, model }
 * @param {Array} candidates - [{ title, price, url, availability, ... }]
 * @returns {Object|null} Best match with confidence score, or null
 */
function matchProduct(sourceProduct, candidates) {
    if (!candidates || candidates.length === 0) return null;

    const { title: sourceTitle, brand: sourceBrand, model: sourceModel, price: sourcePrice } = sourceProduct;
    const strippedSource = stripVariants(sourceTitle);
    const localCorpus = candidates.map((c) => stripVariants(c.title || '')).filter(Boolean);

    const scored = candidates.map(candidate => {
        const strippedCandidate = stripVariants(candidate.title);

        // Weighted composite score
        const titleCosine = cosineSimilarity(strippedSource, strippedCandidate);
        const tfidfCosine = tfidfCosineSimilarity(strippedSource, strippedCandidate, localCorpus);
        const modelScore = modelMatch(sourceModel, candidate.title);
        const brandScore = brandMatch(sourceBrand, candidate.title);
        const fuzzy = fuzzyScore(strippedSource, strippedCandidate);
        const storage = storageMatch(sourceTitle, candidate.title);
        const modelTokenScore = modelTokenConsistency(sourceTitle, sourceModel, candidate.title);
        const priceScore = pricePlausibility(sourcePrice, candidate.price);

        let confidence =
            0.20 * titleCosine +
            0.22 * tfidfCosine +
            0.20 * modelScore +
            0.10 * brandScore +
            0.08 * fuzzy +
            0.10 * storage +
            0.05 * modelTokenScore +
            0.05 * priceScore;

        // Hard penalty: if storage is explicitly mismatched, cap confidence
        if (storage === 0) {
            confidence = Math.min(confidence, 0.30);
        }

        // Soft penalty: model tokens present on both sides but none overlap — likely
        // a different variant (e.g. S24 vs S24+). We still allow a generous cap of
        // 0.35 so that very-high-similarity titles (same brand, similar name) can
        // survive, but the explicit mismatch prevents a high overall confidence.
        if (modelTokenScore === 0.1) {
            confidence = Math.min(confidence, 0.35);
        }

        if ((candidate.availability || '').toLowerCase().includes('out of stock')) {
            confidence *= 0.97;
        }

        return {
            ...candidate,
            matchConfidence: Math.round(confidence * 100) / 100,
            _scores: { titleCosine, tfidfCosine, modelScore, brandScore, fuzzy, storage, modelTokenScore, priceScore }
        };
    });

    // Sort by confidence descending
    scored.sort((a, b) => b.matchConfidence - a.matchConfidence);

    const best = scored[0];

    if (best.matchConfidence < CONFIDENCE_THRESHOLD) {
        return null; // No confident match
    }

    // Remove internal score breakdown before returning
    const { _scores, ...result } = best;
    return result;
}

module.exports = {
    levenshteinDistance,
    levenshteinSimilarity,
    cosineSimilarity,
    fuzzyScore,
    wordOverlap,
    modelMatch,
    brandMatch,
    storageMatch,
    tfidfCosineSimilarity,
    extractStorage,
    matchProduct,
    normalizeTitle,
    tokenize,
    stripVariants,
    CONFIDENCE_THRESHOLD
};
