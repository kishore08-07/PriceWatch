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
    }).filter(v => v >= 16); // Filter out RAM-sized values below 16GB as likely RAM not storage
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

// ── Main Matching Function ──────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.35;

/**
 * Match a source product against a list of candidates.
 *
 * @param {Object} sourceProduct - { title, brand, model }
 * @param {Array} candidates - [{ title, price, url, availability, ... }]
 * @returns {Object|null} Best match with confidence score, or null
 */
function matchProduct(sourceProduct, candidates) {
    if (!candidates || candidates.length === 0) return null;

    const { title: sourceTitle, brand: sourceBrand, model: sourceModel } = sourceProduct;
    const strippedSource = stripVariants(sourceTitle);

    const scored = candidates.map(candidate => {
        const strippedCandidate = stripVariants(candidate.title);

        // Weighted composite score
        const titleCosine = cosineSimilarity(strippedSource, strippedCandidate);
        const modelScore = modelMatch(sourceModel, candidate.title);
        const brandScore = brandMatch(sourceBrand, candidate.title);
        const fuzzy = fuzzyScore(strippedSource, strippedCandidate);
        const storage = storageMatch(sourceTitle, candidate.title);

        let confidence =
            0.35 * titleCosine +
            0.25 * modelScore +
            0.15 * brandScore +
            0.10 * fuzzy +
            0.15 * storage;

        // Hard penalty: if storage is explicitly mismatched, cap confidence
        if (storage === 0) {
            confidence = Math.min(confidence, 0.30);
        }

        return {
            ...candidate,
            matchConfidence: Math.round(confidence * 100) / 100,
            _scores: { titleCosine, modelScore, brandScore, fuzzy, storage }
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
    extractStorage,
    matchProduct,
    normalizeTitle,
    tokenize,
    stripVariants,
    CONFIDENCE_THRESHOLD
};
