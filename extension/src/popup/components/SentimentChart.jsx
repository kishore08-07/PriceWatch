/**
 * Sentiment Chart Component — Production Build
 * Displays sentiment distribution as a bar chart with count labels and
 * an overall sentiment score badge.
 *
 * Handles edge case: when no reviews are found (total === 0 or
 * noReviewsFound flag), shows "N/A" instead of misleading scores.
 */

import React from 'react';

const SentimentChart = ({ distribution, score, noReviewsFound }) => {
    if (!distribution) {
        return null;
    }

    const total = distribution.total || 0;
    const hasReviews = total > 0 && !noReviewsFound;

    const positivePercent = hasReviews ? (distribution.positive / total) * 100 : 0;
    const neutralPercent = hasReviews ? (distribution.neutral / total) * 100 : 0;
    const negativePercent = hasReviews ? (distribution.negative / total) * 100 : 0;

    const marginRatio = hasReviews ? Math.abs(distribution.positive - distribution.negative) / total : 0;
    const dominantFromDist = distribution.dominantLabel;

    // Determine sentiment label and color from the same distribution used in bars.
    // This prevents badge-vs-bar mismatches.
    let sentimentLabel = 'Neutral';
    let sentimentColor = '#fbbf24';

    if (!hasReviews) {
        sentimentLabel = 'N/A';
        sentimentColor = '#6b7280'; // gray
    } else {
        let normalizedDominant = typeof dominantFromDist === 'string' ? dominantFromDist.toLowerCase() : '';

        if (!normalizedDominant) {
            if (distribution.positive > distribution.negative) normalizedDominant = 'positive';
            else if (distribution.negative > distribution.positive) normalizedDominant = 'negative';
            else normalizedDominant = 'neutral';
        }

        // If pos/neg are very close, show Neutral even if one side is slightly larger.
        if (marginRatio < 0.08) {
            normalizedDominant = 'neutral';
        }

        if (normalizedDominant === 'positive') {
            sentimentLabel = 'Positive';
            sentimentColor = '#10b981';
        } else if (normalizedDominant === 'negative') {
            sentimentLabel = 'Negative';
            sentimentColor = '#ef4444';
        }
    }

    // sentimentScore from Python is already 0–100
    const scorePercent = hasReviews ? Math.round(Math.max(0, Math.min(100, score))) : 0;

    return (
        <div className="sentiment-chart">
            <div className="sentiment-header">
                <h3>Overall Sentiment</h3>
                <div className="sentiment-score">
                    <span
                        className="sentiment-badge"
                        style={{ backgroundColor: sentimentColor }}
                    >
                        {sentimentLabel}
                    </span>
                    {hasReviews && (
                        <span className="sentiment-percentage">{scorePercent}%</span>
                    )}
                </div>
            </div>

            {hasReviews ? (
                <>
                    <div className="sentiment-bar-container">
                        <div className="sentiment-bar">
                            {positivePercent > 0 && (
                                <div
                                    className="sentiment-segment positive"
                                    style={{ width: `${positivePercent}%` }}
                                    title={`Positive: ${distribution.positive} (${positivePercent.toFixed(1)}%)`}
                                />
                            )}
                            {neutralPercent > 0 && (
                                <div
                                    className="sentiment-segment neutral"
                                    style={{ width: `${neutralPercent}%` }}
                                    title={`Neutral: ${distribution.neutral} (${neutralPercent.toFixed(1)}%)`}
                                />
                            )}
                            {negativePercent > 0 && (
                                <div
                                    className="sentiment-segment negative"
                                    style={{ width: `${negativePercent}%` }}
                                    title={`Negative: ${distribution.negative} (${negativePercent.toFixed(1)}%)`}
                                />
                            )}
                        </div>
                    </div>

                    <div className="sentiment-legend">
                        <div className="legend-item">
                            <span className="legend-color positive" />
                            <span className="legend-label">
                                Positive ({distribution.positive} · {positivePercent.toFixed(0)}%)
                            </span>
                        </div>
                        <div className="legend-item">
                            <span className="legend-color neutral" />
                            <span className="legend-label">
                                Neutral ({distribution.neutral} · {neutralPercent.toFixed(0)}%)
                            </span>
                        </div>
                        <div className="legend-item">
                            <span className="legend-color negative" />
                            <span className="legend-label">
                                Negative ({distribution.negative} · {negativePercent.toFixed(0)}%)
                            </span>
                        </div>
                    </div>
                </>
            ) : (
                <p className="no-reviews-sentiment">No reviews analyzed — sentiment data unavailable.</p>
            )}
        </div>
    );
};

export default SentimentChart;
