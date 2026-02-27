"""
PriceWatch — Sentiment Analysis Module
=======================================
Standalone script for DistilBERT + RoBERTa sentiment analysis.

Models:
  - DistilBERT: distilbert-base-uncased-finetuned-sst-2-english (primary)
  - RoBERTa   : cardiffnlp/twitter-roberta-base-sentiment-latest (contextual validator)

Merging strategy:
  - Agreement     → use the prediction with higher confidence.
  - Disagreement  → RoBERTa wins if score ≥ 0.75,
                    DistilBERT wins if score ≥ 0.80,
                    otherwise default to neutral.

Usage (standalone):
    python sentiment-analysis.py

The server app (app.py) contains the same logic inline for performance;
this script serves as an isolated test and reference implementation.
"""

import logging
from typing import Any, Dict, List

from transformers import pipeline

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ── Label normalisation ───────────────────────────────────────────────────────
def normalize_label(label: str) -> str:
    """Map model-specific labels to standard: positive / neutral / negative."""
    low = label.lower()
    if low in ("positive", "label_2", "pos"):
        return "positive"
    if low in ("negative", "label_0", "neg"):
        return "negative"
    return "neutral"


# ── DistilBERT ────────────────────────────────────────────────────────────────
def batch_distilbert_sentiment(
    texts: List[str],
    batch_size: int = 16,
) -> List[Dict[str, Any]]:
    """
    Primary sentiment classification using DistilBERT.
    Processes texts in batches of `batch_size` for efficiency.

    Returns:
        List of { label: 'positive'|'neutral'|'negative', score: float }
    """
    logger.info("[DistilBERT] Loading model…")
    model = pipeline(
        "sentiment-analysis",
        model="distilbert-base-uncased-finetuned-sst-2-english",
        device=-1,  # CPU
        truncation=True,
        max_length=512,
    )

    results: List[Dict[str, Any]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i: i + batch_size]
        try:
            preds = model(batch)
            for pred in preds:
                results.append({
                    "label": normalize_label(pred["label"]),
                    "score": round(pred["score"], 4),
                })
        except Exception as e:
            logger.error(f"[DistilBERT] Batch {i // batch_size} failed: {e}")
            results.extend([{"label": "neutral", "score": 0.5}] * len(batch))

    return results


# ── RoBERTa ───────────────────────────────────────────────────────────────────
def batch_roberta_validation(
    texts: List[str],
    batch_size: int = 16,
) -> List[Dict[str, Any]]:
    """
    Contextual sentiment validation using RoBERTa.
    Processes texts in batches of `batch_size` for efficiency.

    Returns:
        List of { label: 'positive'|'neutral'|'negative', score: float }
    """
    logger.info("[RoBERTa] Loading model…")
    model = pipeline(
        "sentiment-analysis",
        model="cardiffnlp/twitter-roberta-base-sentiment-latest",
        device=-1,
        truncation=True,
        max_length=512,
    )

    results: List[Dict[str, Any]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i: i + batch_size]
        try:
            preds = model(batch)
            for pred in preds:
                results.append({
                    "label": normalize_label(pred["label"]),
                    "score": round(pred["score"], 4),
                })
        except Exception as e:
            logger.error(f"[RoBERTa] Batch {i // batch_size} failed: {e}")
            results.extend([{"label": "neutral", "score": 0.5}] * len(batch))

    return results


# ── Merge ─────────────────────────────────────────────────────────────────────
def merge_results(
    distilbert: List[Dict],
    roberta: List[Dict],
) -> List[Dict[str, Any]]:
    """
    Merge per-review predictions from DistilBERT and RoBERTa.
      - Agreement     → use the higher-confidence prediction.
      - Disagreement  → RoBERTa wins if score ≥ 0.75.
                        DistilBERT wins if score ≥ 0.80.
                        Otherwise: neutral.
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


# ── Distribution ──────────────────────────────────────────────────────────────
def compute_distribution(merged: List[Dict]) -> Dict[str, Any]:
    """
    Compute aggregate sentiment distribution and a 0–100 overall sentiment score.

    Returns:
        {
          positive: int, neutral: int, negative: int,
          total: int, sentimentScore: int  # 0 = fully negative, 100 = fully positive
        }
    """
    if not merged:
        return {
            "positive": 0, "neutral": 0, "negative": 0,
            "total": 0, "sentimentScore": 50,
        }

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
    avg = score_sum / total  # range [-1, 1]
    sentiment_score = max(0, min(100, int(round(((avg + 1) / 2) * 100))))
    return {**counts, "total": total, "sentimentScore": sentiment_score}


# ── Standalone test ───────────────────────────────────────────────────────────
if __name__ == "__main__":
    sample_texts = [
        "Excellent build quality and amazing performance. Highly recommend!",
        "Terrible product. Broke after one week. Complete waste of money.",
        "Decent product. Nothing special, but it gets the job done.",
        "Good value for the price. Battery life is impressive.",
        "Very disappointing. Overheating issues and poor customer support.",
    ]

    print("[Test] Running DistilBERT…")
    db_results = batch_distilbert_sentiment(sample_texts)

    print("[Test] Running RoBERTa…")
    rb_results = batch_roberta_validation(sample_texts)

    merged = merge_results(db_results, rb_results)
    dist = compute_distribution(merged)

    print("\n=== Per-review Results ===")
    for i, (text, result) in enumerate(zip(sample_texts, merged)):
        print(f"  {i+1}. [{result['label']:<8} {result['score']:.3f}] {text[:60]}")

    print(f"\n=== Distribution ===")
    print(f"  Positive : {dist['positive']}")
    print(f"  Neutral  : {dist['neutral']}")
    print(f"  Negative : {dist['negative']}")
    print(f"  Score    : {dist['sentimentScore']}/100")
