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

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
MAX_REVIEWS = 2000                   # Hard cap on input reviews
MAX_REVIEW_CHARS = 5000              # Per-review character limit
ROBERTA_CONFIDENCE_THRESHOLD = 0.80  # Only run RoBERTa for DistilBERT scores below this
SENTIMENT_BATCH_SIZE = 16            # Batch size for sentiment models
BART_MAX_TOTAL_CHARS = 80_000       # Total chars cap for summarization
REQUEST_TIMEOUT_SECS = 300           # 5 minute global timeout

# ── Model registry (lazy-loaded, cached in memory) ───────────────────────────
_models: Dict[str, Any] = {}
_executor = ThreadPoolExecutor(max_workers=4)


def get_model(name: str):
    """Load and cache a HuggingFace pipeline by name. Thread-safe via GIL."""
    if name not in _models:
        if name == "summarizer":
            logger.info("[Model] Loading DistilBART summarizer…")
            _models[name] = hf_pipeline(
                "summarization",
                model="sshleifer/distilbart-cnn-12-6",
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
    """Summarize a single text chunk using DistilBART."""
    model = get_model("summarizer")
    word_count = len(chunk.split())
    if word_count < 30:
        return chunk

    max_new = min(120, max(30, word_count // 3))
    min_new = max(10, min(25, max_new // 2))
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
            max_new = min(150, max(40, wc // 2))
            min_new = max(15, min(35, max_new // 2))
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
    """Compute sentiment distribution and a 0–100 sentiment score."""
    if not merged:
        return {"positive": 0, "neutral": 0, "negative": 0, "total": 0, "sentimentScore": 50}

    counts = {"positive": 0, "neutral": 0, "negative": 0}
    score_sum = 0.0
    for r in merged:
        label = r["label"]
        counts[label] = counts.get(label, 0) + 1
        if label == "positive":
            score_sum += r["score"]
        elif label == "negative":
            score_sum -= r["score"]

    total = len(merged)
    avg = score_sum / total  # range [-1, 1]
    sentiment_score = max(0, min(100, int(round(((avg + 1) / 2) * 100))))
    return {**counts, "total": total, "sentimentScore": sentiment_score}


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
    pros_cons = _extract_pros_cons(cleaned_reviews, merged, top_n=5)

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
    logger.info(f"   Pros: {len(pros_cons['pros'])}  |  Cons: {len(pros_cons['cons'])}")
    logger.info(f"   RoBERTa ran on: {roberta_count}/{len(texts_for_sentiment)} reviews")
    logger.info(f"✅ Done in {elapsed_ms}ms  |  summary={len(summary)} chars")
    logger.info("=" * 60 + "\n")

    return AnalyzeResponse(
        success=True,
        summary=summary,
        pros=pros_cons["pros"],
        cons=pros_cons["cons"],
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
