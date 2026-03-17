"""
PriceWatch AI Inference Service
================================
FastAPI server that runs the full NLP pipeline on customer reviews.
Port: 5001

Pipeline:
  1. Preprocess reviews (clean + chunk)
  2. Parallel: BART map-reduce summarization  +  DistilBERT sentiment  +  RoBERTa validation
  3. Merge model outputs → structured insights

Run:
  uvicorn app:app --host 0.0.0.0 --port 5001
"""

import asyncio
import logging
import re
import time
import unicodedata
import warnings
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Any, Dict, List

# ── Suppress HuggingFace summarization pipeline length warning ────────────────
# When using max_new_tokens the pipeline computes effective_max_length =
# input_tokens + max_new_tokens. Since effective_max_length > input_tokens is
# always true for any max_new_tokens > 0, the "max_length > input_length"
# warning fires on every chunk even though our behaviour is correct.
warnings.filterwarnings(
    'ignore',
    message=r'Your max_length is set to \d+, but your input_length is only \d+',
)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import pipeline

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ── Model registry (lazy-loaded, cached in memory) ───────────────────────────
_models: Dict[str, Any] = {}
_executor = ThreadPoolExecutor(max_workers=3)


def get_model(name: str):
    """Load and cache a HuggingFace pipeline by name."""
    if name not in _models:
        if name == "summarizer":
            logger.info("[Model] Loading DistilBART summarizer…")
            _models[name] = pipeline(
                "summarization",
                model="sshleifer/distilbart-cnn-12-6",
                device=-1,  # CPU
            )
        elif name == "distilbert":
            logger.info("[Model] Loading DistilBERT sentiment…")
            _models[name] = pipeline(
                "sentiment-analysis",
                model="distilbert-base-uncased-finetuned-sst-2-english",
                device=-1,
                truncation=True,
                max_length=512,
            )
        elif name == "roberta":
            logger.info("[Model] Loading RoBERTa sentiment…")
            _models[name] = pipeline(
                "sentiment-analysis",
                model="cardiffnlp/twitter-roberta-base-sentiment-latest",
                device=-1,
                truncation=True,
                max_length=512,
            )
        logger.info(f"[Model] '{name}' ready.")
    return _models[name]


# ── Application lifecycle ─────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Pre-load all models at startup to avoid cold-start latency."""
    logger.info("[Startup] Warming up ML models…")
    loop = asyncio.get_event_loop()
    for name in ("distilbert", "roberta", "summarizer"):
        await loop.run_in_executor(_executor, get_model, name)
    logger.info("[Startup] All models ready.")
    yield


app = FastAPI(
    title="PriceWatch AI Service",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
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
    reviews: List[ReviewItem]
    platform: str = "unknown"
    productId: str = ""


class AnalyzeResponse(BaseModel):
    success: bool
    summary: str
    pros: List[str]
    cons: List[str]
    sentimentDistribution: Dict[str, Any]
    sentimentScore: int
    totalReviews: int
    processingTimeMs: int


# ── Text Preprocessing ────────────────────────────────────────────────────────
def _clean_text(text: str) -> str:
    """Strip HTML, decode entities, normalize unicode, collapse whitespace."""
    if not text or not isinstance(text, str):
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    for entity, char in [
        ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
        ("&quot;", '"'), ("&#39;", "'"), ("&nbsp;", " "),
    ]:
        text = text.replace(entity, char)
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _chunk_for_bart(text: str, max_chars: int = 3200) -> List[str]:
    """
    Split combined review text into sentence-level chunks.
    Each chunk fits within BART's token limit (~4 chars per token, limit ≈ 900 tokens).
    """
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks, current = [], ""
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


def _prepare_for_sentiment(reviews: List[ReviewItem]) -> List[str]:
    """Clean review texts for sentiment models. No artificial truncation."""
    result = []
    for r in reviews:
        t = _clean_text(r.text)
        if len(t) >= 5:
            # Transformer models handle truncation internally via truncation=True
            # Keep full text so we don't lose context
            result.append(t)
    return result


def _prepare_for_summary(reviews: List[ReviewItem], max_total_chars: int = 80_000) -> str:
    """Combine cleaned review texts for BART summarization.

    Caps at max_total_chars (default 80 K) to bound the number of BART chunks
    and keep map-reduce latency under ~60 s even for 1000+ review products.
    Reviews are sorted by rating extremeness (1-star and 5-star first) so the
    most signal-rich content is always included within the cap.
    """
    # Sort by rating extremeness so 1-star / 5-star reviews are included first
    sorted_reviews = sorted(
        reviews,
        key=lambda r: abs(r.rating - 3),
        reverse=True,
    )
    texts = []
    total_chars = 0
    for r in sorted_reviews:
        t = _clean_text(r.text)
        if len(t) < 5:
            continue
        if max_total_chars and total_chars + len(t) > max_total_chars:
            break
        texts.append(t)
        total_chars += len(t) + 1  # +1 for space separator
    return " ".join(texts)


# ── BART Map-Reduce Summarization ─────────────────────────────────────────────
def _summarize_chunk(chunk: str) -> str:
    """Summarize a single text chunk using DistilBART.
    Uses max_new_tokens instead of max_length to avoid the HuggingFace warning
    about max_length exceeding input_length."""
    model = get_model("summarizer")
    word_count = len(chunk.split())
    if word_count < 30:
        return chunk

    # max_new_tokens controls output length only (not input+output),
    # so it never triggers the "max_length > input_length" warning
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
    Map phase  : summarize each chunk independently.
    Reduce phase: summarize all chunk summaries into a final summary.
    Handles large review sets by processing all chunks.
    """
    if not chunks:
        return "No review content available for summarization."

    logger.info(f"[BART] Map phase: {len(chunks)} chunk(s)")
    chunk_summaries = []
    for i, chunk in enumerate(chunks):
        s = _summarize_chunk(chunk)
        if s:
            chunk_summaries.append(s)
        logger.info(f"   chunk {i+1}/{len(chunks)} → {len(s)} chars")

    if not chunk_summaries:
        return "Unable to generate summary from available reviews."
    if len(chunk_summaries) == 1:
        return chunk_summaries[0]

    # For large review sets, do iterative reduction
    logger.info(f"[BART] Reduce phase: combining {len(chunk_summaries)} chunk summaries…")
    
    # If too many chunk summaries, do hierarchical reduction
    while len(chunk_summaries) > 5:
        next_level = []
        for i in range(0, len(chunk_summaries), 4):
            batch = " ".join(chunk_summaries[i:i+4])
            model = get_model("summarizer")
            wc = len(batch.split())
            if wc < 30:
                next_level.append(batch)
                continue
            max_new = min(120, max(40, wc // 3))
            min_new = max(10, min(30, max_new // 2))
            try:
                result = model(
                    batch,
                    max_new_tokens=max_new,
                    min_new_tokens=min_new,
                    do_sample=False,
                    truncation=True,
                )
                next_level.append(result[0]["summary_text"])
            except Exception as e:
                logger.warning(f"[BART] Hierarchical reduce failed: {e}")
                next_level.append(batch[:500])
        chunk_summaries = next_level
    
    combined = " ".join(chunk_summaries)
    model = get_model("summarizer")
    wc = len(combined.split())

    # If the combined text is already short, return directly
    if wc < 40:
        return combined

    max_new = min(150, max(40, wc // 2))
    min_new = max(15, min(35, max_new // 2))
    try:
        result = model(
            combined,
            max_new_tokens=max_new,
            min_new_tokens=min_new,
            do_sample=False,
            truncation=True,
        )
        return result[0]["summary_text"]
    except Exception as e:
        logger.warning(f"[BART] Reduce failed: {e}")
        return chunk_summaries[0]


# ── DistilBERT + RoBERTa Sentiment ───────────────────────────────────────────
def _normalize_label(label: str) -> str:
    """Map model-specific labels → positive / neutral / negative."""
    low = label.lower()
    if low in ("positive", "label_2", "pos"):
        return "positive"
    if low in ("negative", "label_0", "neg"):
        return "negative"
    return "neutral"


def _batch_sentiment(model_name: str, texts: List[str], batch_size: int = 16) -> List[Dict]:
    """Run a HuggingFace sentiment model on texts in batches."""
    model = get_model(model_name)
    results = []
    total_batches = (len(texts) + batch_size - 1) // batch_size
    logger.info(f"[{model_name}] Sentiment: {len(texts)} texts in {total_batches} batches")
    for i in range(0, len(texts), batch_size):
        batch = texts[i: i + batch_size]
        batch_num = i // batch_size + 1
        try:
            preds = model(batch)
            for pred in preds:
                results.append({
                    "label": _normalize_label(pred["label"]),
                    "score": pred["score"],
                })
            logger.info(f"   [{model_name}] batch {batch_num}/{total_batches} done — {len(results)}/{len(texts)} total")
        except Exception as e:
            logger.error(f"[{model_name}] Batch {batch_num} failed: {e}")
            results.extend([{"label": "neutral", "score": 0.5}] * len(batch))
    return results


def _merge_sentiment(
    distilbert: List[Dict], roberta: List[Dict]
) -> List[Dict]:
    """
    Merge DistilBERT (primary) and RoBERTa (contextual validator) predictions.
    - Agreement     → use the more confident result.
    - Disagreement  → RoBERTa wins if score ≥ 0.75, DistilBERT if score ≥ 0.80, else neutral.
    """
    merged = []
    for db, rb in zip(distilbert, roberta):
        if db["label"] == rb["label"]:
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


def _compute_distribution(merged: List[Dict]) -> Dict:
    """Compute sentiment distribution and a 0–100 sentiment score."""
    if not merged:
        return {"positive": 0, "neutral": 0, "negative": 0, "total": 0, "sentimentScore": 50}

    counts: Dict[str, int] = {"positive": 0, "neutral": 0, "negative": 0}
    score_sum = 0.0
    for r in merged:
        label = r["label"]
        counts[label] = counts.get(label, 0) + 1
        if label == "positive":
            score_sum += r["score"]
        elif label == "negative":
            score_sum -= r["score"]
        # neutral contributes 0

    total = len(merged)
    avg = score_sum / total  # in [-1, 1]
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
]

_NEG_SIGNALS = [
    "bad", "poor", "terrible", "disappointing", "cheap quality", "slow", "breaks",
    "broken", "fails", "useless", "worst", "issue", "problem", "defective",
    "damaged", "not worth", "drawback", "difficult to use", "complicated",
    "overweight", "waste of money", "returned", "overpriced", "flimsy",
    "lags", "overheating", "battery drain", "fragile", "misleading",
    "short battery", "dim display", "low sound", "slow charging",
]


def _extract_pros_cons(
    reviews: List[ReviewItem],
    sentiment: List[Dict],
    top_n: int = 5,
) -> Dict[str, List[str]]:
    """
    Frequency-based pros/cons extraction weighted by review sentiment labels.
    Positive reviews boost positive signals; negative reviews boost negative signals.
    """
    pos_freq: Dict[str, int] = {}
    neg_freq: Dict[str, int] = {}

    for i, review in enumerate(reviews):
        text = review.text.lower()
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

    # A phrase is a pro if its positive frequency exceeds its negative frequency
    pros = [
        fmt(p)
        for p, _ in sorted(pos_freq.items(), key=lambda x: -x[1])
        if pos_freq[p] > neg_freq.get(p, 0)
    ][:top_n]

    cons = [
        fmt(p)
        for p, _ in sorted(neg_freq.items(), key=lambda x: -x[1])
        if neg_freq[p] > pos_freq.get(p, 0)
    ][:top_n]

    return {"pros": pros, "cons": cons}


# ── API Endpoints ─────────────────────────────────────────────────────────────
@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "PriceWatch AI Service",
        "models_loaded": list(_models.keys()),
    }


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_reviews(request: AnalyzeRequest):
    """
    Full NLP pipeline:
      1. Preprocess reviews (clean + chunk for BART, truncate for sentiment models)
      2. Parallel inference: BART summarization  +  DistilBERT  +  RoBERTa
      3. Merge sentiment predictions → distribution + score
      4. Extract pros / cons via frequency analysis
      5. Return structured InsightsResponse
    """
    start = time.time()

    if not request.reviews:
        raise HTTPException(status_code=400, detail="No reviews provided")

    reviews = request.reviews
    logger.info("\n" + "=" * 55)
    logger.info(f"📥 /analyze  {len(reviews)} reviews | platform={request.platform} | productId={request.productId}")
    logger.info("=" * 55)

    # ── Preprocessing ─────────────────────────────────────────────────────────
    texts_for_sentiment = _prepare_for_sentiment(reviews)
    combined_for_summary = _prepare_for_summary(reviews)
    summary_chunks = _chunk_for_bart(combined_for_summary)

    logger.info(f"🔧 Step 1 — Preprocessing")
    logger.info(f"   Reviews received    : {len(reviews)}")
    logger.info(f"   Sentiment texts     : {len(texts_for_sentiment)} (≥5 chars)")
    skipped_sentiment = len(reviews) - len(texts_for_sentiment)
    if skipped_sentiment:
        logger.info(f"   Skipped (too short) : {skipped_sentiment}")
    logger.info(f"   Summary input       : {len(combined_for_summary):,} chars → {len(summary_chunks)} BART chunks")
    logger.info(f"   Est. BART time      : ~{len(summary_chunks) * 3}–{len(summary_chunks) * 6}s (CPU)")

    if not texts_for_sentiment:
        raise HTTPException(
            status_code=422,
            detail="All reviews are too short or empty after cleaning (minimum 5 characters).",
        )

    logger.info(f"🤖 Step 2 — Parallel inference (BART + DistilBERT + RoBERTa)")

    # ── Parallel Inference ────────────────────────────────────────────────────
    loop = asyncio.get_event_loop()

    summary_future = loop.run_in_executor(
        _executor, _map_reduce_summarize, summary_chunks
    )
    distilbert_future = loop.run_in_executor(
        _executor, _batch_sentiment, "distilbert", texts_for_sentiment, 16
    )
    roberta_future = loop.run_in_executor(
        _executor, _batch_sentiment, "roberta", texts_for_sentiment, 16
    )

    try:
        summary, distilbert_results, roberta_results = await asyncio.gather(
            summary_future, distilbert_future, roberta_future
        )
    except Exception as e:
        logger.error(f"[/analyze] Inference error: {e}")
        raise HTTPException(status_code=500, detail=f"Inference failed: {e}")

    # ── Merge + Structure ─────────────────────────────────────────────────────
    merged = _merge_sentiment(distilbert_results, roberta_results)
    distribution = _compute_distribution(merged)
    pros_cons = _extract_pros_cons(reviews, merged, top_n=5)

    pos = distribution['positive']
    neu = distribution['neutral']
    neg = distribution['negative']
    total_sentiment = pos + neu + neg

    elapsed_ms = int((time.time() - start) * 1000)
    logger.info(f"📊 Step 3 — Sentiment merge ({total_sentiment} reviews)")
    logger.info(f"   Positive : {pos}  ({pos/total_sentiment*100:.1f}%)" if total_sentiment else "   Positive : 0")
    logger.info(f"   Neutral  : {neu}  ({neu/total_sentiment*100:.1f}%)" if total_sentiment else "   Neutral  : 0")
    logger.info(f"   Negative : {neg}  ({neg/total_sentiment*100:.1f}%)" if total_sentiment else "   Negative : 0")
    logger.info(f"   Score    : {distribution['sentimentScore']} / 100")
    logger.info(f"📝 Step 4 — Pros/Cons  |  pros={len(pros_cons['pros'])}  cons={len(pros_cons['cons'])}")
    logger.info(f"✅ Done in {elapsed_ms}ms  |  summary={len(summary)} chars")
    logger.info("=" * 55 + "\n")

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
        totalReviews=len(reviews),
        processingTimeMs=elapsed_ms,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=5001, reload=False)
