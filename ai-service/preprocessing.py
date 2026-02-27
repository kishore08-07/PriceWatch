"""
PriceWatch — Text Preprocessing Module
=======================================
Utilities for cleaning and preparing customer review text before NLP inference.
Can be imported by app.py or run standalone for testing.
"""

import re
import unicodedata
from typing import Dict, List


def clean_text(text: str) -> str:
    """
    Clean a single review text:
      - Remove HTML tags
      - Decode common HTML entities
      - Normalize unicode (NFKC)
      - Strip control characters
      - Collapse whitespace
    """
    if not text or not isinstance(text, str):
        return ""

    # Remove HTML tags
    text = re.sub(r"<[^>]+>", " ", text)

    # Decode common HTML entities
    for entity, char in [
        ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
        ("&quot;", '"'), ("&#39;", "'"), ("&nbsp;", " "),
    ]:
        text = text.replace(entity, char)

    # Unicode normalization
    text = unicodedata.normalize("NFKC", text)

    # Remove control characters (keep newline \n and tab \t as spaces)
    text = re.sub(r"[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]", "", text)

    # Collapse whitespace
    text = re.sub(r"\s+", " ", text)

    return text.strip()


def chunk_text_for_bart(text: str, max_chars: int = 3200) -> List[str]:
    """
    Split combined review text into sentence-level chunks suitable for BART.
    BART's token limit is ~1024 tokens (≈ 4 chars/token → ~4096 chars).
    We use 3200 chars per chunk for safety.

    Returns a list of non-empty string chunks.
    """
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: List[str] = []
    current = ""

    for sentence in sentences:
        if len(current) + len(sentence) + 1 <= max_chars:
            current = (current + " " + sentence).strip()
        else:
            if current:
                chunks.append(current)
            # If a single sentence exceeds max_chars, truncate it
            current = sentence[:max_chars]

    if current:
        chunks.append(current)

    return chunks or [text[:max_chars]]


def prepare_reviews_for_sentiment(reviews: List[Dict]) -> List[str]:
    """
    Clean and truncate review texts for sentiment classification models.
    Filters out reviews shorter than 20 characters after cleaning.
    Truncates each review to 2048 chars (safely within 512-token limits).

    Args:
        reviews: List of dicts with at least a 'text' key.

    Returns:
        List of cleaned, truncated strings.
    """
    result = []
    for r in reviews:
        t = clean_text(r.get("text", ""))
        if len(t) >= 20:
            result.append(t[:2048])
    return result


def prepare_reviews_for_summary(
    reviews: List[Dict],
    max_total_chars: int = 50000,
) -> str:
    """
    Combine all cleaned review texts into a single document for BART summarization.
    Stops adding texts once max_total_chars is reached to stay within model limits.

    Args:
        reviews: List of dicts with at least a 'text' key.
        max_total_chars: Hard limit on total characters.

    Returns:
        Single space-joined string of all accepted review texts.
    """
    texts: List[str] = []
    total = 0

    for r in reviews:
        t = clean_text(r.get("text", ""))
        if len(t) >= 20 and total + len(t) < max_total_chars:
            texts.append(t)
            total += len(t)

    return " ".join(texts)


# ── Standalone test ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    sample = [
        {
            "text": "<b>Great product!</b> &amp; amazing quality. Very fast delivery.",
            "rating": 5,
        },
        {
            "text": "Poor build quality. It broke after just 2 weeks of use.",
            "rating": 1,
        },
        {
            "text": "Decent product, nothing special. Works as expected.",
            "rating": 3,
        },
    ]

    print("=== Sentiment input ===")
    for t in prepare_reviews_for_sentiment(sample):
        print(f"  • {t}")

    print("\n=== Summary input ===")
    combined = prepare_reviews_for_summary(sample)
    print(combined)

    print("\n=== BART chunks (max_chars=80 for demo) ===")
    for i, chunk in enumerate(chunk_text_for_bart(combined, max_chars=80)):
        print(f"  Chunk {i + 1}: {chunk}")
