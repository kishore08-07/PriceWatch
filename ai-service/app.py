"""
PriceWatch AI Inference Service — Production Build
====================================================
FastAPI server that runs the full NLP pipeline on customer reviews.
Port: 5001

Pipeline:
  1. Preprocess reviews  (HTML strip, emoji, dedup, spam, language)
  2. Parallel inference:
        BART map-reduce summarization
        DistilBERT primary sentiment
        RoBERTa contextual validation (selective — only low-confidence reviews)
  3. Merge model outputs → structured insights
  4. Extract pros / cons via weighted frequency analysis

Run:
  uvicorn app:app --host 0.0.0.0 --port 5001
"""

import asyncio
import logging
import re
import time
import warnings
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

# Suppress HuggingFace max_length vs input_length warning
warnings.filterwarnings(
    "ignore",
    message=r"Your max_length is set to \d+, but your input_length is only \d+",
)

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from transformers import pipeline as hf_pipeline

from preprocessing import (
    chunk_text_for_bart,
    preprocess_reviews,
    prepare_text_for_summary,
    prepare_texts_for_sentiment,
)
from keyphrase import extract_pros_cons

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
MAX_REVIEWS = 2000                   # Hard cap on input reviews
MAX_REVIEW_CHARS = 5000              # Per-review character limit
ROBERTA_CONFIDENCE_THRESHOLD = 0.65  # Lower threshold => fewer RoBERTa passes, faster latency
SENTIMENT_BATCH_SIZE = 32            # Larger batch for better throughput on CPU
BART_MAX_TOTAL_CHARS = 24_000        # Keep summarization input focused and fast
REQUEST_TIMEOUT_SECS = 300           # 5 minute global timeout

# ── Model registry (lazy-loaded, cached in memory) ───────────────────────────
_models: Dict[str, Any] = {}
_executor = ThreadPoolExecutor(max_workers=4)


def get_model(name: str):
    """Load and cache a HuggingFace pipeline by name. Thread-safe via GIL."""
    if name not in _models:
        if name == "summarizer":
            # philschmid/bart-large-cnn-samsum is fine-tuned on dialogues and
            # conversations, producing far more natural consumer-review-style
            # summaries than the CNN news-domain sshleifer/distilbart-cnn-12-6.
            logger.info("[Model] Loading BART summarizer (bart-large-cnn-samsum)…")
            _models[name] = hf_pipeline(
                "summarization",
                model="philschmid/bart-large-cnn-samsum",
                device=-1,
            )
        elif name == "distilbert":
            logger.info("[Model] Loading DistilBERT sentiment…")
            _models[name] = hf_pipeline(
                "sentiment-analysis",
                model="distilbert-base-uncased-finetuned-sst-2-english",
                device=-1,
                truncation=True,
                max_length=512,
            )
        elif name == "roberta":
            logger.info("[Model] Loading RoBERTa sentiment…")
            _models[name] = hf_pipeline(
                "sentiment-analysis",
                model="cardiffnlp/twitter-roberta-base-sentiment-latest",
                device=-1,
                truncation=True,
                max_length=512,
            )
        logger.info(f"[Model] '{name}' loaded and ready.")
    return _models[name]


# ── Application lifecycle ─────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Pre-load all models at startup to avoid cold-start latency."""
    logger.info("[Startup] Warming up ML models…")
    loop = asyncio.get_event_loop()
    for name in ("distilbert", "roberta", "summarizer"):
        await loop.run_in_executor(_executor, get_model, name)
    logger.info("[Startup] All models ready — accepting requests.")
    yield
    logger.info("[Shutdown] AI service stopping.")


app = FastAPI(
    title="PriceWatch AI Service",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Global error handler ─────────────────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"[Unhandled] {type(exc).__name__}: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": f"Internal server error: {type(exc).__name__}",
            "detail": str(exc)[:500],
        },
    )


# ── Pydantic Schemas ──────────────────────────────────────────────────────────
class ReviewItem(BaseModel):
    text: str
    rating: float = 3.0
    author: str = "Anonymous"
    title: str = ""
    date: str = ""
    helpfulCount: int = 0


class AnalyzeRequest(BaseModel):
    reviews: List[ReviewItem] = Field(..., min_length=1, max_length=MAX_REVIEWS)
    platform: str = "unknown"
    productId: str = ""


class PreprocessingStats(BaseModel):
    total_input: int
    empty_or_short: int
    spam_filtered: int
    language_filtered: int
    duplicates_removed: int
    total_output: int


class AnalyzeResponse(BaseModel):
    success: bool
    summary: str
    pros: List[str]
    cons: List[str]
    sentimentDistribution: Dict[str, Any]
    sentimentScore: int
    totalReviews: int
    totalAnalyzed: int
    preprocessingStats: Optional[PreprocessingStats] = None
    processingTimeMs: int
    modelDetails: Optional[Dict[str, Any]] = None


# ── BART Map-Reduce Summarization ─────────────────────────────────────────────

def _summarize_chunk(chunk: str) -> str:
    """Summarize a single text chunk using BART. Produces concise output."""
    model = get_model("summarizer")
    word_count = len(chunk.split())
    if word_count < 30:
        return chunk

    # Tighter limits to produce concise 4-5 line summaries in general POV
    max_new = min(80, max(25, word_count // 4))
    min_new = max(10, min(20, max_new // 2))
    try:
        result = model(
            chunk,
            max_new_tokens=max_new,
            min_new_tokens=min_new,
            do_sample=False,
            truncation=True,
        )
        return result[0]["summary_text"]
    except Exception as e:
        logger.warning(f"[BART] Chunk summarization failed: {e}")
        sentences = re.split(r"(?<=[.!?])\s+", chunk)
        return sentences[0][:200] if sentences else chunk[:200]


def _map_reduce_summarize(chunks: List[str]) -> str:
    """
    Map phase:  summarize each chunk independently.
    Reduce phase: hierarchically combine chunk summaries until a single summary remains.
    """
    if not chunks:
        return "No review content available for summarization."

    logger.info(f"[BART] Map phase: {len(chunks)} chunk(s)")

    # MAP
    chunk_summaries: List[str] = []
    for i, chunk in enumerate(chunks):
        s = _summarize_chunk(chunk)
        if s:
            chunk_summaries.append(s)
        if (i + 1) % 5 == 0 or i == len(chunks) - 1:
            logger.info(f"   [BART] Map: {i+1}/{len(chunks)} chunks done")

    if not chunk_summaries:
        return "Unable to generate summary from available reviews."
    if len(chunk_summaries) == 1:
        return chunk_summaries[0]

    # HIERARCHICAL REDUCE — keep combining until ≤ 1 summary
    # Target: concise 4-5 line summary in general POV (not first-person)
    logger.info(f"[BART] Reduce phase: combining {len(chunk_summaries)} chunk summaries…")
    while len(chunk_summaries) > 1:
        next_level: List[str] = []
        group_size = 4 if len(chunk_summaries) > 8 else 3
        for i in range(0, len(chunk_summaries), group_size):
            batch_text = " ".join(chunk_summaries[i : i + group_size])
            model = get_model("summarizer")
            wc = len(batch_text.split())
            if wc < 30:
                next_level.append(batch_text)
                continue
            # Tighter reduce limits for concise final summary
            max_new = min(100, max(30, wc // 3))
            min_new = max(10, min(25, max_new // 2))
            try:
                result = model(
                    batch_text,
                    max_new_tokens=max_new,
                    min_new_tokens=min_new,
                    do_sample=False,
                    truncation=True,
                )
                next_level.append(result[0]["summary_text"])
            except Exception as e:
                logger.warning(f"[BART] Reduce step failed: {e}")
                next_level.append(batch_text[:500])
        chunk_summaries = next_level
        logger.info(f"   [BART] Reduce: down to {len(chunk_summaries)} summaries")

    return chunk_summaries[0] if chunk_summaries else "Summary generation failed."


def _clean_summary(summary: str) -> str:
    """
    Post-process BART summary to strip reviewer metadata fragments.
    BART sometimes includes fragments like "Reviewed in India on March 2025",
    "Pixel 10a has 270 ratings and 34 reviews", or "John from Delhi said"
    because the input reviews contain product-page metadata.
    """
    if not summary:
        return summary

    # Patterns to remove from summary
    patterns = [
        # "[Product] has X ratings and Y reviews" / "X ratings" / "Y reviews"
        r"\b[A-Za-z0-9][A-Za-z0-9 ]+\bhas\s+\d[\d,]*\s*(?:ratings?|reviews?)(?:\s+and\s+\d[\d,]*\s*(?:ratings?|reviews?))?\.?",
        # Standalone "X ratings and Y reviews" / "X reviews" / "X ratings"
        r"\b\d[\d,]*\s+(?:global\s+)?(?:customer\s+)?(?:ratings?|reviews?)(?:\s+and\s+\d[\d,]*\s+(?:ratings?|reviews?))?\.?",
        # "Showing X-Y of Z"
        r"\bshowing\s+\d+[\-–]\d+\s+of\s+\d+\.?",
        # "Reviewed in [Country] on [Date]"
        r"\breviewed\s+in\s+[A-Z][a-z]+(?:\s+on\s+[A-Z][a-z]+\s+\d{1,2},?\s*\d{2,4})?\.?",
        # "X out of X stars"
        r"\b\d+(?:\.\d+)?\s*out\s+of\s*\d+\s*stars?\.?",
        # "X people found this helpful"
        r"\b\d+\s+(?:people|person|customer)s?\s+found\s+this\s+(?:helpful|useful)\.?",
        # "One person found this helpful"
        r"\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:people|person|customer)s?\s+found\s+this\s+(?:helpful|useful)\.?",
        # "Verified Purchase" / "Certified Buyer"
        r"\bverified\s+purchase\.?",
        r"\bcertified\s+buyer\.?",
        # Date patterns like "March 15, 2025" or "15 March 2025"
        r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{2,4}\b",
        r"\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{2,4}\b",
        # "from [City], [Country]" reviewer location
        r"\bfrom\s+[A-Z][a-z]+(?:\s*,\s*[A-Z][a-z]+)?\.?",
        # "Report" / "Helpful" standalone
        r"\bReport\b(?=[.\s]|$)",
        r"\bHelpful\b(?=[.\s]|$)",
        # "X days/months/years ago"
        r"\b\d+\s*(?:day|week|month|year)s?\s+ago\.?",
    ]

    for pattern in patterns:
        summary = re.sub(pattern, "", summary, flags=re.IGNORECASE)

    # Drop whole metadata-heavy sentences that survived token-level cleanup.
    sentence_meta_patterns = [
        re.compile(r"\b\d[\d,]*\s+(?:ratings?|reviews?)\b", re.IGNORECASE),
        re.compile(r"\bshowing\s+\d+[\-–]\d+\s+of\s+\d+\b", re.IGNORECASE),
        re.compile(r"\breviewed\s+in\b", re.IGNORECASE),
        re.compile(r"\bverified\s+purchase\b", re.IGNORECASE),
        re.compile(r"\bcertified\s+buyer\b", re.IGNORECASE),
        re.compile(r"\b\d+\s*(?:day|week|month|year)s?\s+ago\b", re.IGNORECASE),
        re.compile(r"\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:people|person|customer)s?\s+found\s+this\b", re.IGNORECASE),
    ]

    sentences = re.split(r"(?<=[.!?])\s+", summary.strip())
    filtered_sentences = []
    for sentence in sentences:
        s = sentence.strip()
        if not s:
            continue
        if any(p.search(s) for p in sentence_meta_patterns):
            continue
        filtered_sentences.append(s)
    if filtered_sentences:
        summary = " ".join(filtered_sentences)

    # Collapse whitespace and clean up leftover punctuation
    summary = re.sub(r"\s{2,}", " ", summary)
    summary = re.sub(r"\s+([.,;])", r"\1", summary)
    summary = re.sub(r"([.,;])\1+", r"\1", summary)
    # Trim leading punctuation/whitespace left after removals
    summary = re.sub(r"^[.,;:\s]+", "", summary)
    return summary.strip()


def _cap_summary_length(summary: str, max_sentences: int = 6) -> str:
    """
    Enforce concise summary output — at most `max_sentences` sentences.
    BART may sometimes produce verbose output; this is the hard backstop
    ensuring the UI displays a tidy 4-5 line summary.
    """
    if not summary:
        return summary

    # Split by sentence-ending punctuation (period, exclamation, question mark)
    sentences = re.split(r"(?<=[.!?])\s+", summary.strip())
    if len(sentences) <= max_sentences:
        return summary

    # Keep the first max_sentences sentences
    capped = " ".join(sentences[:max_sentences])
    # Ensure it ends with proper punctuation
    if not capped.endswith((".", "!", "?")):
        capped += "."
    return capped


def _looks_like_spec_sentence(sentence: str) -> bool:
    """Detect product-spec fragments that should not appear in review summaries."""
    if not sentence:
        return True

    s = sentence.strip().lower()
    if len(s) < 20:
        return True

    unit_hits = len(re.findall(r"\b\d+(?:\.\d+)?\s*(?:mm|cm|inch|inches|hz|mah|mp|gb|tb|w|watt|watts|v|nm)\b", s))
    spec_terms = len(re.findall(r"\b(?:bluetooth|wi-?fi|ipx\d|ram|rom|storage|processor|chipset|display|resolution|camera|battery|refresh rate)\b", s))

    # Mostly numeric spec strings are noisy when summarizing reviews.
    numeric_ratio = sum(ch.isdigit() for ch in s) / max(1, len(s))
    if unit_hits >= 2 or spec_terms >= 3 or numeric_ratio > 0.22:
        return True

    return False


def _build_review_grounded_summary(cleaned_reviews: List[Dict], min_sentences: int = 5, max_sentences: int = 6) -> str:
    """Create a concise extractive fallback summary using real review sentences."""
    candidates: List[str] = []
    seen = set()

    for review in cleaned_reviews:
        text = (review.get("text") or "").strip()
        if not text:
            continue
        parts = re.split(r"(?<=[.!?])\s+", text)
        for part in parts:
            sentence = part.strip()
            if len(sentence.split()) < 6:
                continue
            if _looks_like_spec_sentence(sentence):
                continue
            key = re.sub(r"[^a-z0-9]", "", sentence.lower())[:120]
            if len(key) < 30 or key in seen:
                continue
            seen.add(key)
            if not sentence.endswith((".", "!", "?")):
                sentence += "."
            candidates.append(sentence)
            if len(candidates) >= max_sentences:
                break
        if len(candidates) >= max_sentences:
            break

    if not candidates:
        return "Users report mixed experiences overall, with quality varying across individual usage scenarios."

    # Prefer 5-6 lines when enough data exists.
    if len(candidates) >= min_sentences:
        return " ".join(candidates[:max_sentences])
    return " ".join(candidates)


def _to_general_pov(summary: str) -> str:
    """
    Convert common first-person fragments into a general consumer POV.
    This is a lightweight post-process to keep summary language generic.
    """
    if not summary:
        return summary

    replacements = [
        (r"\bI\b", "Users"),
        (r"\bmy\b", "their"),
        (r"\bme\b", "users"),
        (r"\bwe\b", "Users"),
        (r"\bour\b", "their"),
        (r"\bus\b", "users"),
    ]

    out = summary
    for pattern, repl in replacements:
        out = re.sub(pattern, repl, out, flags=re.IGNORECASE)
    out = re.sub(r"\s{2,}", " ", out).strip()
    return out


def _finalize_summary(summary: str, cleaned_reviews: List[Dict]) -> str:
    """Normalize generated summary and enforce review-grounded 5-6 line output."""
    summary = _clean_summary(summary or "")
    summary = _to_general_pov(summary)

    filtered_sentences = []
    for sentence in re.split(r"(?<=[.!?])\s+", summary.strip()):
        s = sentence.strip()
        if not s:
            continue
        if _looks_like_spec_sentence(s):
            continue
        filtered_sentences.append(s if s.endswith((".", "!", "?")) else f"{s}.")

    summary = " ".join(filtered_sentences)
    summary = _cap_summary_length(summary, max_sentences=6)

    # Ensure at least 5 lines when sufficient review data is present.
    sentence_count = len([s for s in re.split(r"(?<=[.!?])\s+", summary.strip()) if s.strip()])
    if sentence_count < 5 and len(cleaned_reviews) >= 5:
        fallback = _build_review_grounded_summary(cleaned_reviews, min_sentences=5, max_sentences=6)
        if summary:
            merged = f"{summary} {fallback}".strip()
            summary = _cap_summary_length(merged, max_sentences=6)
        else:
            summary = fallback

    if not summary:
        summary = _build_review_grounded_summary(cleaned_reviews, min_sentences=3, max_sentences=5)

    return summary


# ── Sentiment Analysis (DistilBERT + selective RoBERTa) ──────────────────────

def _normalize_label(label: str) -> str:
    """Map model-specific labels → positive / neutral / negative."""
    low = label.lower()
    if low in ("positive", "label_2", "pos"):
        return "positive"
    if low in ("negative", "label_0", "neg"):
        return "negative"
    return "neutral"


def _batch_sentiment(
    model_name: str, texts: List[str], batch_size: int = SENTIMENT_BATCH_SIZE
) -> List[Dict]:
    """Run a HuggingFace sentiment model on texts in batches."""
    model = get_model(model_name)
    results: List[Dict] = []
    total_batches = (len(texts) + batch_size - 1) // batch_size
    logger.info(f"[{model_name}] {len(texts)} texts in {total_batches} batches")

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        batch_num = i // batch_size + 1
        try:
            preds = model(batch)
            for pred in preds:
                results.append({
                    "label": _normalize_label(pred["label"]),
                    "score": round(pred["score"], 4),
                })
        except Exception as e:
            logger.error(f"[{model_name}] Batch {batch_num}/{total_batches} failed: {e}")
            results.extend([{"label": "neutral", "score": 0.5}] * len(batch))

        if batch_num % 5 == 0 or batch_num == total_batches:
            logger.info(f"   [{model_name}] batch {batch_num}/{total_batches}")

    return results


def _selective_roberta(
    texts: List[str],
    distilbert_results: List[Dict],
    confidence_threshold: float = ROBERTA_CONFIDENCE_THRESHOLD,
    batch_size: int = SENTIMENT_BATCH_SIZE,
) -> List[Dict]:
    """
    Run RoBERTa ONLY on reviews where DistilBERT confidence is below threshold.
    This saves ~40-60% of RoBERTa inference time for typical review distributions.
    Returns a full-length list aligned with inputs.
    """
    low_conf_indices = [
        i for i, r in enumerate(distilbert_results) if r["score"] < confidence_threshold
    ]

    if not low_conf_indices:
        logger.info("[RoBERTa] All DistilBERT predictions are high-confidence — skipping RoBERTa entirely")
        return [{"label": "skip", "score": 0.0}] * len(texts)

    logger.info(
        f"[RoBERTa] Selective: {len(low_conf_indices)}/{len(texts)} reviews "
        f"below {confidence_threshold} confidence — running RoBERTa on those"
    )

    low_conf_texts = [texts[i] for i in low_conf_indices]
    roberta_preds = _batch_sentiment("roberta", low_conf_texts, batch_size)

    # Build full result list
    full_results = [{"label": "skip", "score": 0.0}] * len(texts)
    for idx, pred in zip(low_conf_indices, roberta_preds):
        full_results[idx] = pred

    return full_results


def _merge_sentiment(
    distilbert: List[Dict],
    roberta: List[Dict],
) -> List[Dict]:
    """
    Merge DistilBERT (primary) and RoBERTa (contextual validator).
    - If RoBERTa was skipped → use DistilBERT directly.
    - Agreement → use the more confident result.
    - Disagreement → RoBERTa wins if score ≥ 0.75, DistilBERT if ≥ 0.80, else neutral.
    """
    merged: List[Dict] = []
    for db, rb in zip(distilbert, roberta):
        if rb["label"] == "skip":
            # RoBERTa skipped — DistilBERT is high confidence
            merged.append({"label": db["label"], "score": db["score"]})
        elif db["label"] == rb["label"]:
            best = db if db["score"] >= rb["score"] else rb
            merged.append({"label": best["label"], "score": best["score"]})
        else:
            if rb["score"] >= 0.75:
                merged.append({"label": rb["label"], "score": rb["score"]})
            elif db["score"] >= 0.80:
                merged.append({"label": db["label"], "score": db["score"]})
            else:
                merged.append({"label": "neutral", "score": 0.5})
    return merged


def _compute_distribution(merged: List[Dict]) -> Dict[str, Any]:
    """Compute confidence-aware sentiment distribution and a stable 0-100 score."""
    if not merged:
        return {
            "positive": 0,
            "neutral": 0,
            "negative": 0,
            "total": 0,
            "positivePct": 0,
            "neutralPct": 0,
            "negativePct": 0,
            "dominantLabel": "neutral",
            "sentimentScore": 50,
            "polarity": 0.0,
        }

    counts = {"positive": 0, "neutral": 0, "negative": 0}
    pos_weighted = 0.0
    neg_weighted = 0.0

    def _clamp_conf(v: Any) -> float:
        try:
            f = float(v)
        except Exception:
            f = 0.5
        return max(0.0, min(1.0, f))

    for r in merged:
        label = r["label"]
        counts[label] = counts.get(label, 0) + 1
        confidence = _clamp_conf(r.get("score", 0.5))

        if label == "positive":
            pos_weighted += confidence
        elif label == "negative":
            neg_weighted += confidence

    total = len(merged)

    # Neutral reviews should dampen polarity toward 50 but not force bias.
    neutral_damp = 0.35 * counts["neutral"]
    effective_total = max(1e-9, pos_weighted + neg_weighted + neutral_damp)

    polarity = (pos_weighted - neg_weighted) / effective_total  # range roughly [-1, 1]
    sentiment_score = max(0, min(100, int(round(50 + 50 * polarity))))

    positive_pct = int(round((counts["positive"] / total) * 100))
    neutral_pct = int(round((counts["neutral"] / total) * 100))
    negative_pct = max(0, 100 - positive_pct - neutral_pct)

    if counts["positive"] == counts["negative"] and abs(polarity) <= 0.05:
        dominant_label = "neutral"
    elif counts["positive"] > counts["negative"]:
        dominant_label = "positive"
    elif counts["negative"] > counts["positive"]:
        dominant_label = "negative"
    else:
        dominant_label = "neutral"

    return {
        **counts,
        "total": total,
        "positivePct": positive_pct,
        "neutralPct": neutral_pct,
        "negativePct": negative_pct,
        "dominantLabel": dominant_label,
        "sentimentScore": sentiment_score,
        "polarity": round(polarity, 4),
    }


# ── Pros / Cons Extraction ────────────────────────────────────────────────────

_POS_SIGNALS = [
    "excellent", "amazing", "great", "good", "fantastic", "wonderful", "perfect",
    "outstanding", "impressive", "reliable", "durable", "fast", "high quality",
    "build quality", "worth", "easy to use", "convenient", "lightweight",
    "value for money", "highly recommend", "best", "brilliant", "superb",
    "solid", "sturdy", "smooth", "comfortable", "efficient", "premium quality",
    "long battery", "sharp display", "loud speaker", "fast charging",
    "camera quality", "good sound", "nice design", "beautiful", "premium",
]

_NEG_SIGNALS = [
    "bad", "poor", "terrible", "disappointing", "cheap quality", "slow", "breaks",
    "broken", "fails", "useless", "worst", "issue", "problem", "defective",
    "damaged", "not worth", "drawback", "difficult to use", "complicated",
    "overweight", "waste of money", "returned", "overpriced", "flimsy",
    "lags", "overheating", "battery drain", "fragile", "misleading",
    "short battery", "dim display", "low sound", "slow charging",
    "poor camera", "heating issue", "not durable", "bad quality", "noisy",
]


def _extract_pros_cons(
    reviews: List[Dict],
    sentiment: List[Dict],
    top_n: int = 5,
) -> Dict[str, List[str]]:
    """
    Frequency-based pros/cons extraction weighted by review sentiment labels.
    """
    pos_freq: Dict[str, int] = {}
    neg_freq: Dict[str, int] = {}

    for i, review in enumerate(reviews):
        text = review.get("text", "").lower()
        label = sentiment[i]["label"] if i < len(sentiment) else "neutral"

        pos_weight = 2 if label == "positive" else 1
        for phrase in _POS_SIGNALS:
            if phrase in text:
                pos_freq[phrase] = pos_freq.get(phrase, 0) + pos_weight

        neg_weight = 2 if label == "negative" else 1
        for phrase in _NEG_SIGNALS:
            if phrase in text:
                neg_freq[phrase] = neg_freq.get(phrase, 0) + neg_weight

    def fmt(p: str) -> str:
        return " ".join(w.capitalize() for w in p.split())

    pros = [
        fmt(p)
        for p, _ in sorted(pos_freq.items(), key=lambda x: -x[1])
        if pos_freq.get(p, 0) > neg_freq.get(p, 0)
    ][:top_n]

    cons = [
        fmt(p)
        for p, _ in sorted(neg_freq.items(), key=lambda x: -x[1])
        if neg_freq.get(p, 0) > pos_freq.get(p, 0)
    ][:top_n]

    return {"pros": pros, "cons": cons}


# ── API Endpoints ─────────────────────────────────────────────────────────────

@app.get("/health")
def health_check():
    """Health check with model readiness status."""
    return {
        "status": "ok",
        "service": "PriceWatch AI Service",
        "version": "3.0.0",
        "models_loaded": list(_models.keys()),
        "models_expected": ["distilbert", "roberta", "summarizer"],
        "ready": len(_models) >= 3,
    }


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_reviews(request: AnalyzeRequest):
    """
    Full NLP pipeline:
      1. Preprocess reviews (clean, deduplicate, filter spam/language)
      2. Parallel inference: BART summarization + DistilBERT + selective RoBERTa
      3. Merge sentiment → distribution + score
      4. Extract pros / cons
      5. Return structured response
    """
    start = time.time()

    if not request.reviews:
        raise HTTPException(status_code=400, detail="No reviews provided")

    raw_reviews = [r.model_dump() for r in request.reviews]
    total_input = len(raw_reviews)

    logger.info("\n" + "=" * 60)
    logger.info(
        f"📥 /analyze  {total_input} reviews | platform={request.platform} "
        f"| productId={request.productId}"
    )
    logger.info("=" * 60)

    # ── Step 1: Preprocessing ─────────────────────────────────────────────────
    logger.info("🔧 Step 1 — Preprocessing")
    preprocess_start = time.time()

    cleaned_reviews, prep_stats = preprocess_reviews(
        raw_reviews,
        min_length=5,
        max_review_chars=MAX_REVIEW_CHARS,
        filter_spam=True,
        deduplicate=True,
        dedup_threshold=0.85,
        # Only pass English reviews to DistilBERT (SST-2 is English-only).
        # langdetect is already in preprocessing.py with a graceful fallback.
        # Non-English reviews are typically transliterated Roman scripts (Hinglish)
        # that DistilBERT can partially handle, so we use 'unknown' as a fallback
        # language to retain reviews whose language cannot be determined.
        allowed_languages=["en", "unknown"],
    )

    preprocess_ms = int((time.time() - preprocess_start) * 1000)
    logger.info(f"   Preprocessing: {preprocess_ms}ms")
    logger.info(
        f"   {prep_stats['total_input']} → {prep_stats['total_output']} "
        f"(short={prep_stats['empty_or_short']}, spam={prep_stats['spam_filtered']}, "
        f"dedup={prep_stats['duplicates_removed']})"
    )

    if not cleaned_reviews:
        raise HTTPException(
            status_code=422,
            detail="All reviews were filtered out during preprocessing "
            "(too short, spam, or duplicates). Minimum 5 characters required.",
        )

    # Prepare texts
    texts_for_sentiment = prepare_texts_for_sentiment(cleaned_reviews)
    combined_for_summary = prepare_text_for_summary(cleaned_reviews, BART_MAX_TOTAL_CHARS)
    summary_chunks = chunk_text_for_bart(combined_for_summary)

    logger.info(f"   Sentiment texts : {len(texts_for_sentiment)}")
    logger.info(f"   Summary input   : {len(combined_for_summary):,} chars → {len(summary_chunks)} BART chunks")

    if not texts_for_sentiment:
        raise HTTPException(
            status_code=422,
            detail="No reviews with sufficient text for sentiment analysis.",
        )

    # ── Step 2: Parallel Inference ────────────────────────────────────────────
    logger.info("🤖 Step 2 — Parallel inference (BART + DistilBERT + selective RoBERTa)")
    inference_start = time.time()

    loop = asyncio.get_event_loop()

    # Run BART and DistilBERT in parallel
    summary_future = loop.run_in_executor(_executor, _map_reduce_summarize, summary_chunks)
    distilbert_future = loop.run_in_executor(
        _executor, _batch_sentiment, "distilbert", texts_for_sentiment, SENTIMENT_BATCH_SIZE
    )

    try:
        summary, distilbert_results = await asyncio.gather(summary_future, distilbert_future)
        # Post-process summary to remove metadata/spec leakage and keep review-grounded output.
        summary = _finalize_summary(summary, cleaned_reviews)
    except Exception as e:
        logger.error(f"[/analyze] Primary inference error: {e}")
        raise HTTPException(status_code=500, detail=f"Inference failed: {e}")

    # Selective RoBERTa — only for low-confidence DistilBERT results
    try:
        roberta_results = await loop.run_in_executor(
            _executor,
            _selective_roberta,
            texts_for_sentiment,
            distilbert_results,
            ROBERTA_CONFIDENCE_THRESHOLD,
            SENTIMENT_BATCH_SIZE,
        )
    except Exception as e:
        logger.warning(f"[/analyze] RoBERTa failed — using DistilBERT only: {e}")
        roberta_results = [{"label": "skip", "score": 0.0}] * len(texts_for_sentiment)

    inference_ms = int((time.time() - inference_start) * 1000)
    logger.info(f"   Inference total: {inference_ms}ms")

    # ── Step 3: Merge + Structure ─────────────────────────────────────────────
    merged = _merge_sentiment(distilbert_results, roberta_results)
    distribution = _compute_distribution(merged)

    # Extract pros/cons using KeyBERT (product-specific keyphrases from positive
    # and negative review subsets). Falls back to frequency counting if keybert
    # is not installed.
    pros_list, cons_list = extract_pros_cons(cleaned_reviews, top_n=5)

    # For tiny datasets (1-2 reviews), avoid generating synthetic pros/cons.
    # Return what is truly present; UI already handles empty sections gracefully.
    if len(cleaned_reviews) >= 3:
        if not pros_list or not cons_list:
            fallback = _extract_pros_cons(cleaned_reviews, merged, top_n=5)
            if not pros_list:
                pros_list = fallback.get("pros", [])
            if not cons_list:
                cons_list = fallback.get("cons", [])

    pos = distribution["positive"]
    neu = distribution["neutral"]
    neg = distribution["negative"]
    total_s = pos + neu + neg

    elapsed_ms = int((time.time() - start) * 1000)

    # Count how many reviews actually went through RoBERTa
    roberta_count = sum(1 for r in roberta_results if r["label"] != "skip")

    logger.info(f"📊 Step 3 — Results")
    if total_s:
        logger.info(f"   Positive : {pos} ({pos/total_s*100:.1f}%)")
        logger.info(f"   Neutral  : {neu} ({neu/total_s*100:.1f}%)")
        logger.info(f"   Negative : {neg} ({neg/total_s*100:.1f}%)")
    logger.info(f"   Score    : {distribution['sentimentScore']}/100")
    logger.info(f"   Pros: {len(pros_list)}  |  Cons: {len(cons_list)}")
    logger.info(f"   RoBERTa ran on: {roberta_count}/{len(texts_for_sentiment)} reviews")
    logger.info(f"✅ Done in {elapsed_ms}ms  |  summary={len(summary)} chars")
    logger.info("=" * 60 + "\n")

    return AnalyzeResponse(
        success=True,
        summary=summary,
        pros=pros_list,
        cons=cons_list,
        sentimentDistribution={
            "positive": distribution["positive"],
            "neutral": distribution["neutral"],
            "negative": distribution["negative"],
            "total": distribution["total"],
        },
        sentimentScore=distribution["sentimentScore"],
        totalReviews=total_input,
        totalAnalyzed=len(texts_for_sentiment),
        preprocessingStats=PreprocessingStats(**prep_stats),
        processingTimeMs=elapsed_ms,
        modelDetails={
            "distilbert_count": len(distilbert_results),
            "roberta_count": roberta_count,
            "bart_chunks": len(summary_chunks),
            "preprocess_ms": preprocess_ms,
            "inference_ms": inference_ms,
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=5001, reload=False)
