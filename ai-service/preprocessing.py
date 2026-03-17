"""
PriceWatch — Production-Grade Text Preprocessing Module
========================================================
Comprehensive preprocessing pipeline for customer review text before NLP inference.

Pipeline stages:
  1. HTML tag removal & entity decoding
  2. Unicode normalization (NFKC)
  3. Control character & zero-width char removal
  4. Emoji → text conversion (e.g. 👍 → thumbs up)
  5. Whitespace collapse
  6. Language detection (keep English + transliterated)
  7. Spam / offensive content filtering
  8. Short / empty review filtering
  9. Near-duplicate removal (Jaccard similarity on character shingles)
  10. Long-review truncation guard
  11. BART chunking (sentence-boundary aware)

Can be imported by app.py or run standalone for testing.
"""

import hashlib
import logging
import re
import unicodedata
from typing import Any, Dict, List, Optional, Set, Tuple

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Optional dependency imports (graceful fallback) ──────────────────────────

try:
    import emoji

    def emoji_to_text(text: str) -> str:
        """Convert emoji characters to their textual description."""
        return emoji.demojize(text, delimiters=(" ", " "))

    EMOJI_AVAILABLE = True
except ImportError:
    logger.warning("[Preprocessing] 'emoji' package not installed — emojis will be stripped.")

    def emoji_to_text(text: str) -> str:
        """Fallback: remove emoji characters entirely."""
        return re.sub(
            r"[\U0001F600-\U0001F64F"
            r"\U0001F300-\U0001F5FF"
            r"\U0001F680-\U0001F6FF"
            r"\U0001F1E0-\U0001F1FF"
            r"\U00002702-\U000027B0"
            r"\U000024C2-\U0001F251]+",
            " ",
            text,
        )

    EMOJI_AVAILABLE = False

try:
    from langdetect import detect as _lang_detect, LangDetectException

    def detect_language(text: str) -> str:
        """Return ISO 639-1 language code or 'unknown'."""
        try:
            return _lang_detect(text)
        except (LangDetectException, Exception):
            return "unknown"

    LANGDETECT_AVAILABLE = True
except ImportError:
    logger.warning("[Preprocessing] 'langdetect' package not installed — using ASCII heuristic.")

    def detect_language(text: str) -> str:
        """Heuristic: if ≥70 % ASCII → 'en', else 'unknown'."""
        if not text:
            return "unknown"
        ascii_count = sum(1 for c in text if ord(c) < 128)
        return "en" if ascii_count / max(len(text), 1) >= 0.70 else "unknown"

    LANGDETECT_AVAILABLE = False


# ── HTML cleaning ─────────────────────────────────────────────────────────────

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_HTML_ENTITIES = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">",
    "&quot;": '"', "&#39;": "'", "&apos;": "'",
    "&nbsp;": " ", "&mdash;": "\u2014", "&ndash;": "\u2013",
    "&lsquo;": "\u2018", "&rsquo;": "\u2019",
    "&ldquo;": "\u201c", "&rdquo;": "\u201d",
    "&copy;": "\u00a9", "&reg;": "\u00ae", "&trade;": "\u2122",
}
_ENTITY_RE = re.compile(
    "|".join(re.escape(k) for k in _HTML_ENTITIES) + r"|&#(\d+);|&#x([0-9a-fA-F]+);",
)


def strip_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    if not text:
        return ""
    text = _HTML_TAG_RE.sub(" ", text)

    def _replace_entity(m: re.Match) -> str:
        full = m.group(0)
        if full in _HTML_ENTITIES:
            return _HTML_ENTITIES[full]
        dec = m.group(1) if m.lastindex and m.group(1) else None
        hexv = m.group(2) if m.lastindex and m.lastindex >= 2 and m.group(2) else None
        if dec:
            try:
                return chr(int(dec))
            except (ValueError, OverflowError):
                return ""
        if hexv:
            try:
                return chr(int(hexv, 16))
            except (ValueError, OverflowError):
                return ""
        return full

    text = _ENTITY_RE.sub(_replace_entity, text)
    return text


# ── Unicode normalization & control char removal ─────────────────────────────

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]")
_WHITESPACE_RE = re.compile(r"\s+")
_ZERO_WIDTH_RE = re.compile(r"[\u200b\u200c\u200d\ufeff\u00ad]")


def normalize_unicode(text: str) -> str:
    """NFKC normalize, remove zero-width and control characters, collapse whitespace."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    text = _ZERO_WIDTH_RE.sub("", text)
    text = _CONTROL_RE.sub("", text)
    text = _WHITESPACE_RE.sub(" ", text)
    return text.strip()


# ── Spam / offensive content detection ────────────────────────────────────────

_SPAM_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"\b(viagra|cialis|poker|casino|lottery|bitcoin\s*invest)\b",
        r"\b(click\s+here|buy\s+now|limited\s+offer|act\s+fast)\b",
        r"\b(earn\s+\$?\d+\s*(per|a)\s*(day|hour|week))\b",
        r"(.)\1{6,}",  # 7+ repeated chars
        r"(https?://\S+){3,}",  # 3+ URLs in one review
    ]
]


def is_spam(text: str) -> bool:
    """Heuristic spam detection. Returns True if text looks like spam."""
    if not text:
        return True
    for pat in _SPAM_PATTERNS:
        if pat.search(text):
            return True
    return False


# ── Near-duplicate detection (shingle-based Jaccard) ─────────────────────────

def _shingle_set(text: str, k: int = 3) -> Set[str]:
    """Generate character-level k-shingles from normalized text."""
    norm = re.sub(r"[^a-z0-9]", "", text.lower())
    if len(norm) < k:
        return {norm}
    return {norm[i : i + k] for i in range(len(norm) - k + 1)}


def _jaccard(a: Set[str], b: Set[str]) -> float:
    """Jaccard similarity of two shingle sets."""
    if not a or not b:
        return 0.0
    intersection = len(a & b)
    union = len(a | b)
    return intersection / union if union else 0.0


def deduplicate_reviews(
    reviews: List[Dict[str, Any]],
    threshold: float = 0.85,
) -> List[Dict[str, Any]]:
    """
    Remove near-duplicate reviews using Jaccard similarity on character shingles.
    O(n²) but bounded by the review cap (typically ≤ 500).
    """
    if len(reviews) <= 1:
        return reviews

    unique: List[Dict[str, Any]] = []
    shingle_cache: List[Set[str]] = []

    for review in reviews:
        text = review.get("text", "")
        shingles = _shingle_set(text)
        is_dup = False
        for cached in shingle_cache:
            if _jaccard(shingles, cached) >= threshold:
                is_dup = True
                break
        if not is_dup:
            unique.append(review)
            shingle_cache.append(shingles)

    removed = len(reviews) - len(unique)
    if removed:
        logger.info(f"[Preprocessing] Dedup: {len(reviews)} → {len(unique)} ({removed} near-dupes removed)")
    return unique


# ── Single review cleaning ────────────────────────────────────────────────────

def clean_review_text(text: str) -> str:
    """
    Full cleaning pipeline for a single review string:
      HTML strip → Unicode normalize → Emoji→text → Collapse whitespace.
    """
    if not text or not isinstance(text, str):
        return ""
    text = strip_html(text)
    text = normalize_unicode(text)
    text = emoji_to_text(text)
    # Normalize curly quotes/dashes to ASCII equivalents
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = text.replace("\u2014", "-").replace("\u2013", "-")
    text = _WHITESPACE_RE.sub(" ", text)
    return text.strip()


# ── Batch preprocessing entry point ──────────────────────────────────────────

def preprocess_reviews(
    raw_reviews: List[Dict[str, Any]],
    *,
    min_length: int = 5,
    max_review_chars: int = 5000,
    allowed_languages: Optional[List[str]] = None,
    deduplicate: bool = True,
    dedup_threshold: float = 0.85,
    filter_spam: bool = True,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Production preprocessing pipeline for a batch of raw reviews.

    Args:
        raw_reviews:       List of review dicts (must have 'text' key).
        min_length:        Minimum text length after cleaning.
        max_review_chars:  Max chars per review (truncated, not dropped).
        allowed_languages: e.g. ['en']. None = accept all.
        deduplicate:       Run near-duplicate removal.
        dedup_threshold:   Jaccard threshold for duplicates.
        filter_spam:       Enable spam detection.

    Returns:
        (cleaned_reviews, stats_dict)
    """
    stats = {
        "total_input": len(raw_reviews),
        "empty_or_short": 0,
        "spam_filtered": 0,
        "language_filtered": 0,
        "duplicates_removed": 0,
        "total_output": 0,
    }

    cleaned: List[Dict[str, Any]] = []
    for r in raw_reviews:
        text = clean_review_text(r.get("text", ""))

        # Filter empty / too short
        if len(text) < min_length:
            stats["empty_or_short"] += 1
            continue

        # Spam filter
        if filter_spam and is_spam(text):
            stats["spam_filtered"] += 1
            continue

        # Language filter (only first 500 chars for speed)
        if allowed_languages:
            lang = detect_language(text[:500])
            if lang not in allowed_languages and lang != "unknown":
                stats["language_filtered"] += 1
                continue

        # Truncate extremely long reviews
        if len(text) > max_review_chars:
            text = text[:max_review_chars]

        cleaned.append({
            "text": text,
            "rating": float(r.get("rating", 3.0)),
            "author": r.get("author", "Anonymous"),
            "title": clean_review_text(r.get("title", "")),
            "date": r.get("date", ""),
        })

    # Near-duplicate removal
    before_dedup = len(cleaned)
    if deduplicate and len(cleaned) > 1:
        cleaned = deduplicate_reviews(cleaned, threshold=dedup_threshold)
    stats["duplicates_removed"] = before_dedup - len(cleaned)
    stats["total_output"] = len(cleaned)

    logger.info(
        f"[Preprocessing] Pipeline: {stats['total_input']} → {stats['total_output']} reviews "
        f"(short={stats['empty_or_short']}, spam={stats['spam_filtered']}, "
        f"lang={stats['language_filtered']}, dedup={stats['duplicates_removed']})"
    )
    return cleaned, stats


# ── BART chunking utilities ───────────────────────────────────────────────────

def chunk_text_for_bart(text: str, max_chars: int = 3200) -> List[str]:
    """
    Split combined review text into sentence-boundary-aware chunks.
    Each chunk stays within BART's token limit (~4 chars/token, limit ≈ 1024 tokens).
    """
    if not text:
        return []
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: List[str] = []
    current = ""
    for sentence in sentences:
        if len(current) + len(sentence) + 1 <= max_chars:
            current = (current + " " + sentence).strip()
        else:
            if current:
                chunks.append(current)
            current = sentence[:max_chars]
    if current:
        chunks.append(current)
    return chunks or [text[:max_chars]]


def prepare_texts_for_sentiment(reviews: List[Dict[str, Any]]) -> List[str]:
    """Extract cleaned text strings from preprocessed reviews for sentiment models."""
    return [r["text"] for r in reviews if len(r.get("text", "")) >= 5]


def prepare_text_for_summary(
    reviews: List[Dict[str, Any]],
    max_total_chars: int = 80_000,
) -> str:
    """
    Combine cleaned review texts for BART summarization.
    Sorts by rating extremeness (1★ and 5★ first) to prioritize signal-rich content.
    Caps at max_total_chars to bound map-reduce latency.
    """
    sorted_reviews = sorted(
        reviews,
        key=lambda r: abs(float(r.get("rating", 3)) - 3),
        reverse=True,
    )
    texts: List[str] = []
    total = 0
    for r in sorted_reviews:
        t = r.get("text", "")
        if len(t) < 5:
            continue
        if total + len(t) > max_total_chars:
            break
        texts.append(t)
        total += len(t) + 1
    return " ".join(texts)


# ── Standalone test ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    sample = [
        {"text": "<b>Great product!</b> &amp; amazing quality 👍👍. Very fast delivery.", "rating": 5},
        {"text": "Poor build quality. It broke after just 2 weeks.", "rating": 1},
        {"text": "Decent product, nothing special. Works as expected.", "rating": 3},
        {"text": "", "rating": 3},
        {"text": "ok", "rating": 3},
        {"text": "Click here buy now limited offer viagra", "rating": 5},
        {"text": "Poor build quality. It broke after just 2 weeks.", "rating": 1},
        {"text": "A" * 6000, "rating": 3},
    ]

    print("=== Preprocessing Pipeline ===\n")
    cleaned, stats = preprocess_reviews(sample)

    print(f"\nStats: {stats}")
    print(f"\nCleaned reviews ({len(cleaned)}):")
    for i, r in enumerate(cleaned):
        print(f"  {i+1}. [{r['rating']}★] {r['text'][:80]}{'...' if len(r['text']) > 80 else ''}")

    print("\n=== BART Chunks ===")
    combined = prepare_text_for_summary(cleaned)
    chunks = chunk_text_for_bart(combined, max_chars=200)
    for i, c in enumerate(chunks):
        print(f"  Chunk {i+1}: {c[:100]}...")
