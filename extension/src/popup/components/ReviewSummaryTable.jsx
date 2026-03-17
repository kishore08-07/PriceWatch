/**
 * Review Summary Table Component — Production Build
 * Displays AI-generated summary, pros/cons, and preprocessing stats.
 */

import React from 'react';

const ReviewSummaryTable = ({
    pros,
    cons,
    summary,
    totalReviews,
    totalAnalyzed,
    preprocessingStats,
}) => {
    const displayCount = totalAnalyzed || totalReviews;

    return (
        <div className="review-summary-table">
            {/* Summary section */}
            {summary && (
                <div className="summary-section">
                    <h3>
                        Summary
                        {displayCount != null && (
                            <span className="summary-count">
                                ({displayCount} review{displayCount !== 1 ? 's' : ''} analysed)
                            </span>
                        )}
                    </h3>
                    <p className="summary-text">{summary}</p>
                </div>
            )}

            {/* Pros & Cons */}
            <div className="pros-cons-container">
                <div className="pros-section">
                    <h3>
                        <span className="pros-icon">✓</span>
                        Pros
                    </h3>
                    {pros && pros.length > 0 ? (
                        <ul className="pros-list">
                            {pros.map((pro, idx) => (
                                <li key={idx} className="pros-item">
                                    <span className="pros-bullet">+</span>
                                    {pro}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="no-items">No positive aspects found</p>
                    )}
                </div>

                <div className="cons-section">
                    <h3>
                        <span className="cons-icon">✕</span>
                        Cons
                    </h3>
                    {cons && cons.length > 0 ? (
                        <ul className="cons-list">
                            {cons.map((con, idx) => (
                                <li key={idx} className="cons-item">
                                    <span className="cons-bullet">−</span>
                                    {con}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="no-items">No negative aspects found</p>
                    )}
                </div>
            </div>

            {/* Preprocessing stats (shown as subtle footer) */}
            {preprocessingStats && (
                <div className="preprocessing-stats">
                    <span title="Reviews received from scraper">
                        Input: {preprocessingStats.inputCount ?? '–'}
                    </span>
                    <span className="stat-sep">·</span>
                    <span title="After dedup, spam removal, lang filter">
                        Cleaned: {preprocessingStats.outputCount ?? '–'}
                    </span>
                    {preprocessingStats.duplicatesRemoved > 0 && (
                        <>
                            <span className="stat-sep">·</span>
                            <span title="Near-duplicate reviews removed">
                                Deduped: {preprocessingStats.duplicatesRemoved}
                            </span>
                        </>
                    )}
                    {preprocessingStats.spamRemoved > 0 && (
                        <>
                            <span className="stat-sep">·</span>
                            <span title="Spam / low-quality reviews removed">
                                Spam: {preprocessingStats.spamRemoved}
                            </span>
                        </>
                    )}
                    {preprocessingStats.nonEnglishRemoved > 0 && (
                        <>
                            <span className="stat-sep">·</span>
                            <span title="Non-English reviews filtered">
                                Non-EN: {preprocessingStats.nonEnglishRemoved}
                            </span>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default ReviewSummaryTable;
