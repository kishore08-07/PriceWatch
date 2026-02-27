/**
 * Sanitizer utility for review text cleaning.
 * Removes HTML tags, control characters, and normalises common entities.
 * No external dependencies — pure string operations only.
 */

const HTML_TAG_PATTERN = /<[^>]*>/g;
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g;
const EXCESSIVE_WHITESPACE = /\s+/g;

// HTML entity map (covers the most common cases without a DOM parser)
const HTML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
  '&mdash;': '—',
  '&ndash;': '–',
  '&lsquo;': '\u2018',
  '&rsquo;': '\u2019',
  '&ldquo;': '\u201C',
  '&rdquo;': '\u201D',
};

const ENTITY_PATTERN = new RegExp(
  Object.keys(HTML_ENTITIES).map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') +
    '|&#(\\d+);|&#x([0-9a-fA-F]+);',
  'g'
);

/**
 * Remove HTML tags from text.
 * @param {string} text
 * @returns {string}
 */
const removeHtmlTags = (text) => {
  if (!text || typeof text !== 'string') return '';
  return text.replace(HTML_TAG_PATTERN, ' ');
};

/**
 * Decode common HTML entities without a DOM parser.
 * @param {string} text
 * @returns {string}
 */
const decodeHtmlEntities = (text) => {
  if (!text || typeof text !== 'string') return '';
  return text.replace(ENTITY_PATTERN, (match, dec, hex) => {
    if (HTML_ENTITIES[match]) return HTML_ENTITIES[match];
    if (dec) return String.fromCharCode(parseInt(dec, 10));
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    return match;
  });
};

/**
 * Remove control characters (keep newlines and tabs).
 * @param {string} text
 * @returns {string}
 */
const fixUnicodeIssues = (text) => {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(CONTROL_CHAR_PATTERN, '')
    .replace(EXCESSIVE_WHITESPACE, ' ');
};

/**
 * Normalise curly quotes and dashes.
 * @param {string} text
 * @returns {string}
 */
const normalizeQuotes = (text) => {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, '-');
};

/**
 * Main sanitisation function — applies all cleaners in sequence.
 * @param {string} text
 * @param {Object} [options]
 * @param {boolean} [options.removeHtml=true]
 * @param {boolean} [options.fixUnicode=true]
 * @param {boolean} [options.normalizeQuotes=true]
 * @param {number}  [options.maxLength=2000]
 * @param {boolean} [options.trim=true]
 * @returns {string}
 */
const sanitizeText = (text, options = {}) => {
  const {
    removeHtml = true,
    fixUnicode = true,
    normalizeQuotes: normalizeQuotesFlag = true,
    maxLength = 0,
    trim = true,
  } = options;

  if (!text || typeof text !== 'string') return '';

  let sanitized = text;

  if (removeHtml) sanitized = removeHtmlTags(sanitized);
  sanitized = decodeHtmlEntities(sanitized);
  if (fixUnicode) sanitized = fixUnicodeIssues(sanitized);
  if (normalizeQuotesFlag) sanitized = normalizeQuotes(sanitized);
  if (trim) sanitized = sanitized.trim();
  if (maxLength && sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength).trim();
  }

  return sanitized;
};

/**
 * Validate review text for safety and quality.
 * @param {string} text
 * @returns {{ valid: boolean, reason: string, truncated?: boolean }}
 */
const validateReviewText = (text) => {
  if (!text || typeof text !== 'string') {
    return { valid: false, reason: 'Invalid text format' };
  }

  const sanitized = sanitizeText(text);

  if (sanitized.length < 3) {
    return { valid: false, reason: 'Review text too short' };
  }

  // No upper length limit — accept full review text

  // Spam detection
  const spamPatterns = [
    /viagra|cialis|poker|casino|lottery/gi,
    /click here|buy now|limited offer/gi,
    /(.)\1{4,}/g, // 5+ repeated characters
  ];

  for (const pattern of spamPatterns) {
    if (pattern.test(sanitized)) {
      return { valid: false, reason: 'Potential spam detected' };
    }
  }

  return { valid: true, reason: 'Valid review text' };
};

module.exports = {
  removeHtmlTags,
  decodeHtmlEntities,
  fixUnicodeIssues,
  normalizeQuotes,
  sanitizeText,
  validateReviewText,
};