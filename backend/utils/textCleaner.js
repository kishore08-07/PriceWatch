/**
 * Text cleaner for NLP preprocessing
 * Tokenization, stopword removal, normalization
 */

// Common English stopwords
const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for',
    'if', 'in', 'into', 'is', 'it', 'no', 'not', 'of', 'on', 'or', 'such',
    'that', 'the', 'their', 'then', 'there', 'these', 'they', 'this', 'to',
    'was', 'will', 'with', 'can', 'have', 'has', 'had', 'do', 'does', 'did',
    'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'am', 'i',
    'me', 'we', 'you', 'him', 'her', 'us', 'them', 'my', 'your', 'his',
    'our', 'its', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
    'other', 'some', 'such', 'what', 'which', 'who', 'why', 'how', 'just',
    'too', 'very', 'so', 'than', 'also', 'because', 'through', 'during',
    'before', 'after', 'above', 'below', 'up', 'down', 'out', 'off', 'over',
    'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most'
]);

/**
 * Convert text to lowercase and remove punctuation
 */
const normalizeText = (text) => {
    if (!text || typeof text !== 'string') return '';
    return text
        .toLowerCase()
        .trim();
};

/**
 * Tokenize text into words
 */
const tokenize = (text) => {
    if (!text || typeof text !== 'string') return [];
    
    // Split by whitespace and punctuation but keep contractions
    const tokens = text
        .split(/[\s\.,!?;:\-\(\)\[\]\{\}]+/)
        .filter(token => token.length > 0);

    return tokens;
};

/**
 * Remove stopwords from token list
 */
const removeStopwords = (tokens) => {
    if (!Array.isArray(tokens)) return [];
    return tokens.filter(token => !STOPWORDS.has(token.toLowerCase()));
};

/**
 * Simple stemming (suffix removal) - not using Porter Stemmer for lightweight approach
 */
const stem = (word) => {
    if (!word || typeof word !== 'string' || word.length < 3) {
        return word;
    }

    // Basic suffix removal rules
    let stemmed = word;

    // Remove common suffixes (in order of specificity)
    if (stemmed.endsWith('ies')) stemmed = stemmed.slice(0, -3) + 'i';
    else if (stemmed.endsWith('es')) stemmed = stemmed.slice(0, -2);
    else if (stemmed.endsWith('s')) stemmed = stemmed.slice(0, -1);
    else if (stemmed.endsWith('ed')) stemmed = stemmed.slice(0, -2);
    else if (stemmed.endsWith('ing')) stemmed = stemmed.slice(0, -3);
    else if (stemmed.endsWith('ly')) stemmed = stemmed.slice(0, -2);

    return stemmed.length > 2 ? stemmed : word;
};

/**
 * Clean and process text for NLP
 */
const cleanText = (text, options = {}) => {
    const {
        lowercase = true,
        tokenize: shouldTokenize = true,
        removeStops = true,
        stemming = true,
        minTokenLength = 2
    } = options;

    if (!text || typeof text !== 'string') {
        return '';
    }

    let cleaned = text;

    if (lowercase) {
        cleaned = normalizeText(cleaned);
    }

    if (!shouldTokenize) {
        return cleaned;
    }

    let tokens = tokenize(cleaned);

    if (removeStops) {
        tokens = removeStopwords(tokens);
    }

    if (stemming) {
        tokens = tokens.map(token => stem(token));
    }

    // Filter by minimum length
    tokens = tokens.filter(token => token.length >= minTokenLength);

    return tokens;
};

/**
 * Sentence tokenization
 */
const sentenceTokenize = (text) => {
    if (!text || typeof text !== 'string') return [];

    // Split by sentence-ending punctuation, but keep together abbreviations
    const sentences = text
        .split(/(?<=[.!?])\s+/g)
        .map(s => s.trim())
        .filter(s => s.length > 0);

    return sentences;
};

/**
 * Extract bigrams (2-word sequences)
 */
const extractBigrams = (tokens) => {
    if (!Array.isArray(tokens) || tokens.length < 2) return [];

    const bigrams = [];
    for (let i = 0; i < tokens.length - 1; i++) {
        bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
    }

    return bigrams;
};

/**
 * Extract n-grams of specified length
 */
const extractNgrams = (tokens, n = 2) => {
    if (!Array.isArray(tokens) || tokens.length < n || n < 1) return [];

    const ngrams = [];
    for (let i = 0; i <= tokens.length - n; i++) {
        ngrams.push(tokens.slice(i, i + n).join(' '));
    }

    return ngrams;
};

/**
 * Get word frequency map
 */
const getWordFrequency = (tokens) => {
    if (!Array.isArray(tokens)) return new Map();

    const frequency = new Map();
    tokens.forEach(token => {
        frequency.set(token, (frequency.get(token) || 0) + 1);
    });

    return frequency;
};

/**
 * Get top N most frequent tokens
 */
const getTopTokens = (tokens, n = 10) => {
    if (!Array.isArray(tokens)) return [];

    const frequency = getWordFrequency(tokens);
    return Array.from(frequency.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([token, count]) => ({ token, count }));
};

module.exports = {
    normalizeText,
    tokenize,
    removeStopwords,
    stem,
    cleanText,
    sentenceTokenize,
    extractBigrams,
    extractNgrams,
    getWordFrequency,
    getTopTokens
};
