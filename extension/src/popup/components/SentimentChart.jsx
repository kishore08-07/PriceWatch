/**
 * Sentiment Chart Component — Production Build
 * Displays sentiment distribution as a bar chart with count labels and
 * an overall sentiment score badge.
 */

import React from 'react';

const SentimentChart = ({ distribution, score, totalAnalyzed }) => {
    if (!distribution) {
        return null;
    }

    const total = distribution.total || 1;
    const positivePercent = (distribution.positive / total) * 100;
    const neutralPercent = (distribution.neutral / total) * 100;
    const negativePercent = (distribution.negative / total) * 100;

    // Determine sentiment label and color
    let sentimentLabel = 'Neutral';
    let sentimentColor = '#fbbf24';

    if (score > 60) {
        sentimentLabel = 'Positive';
        sentimentColor = '#10b981';
    } else if (score < 40) {
        sentimentLabel = 'Negative';
        sentimentColor = '#ef4444';
    }

    // sentimentScore from Python is already 0–100
    const scorePercent = Math.round(Math.max(0, Math.min(100, score)));

    return (
        <div className="sentiment-chart">
            <div className="sentiment-header">
                <h3>
                    Overall Sentiment
                    {totalAnalyzed != null && (
                        <span className="sentiment-total">
                            ({totalAnalyzed} review{totalAnalyzed !== 1 ? 's' : ''})
                        </span>
                    )}
                </h3>
                <div className="sentiment-score">
                    <span
                        className="sentiment-badge"
                        style={{ backgroundColor: sentimentColor }}
                    >
                        {sentimentLabel}
                    </span>
                    <span className="sentiment-percentage">{scorePercent}%</span>
                </div>
            </div>

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
        </div>
    );
};

export default SentimentChart;
