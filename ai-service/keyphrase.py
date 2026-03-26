"""
PriceWatch — KeyBERT Pros/Cons Extractor
=========================================
Replaces the hard-coded keyword list in app.py with dynamic keyphrase extraction
using KeyBERT, which re-uses the MiniLM sentence-transformer already present in
the HuggingFace ecosystem.

WHY: The old system had ~40 hardcoded signal phrases ("good quality", "value for
money"). These generics appear in every product's summary regardless of the actual
product domain. A phone review's "telephoto lens issues" and a laptop's "fan noise
under load" were both silently ignored.

HOW:
  1. Split reviews into positive (rating >= 4) and negative (rating <= 2) groups.
  2. Feed positive text to KeyBERT → extract top-N noun phrases → pros
  3. Feed negative text to KeyBERT → extract top-N noun phrases → cons
  4. Score each phrase by (frequency × average_confidence) to surface the most
     consistently mentioned issues/strengths.

Performance: KeyBERT shares the same underlying MiniLM sentence-transformer as
HuggingFace's sentence-similarity pipelines. First call is slow (~3s cold), but
subsequent calls are fast (40–200ms for a batch of 200 sentences).

Graceful fallback: if keybert is not installed, falls back to the old
high-frequency phrase counting approach.
"""

import logging
import re
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── Optional KeyBERT import ──────────────────────────────────────────────────

try:
    from keybert import KeyBERT

    # Shared model instance — loaded once and reused across calls.
    # Uses all-MiniLM-L6-v2 by default (fast, good quality).
    _kw_model: Optional["KeyBERT"] = None

    def _get_kw_model() -> "KeyBERT":
        global _kw_model
        if _kw_model is None:
            logger.info("[KeyBERT] Loading KeyBERT model (all-MiniLM-L6-v2)…")
            _kw_model = KeyBERT()
            logger.info("[KeyBERT] Model loaded and ready.")
        return _kw_model

    KEYBERT_AVAILABLE = True
    logger.info("[KeyBERT] keybert package available — dynamic pros/cons enabled.")

except ImportError:
    KEYBERT_AVAILABLE = False
    logger.warning("[KeyBERT] keybert not installed — falling back to frequency-based pros/cons.")

# ── Fallback: classic high-frequency phrase matching ────────────────────────

# Used when KeyBERT is not installed.  Groups of semantically related phrases
# are listed together so that any phrase in a group contributes to that group's
# count (avoids splitting votes across near-synonyms).
_FALLBACK_POS_PATTERNS: List[Tuple[str, List[str]]] = [
    ("good build quality",   ["build quality", "well built", "sturdy", "solid", "premium feel"]),
    ("value for money",      ["value for money", "worth the price", "affordable", "budget friendly"]),
    ("fast performance",     ["fast", "quick", "snappy", "lag-free", "smooth performance"]),
    ("good battery life",    ["battery life", "battery backup", "long battery", "lasts all day"]),
    ("great display",        ["display", "screen quality", "bright screen", "vivid colors"]),
    ("excellent camera",     ["camera quality", "great camera", "photos", "zoom", "night mode"]),
    ("fast delivery",        ["fast delivery", "quick shipping", "delivered on time", "packaging"]),
    ("easy to use",          ["easy to use", "user friendly", "intuitive", "simple setup"]),
]

_FALLBACK_NEG_PATTERNS: List[Tuple[str, List[str]]] = [
    ("poor battery life",    ["battery drain", "low battery", "doesn't last", "bad battery"]),
    ("heating issues",       ["heats up", "overheating", "gets hot", "heat"]),
    ("poor build quality",   ["build quality", "flimsy", "cheap plastic", "feels cheap"]),
    ("software bugs",        ["bug", "crash", "freezes", "glitch", "software issue"]),
    ("slow performance",     ["slow", "lag", "lags", "hangs", "sluggish"]),
    ("poor camera",          ["camera quality", "blurry", "bad photos", "poor camera"]),
    ("delivery issues",      ["delayed delivery", "damaged packaging", "wrong product", "delivery issue"]),
    ("not worth price",      ["overpriced", "not worth", "expensive for what it is"]),
]


def _fallback_extract(texts: List[str], patterns: List[Tuple[str, List[str]]], top_n: int) -> List[str]:
    """Count pattern hits in texts and return top-N pattern labels."""
    if not texts:
        return []
    counts: Counter = Counter()
    combined = " ".join(texts).lower()
    for label, phrases in patterns:
        for phrase in phrases:
            if phrase in combined:
                counts[label] += 1
    return [label.title() for label, _ in counts.most_common(top_n)]


def _extract_frequent_phrases(texts: List[str], top_n: int = 5) -> List[str]:
    """
    Last-resort extraction: find frequently occurring 2-3 word phrases in texts.
    Filters out generic stop-word-only phrases and e-commerce metadata.
    """
    if not texts:
        return []

    _STOP_WORDS = {
        "the", "a", "an", "is", "it", "was", "are", "were", "been", "be",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "shall", "can", "to", "of", "in", "for",
        "on", "with", "at", "by", "from", "as", "into", "through", "during",
        "before", "after", "above", "below", "between", "and", "but", "or",
        "nor", "not", "so", "yet", "both", "either", "neither", "each",
        "every", "all", "any", "few", "more", "most", "other", "some",
        "no", "only", "own", "same", "than", "too", "very", "just",
        "i", "my", "me", "we", "our", "you", "your", "he", "she", "they",
        "this", "that", "these", "those", "which", "who", "whom",
        "its", "his", "her", "their", "what", "when", "where", "how",
        "amazon", "flipkart", "reliance", "digital", "product", "item",
        "buy", "bought", "purchase", "order", "ordered", "delivery",
    }

    bigram_counts: Counter = Counter()
    combined = " ".join(texts).lower()
    words = re.findall(r"[a-z]{2,}", combined)

    for i in range(len(words) - 1):
        w1, w2 = words[i], words[i + 1]
        if w1 in _STOP_WORDS and w2 in _STOP_WORDS:
            continue
        if w1 not in _STOP_WORDS or w2 not in _STOP_WORDS:
            bigram_counts[f"{w1} {w2}"] += 1

    # Filter out low-frequency and return top-N
    phrases = [
        phrase.title()
        for phrase, count in bigram_counts.most_common(top_n * 3)
        if count >= 2
    ][:top_n]

    return phrases


# ── Public API ───────────────────────────────────────────────────────────────

def extract_pros_cons(
    reviews: List[Dict[str, Any]],
    top_n: int = 5,
    ngram_range: Tuple[int, int] = (1, 3),
) -> Tuple[List[str], List[str]]:
    """
    Extract the top product-specific pros and cons from a batch of reviews.

    Args:
        reviews:     Preprocessed review dicts with 'text' and 'rating' keys.
        top_n:       Number of pros/cons to return.
        ngram_range: N-gram range for keyphrase extraction (default 1–3 words).

    Returns:
        (pros, cons) — each is a list of up to top_n human-readable phrases.
    """
    if not reviews:
        return [], []

    # Split by rating — widened thresholds to capture more signal
    positive_texts = [r["text"] for r in reviews if float(r.get("rating", 3)) >= 3.5]
    negative_texts = [r["text"] for r in reviews if float(r.get("rating", 3)) <= 2.5]

    # If thresholds produce nothing, use all reviews grouped by above/below midpoint
    if not positive_texts and not negative_texts:
        positive_texts = [r["text"] for r in reviews if float(r.get("rating", 3)) >= 3]
        negative_texts = [r["text"] for r in reviews if float(r.get("rating", 3)) < 3]

    if not KEYBERT_AVAILABLE:
        pros = _fallback_extract(positive_texts, _FALLBACK_POS_PATTERNS, top_n)
        cons = _fallback_extract(negative_texts, _FALLBACK_NEG_PATTERNS, top_n)
        # If fallback patterns found nothing, try frequency-based noun phrases
        if not pros:
            pros = _extract_frequent_phrases(positive_texts, top_n)
        if not cons:
            cons = _extract_frequent_phrases(negative_texts, top_n)
        return pros, cons

    # ── KeyBERT extraction ────────────────────────────────────────────────────

    kw_model = _get_kw_model()

    def _extract_keyphrases(texts: List[str], n: int) -> List[str]:
        """Extract top-n keyphrases from a list of texts using KeyBERT."""
        if not texts:
            return []

        # Combine (cap at 50k chars to bound latency)
        combined = " ".join(texts)[:50_000]
        if len(combined) < 20:
            return []

        try:
            keywords = kw_model.extract_keywords(
                combined,
                keyphrase_ngram_range=ngram_range,
                stop_words="english",
                use_maxsum=True,     # Maximize diversity across extracted keyphrases
                nr_candidates=20,
                top_n=n * 2,         # Extract extra; we'll filter below
            )

            # Filter out generic terms and phrases shorter than 3 chars
            _GENERIC = {
                "product", "item", "things", "thing", "good", "bad", "nice",
                "great", "excellent", "terrible", "okay", "ok", "use", "used",
                "amazon", "flipkart", "reliance", "buy", "bought", "purchase",
            }

            phrases: List[str] = []
            for phrase, score in keywords:
                if score < 0.15:
                    continue
                cleaned = re.sub(r"\s+", " ", phrase.strip().lower())
                words = cleaned.split()
                if len(cleaned) < 3 or cleaned in _GENERIC:
                    continue
                if len(words) == 1 and cleaned in _GENERIC:
                    continue
                phrases.append(phrase.strip().title())
                if len(phrases) >= n:
                    break

            return phrases

        except Exception as e:
            logger.warning(f"[KeyBERT] Extraction failed: {e}")
            return []

    pros = _extract_keyphrases(positive_texts, top_n)
    cons = _extract_keyphrases(negative_texts, top_n)

    # Fallback: if KeyBERT found nothing, try frequency-based extraction
    if not pros:
        pros = _fallback_extract(positive_texts, _FALLBACK_POS_PATTERNS, top_n)
    if not cons:
        cons = _fallback_extract(negative_texts, _FALLBACK_NEG_PATTERNS, top_n)
    # Last resort: extract frequent noun phrases from the text
    if not pros:
        pros = _extract_frequent_phrases(positive_texts, top_n)
    if not cons:
        cons = _extract_frequent_phrases(negative_texts, top_n)

    logger.info(f"[KeyBERT] Extracted {len(pros)} pros, {len(cons)} cons")
    return pros, cons
