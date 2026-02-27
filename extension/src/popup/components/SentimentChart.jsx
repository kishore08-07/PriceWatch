/**
 * Sentiment Chart Component
 * Displays sentiment distribution as a bar chart
 */

import React from 'react';

const SentimentChart = ({ distribution, score }) => {
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
                <h3>Overall Sentiment <span className="sentiment-total">({total} reviews)</span></h3>
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
                    <div
                        className="sentiment-segment positive"
                        style={{ width: `${positivePercent}%` }}
                        title={`Positive: ${distribution.positive}`}
                    />
                    <div
                        className="sentiment-segment neutral"
                        style={{ width: `${neutralPercent}%` }}
                        title={`Neutral: ${distribution.neutral}`}
                    />
                    <div
                        className="sentiment-segment negative"
                        style={{ width: `${negativePercent}%` }}
                        title={`Negative: ${distribution.negative}`}
                    />
                </div>
            </div>

            <div className="sentiment-legend">
                <div className="legend-item">
                    <span className="legend-color positive" />
                    <span className="legend-label">
                        Positive ({distribution.positive})
                    </span>
                </div>
                <div className="legend-item">
                    <span className="legend-color neutral" />
                    <span className="legend-label">
                        Neutral ({distribution.neutral})
                    </span>
                </div>
                <div className="legend-item">
                    <span className="legend-color negative" />
                    <span className="legend-label">
                        Negative ({distribution.negative})
                    </span>
                </div>
            </div>
        </div>
    );
};

export default SentimentChart;
