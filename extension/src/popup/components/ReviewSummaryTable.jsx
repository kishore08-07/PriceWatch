/**
 * Review Summary Table Component
 * Displays pros and cons in a tabular format
 */

import React from 'react';

const ReviewSummaryTable = ({ pros, cons, summary, totalReviews, totalScraped }) => {
    const maxItems = Math.max(pros?.length || 0, cons?.length || 0);
    const displayCount = totalScraped || totalReviews;

    return (
        <div className="review-summary-table">
            {summary && (
                <div className="summary-section">
                    <h3>Summary {displayCount ? <span className="summary-count">(from {displayCount} reviews)</span> : null}</h3>
                    <p className="summary-text">{summary}</p>
                </div>
            )}

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
        </div>
    );
};

export default ReviewSummaryTable;
