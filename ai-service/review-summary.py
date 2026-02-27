"""
PriceWatch — BART Review Summarization Module
=============================================
Standalone script for map-reduce summarization of customer reviews.

Model:
  sshleifer/distilbart-cnn-12-6  (DistilBART — fast CPU inference)

Strategy (Map-Reduce):
  1. MAP    — split combined review text into chunks; summarize each chunk.
  2. REDUCE — combine all chunk summaries; summarize again into a final output.

Usage (standalone):
    python review-summary.py

The server app (app.py) contains the same logic inline for performance;
this script serves as an isolated test and reference implementation.
"""

import logging
import re
from typing import List

from transformers import pipeline

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ── Model loading ─────────────────────────────────────────────────────────────
def load_summarizer():
    """Load DistilBART pipeline for CPU-optimised summarization."""
    logger.info("[BART] Loading sshleifer/distilbart-cnn-12-6…")
    model = pipeline(
        "summarization",
        model="sshleifer/distilbart-cnn-12-6",
        device=-1,  # CPU
    )
    logger.info("[BART] Model ready.")
    return model


# ── Chunking ──────────────────────────────────────────────────────────────────
def chunk_text(text: str, max_chars: int = 3200) -> List[str]:
    """
    Split text into sentence-level chunks, each at most `max_chars` characters.
    Ensures chunks fit within BART's token limit.
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
            current = sentence[:max_chars]

    if current:
        chunks.append(current)

    return chunks or [text[:max_chars]]


# ── Chunk summarization ───────────────────────────────────────────────────────
def summarize_chunk(chunk: str, model) -> str:
    """
    Summarize a single text chunk using DistilBART.
    Adapts max_length / min_length proportionally to input length.
    Falls back to the first sentence on model failure.
    """
    word_count = len(chunk.split())
    if word_count < 30:
        return chunk  # Too short to summarize

    max_len = min(100, max(40, word_count // 3))
    min_len = max(20, min(30, max_len - 10))

    try:
        result = model(
            chunk,
            max_length=max_len,
            min_length=min_len,
            do_sample=False,
            truncation=True,
        )
        return result[0]["summary_text"]
    except Exception as e:
        logger.warning(f"[BART] Chunk summarization failed: {e}")
        sentences = re.split(r"(?<=[.!?])\s+", chunk)
        return sentences[0][:200] if sentences else chunk[:200]


# ── Map-Reduce summarization ─────────────────────────────────────────────────
def map_reduce_summarize(chunks: List[str], model=None) -> str:
    """
    Full map-reduce summarization pipeline.

    Map phase  : summarize each chunk independently.
    Reduce phase: summarize the combined chunk summaries.

    Args:
        chunks: List of text chunks (output of chunk_text).
        model : Optional pre-loaded DistilBART pipeline. Loaded if None.

    Returns:
        Single coherent summary string.
    """
    if not chunks:
        return "No review content available for summarization."

    if model is None:
        model = load_summarizer()

    # MAP
    logger.info(f"[BART] Map phase: {len(chunks)} chunk(s)…")
    chunk_summaries = [s for s in (summarize_chunk(c, model) for c in chunks) if s]

    if not chunk_summaries:
        return "Unable to generate summary from available reviews."

    if len(chunk_summaries) == 1:
        return chunk_summaries[0]

    # REDUCE
    logger.info("[BART] Reduce phase: combining chunk summaries…")
    combined = " ".join(chunk_summaries)
    wc = len(combined.split())
    max_len = min(150, max(60, wc // 2))
    min_len = max(30, min(50, max_len - 10))

    try:
        result = model(
            combined,
            max_length=max_len,
            min_length=min_len,
            do_sample=False,
            truncation=True,
        )
        return result[0]["summary_text"]
    except Exception as e:
        logger.warning(f"[BART] Reduce phase failed: {e}")
        return chunk_summaries[0]  # Fallback to best chunk summary


# ── Standalone test ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    sample_reviews = [
        "This product has excellent build quality and amazing performance. "
        "I love how fast it charges and the battery lasts all day.",
        "Terrible experience. The product broke after just one week of use. "
        "Complete waste of money. Customer service was unhelpful.",
        "Decent product for the price. Battery life is good. "
        "Build quality could be better but works as expected.",
        "Highly recommended! Great value for money. "
        "The fast charging feature is outstanding and it's very lightweight.",
        "Poor customer service. Product quality is average. "
        "Expected much better for this price point.",
    ]

    combined_text = " ".join(sample_reviews)
    chunks = chunk_text(combined_text)
    print(f"[Test] {len(chunks)} chunk(s) from {len(sample_reviews)} reviews.")

    model = load_summarizer()
    summary = map_reduce_summarize(chunks, model)

    print(f"\n=== Final Summary ===\n{summary}")
