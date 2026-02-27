import React, { useState } from 'react';
import Icons from '../../shared/components/Icons';
import useReviewAnalysis from '../hooks/useReviewAnalysis';
import ReviewSummaryTable from './ReviewSummaryTable';
import SentimentChart from './SentimentChart';

const FeatureGrid = ({ product }) => {
    const [showReviewPanel, setShowReviewPanel] = useState(false);
    const reviewAnalysis = useReviewAnalysis();

    const handleAIInsightsClick = async () => {
        if (!product?.url) return;

        if (reviewAnalysis.loading) return;

        setShowReviewPanel(true);
        await reviewAnalysis.analyze(product.url);
    };

    const handleCloseReviewPanel = () => {
        reviewAnalysis.cancel();
        reviewAnalysis.reset();
        setShowReviewPanel(false);
    };

    return (
        <>
            <section className="features-grid">
                <div className="feature-item glass">
                    <div className="feature-icon">
                        <Icons.BarChart />
                    </div>
                    <div className="feature-content">
                        <span className="feature-title">Price Comparison</span>
                        <span className="feature-desc">Cross-platform analysis</span>
                    </div>
                </div>
                <button
                    className="feature-item glass feature-btn"
                    onClick={handleAIInsightsClick}
                    disabled={!product || reviewAnalysis.loading}
                    title="Analyze customer reviews with AI"
                >
                    <div className="feature-icon">
                        <Icons.Sparkles />
                    </div>
                    <div className="feature-content">
                        <span className="feature-title">
                            {reviewAnalysis.loading ? 'Analyzing...' : 'AI Insights'}
                        </span>
                        <span className="feature-desc">Smart review summary</span>
                    </div>
                </button>
            </section>

            {showReviewPanel && (
                <div className="review-panel-overlay">
                    <div className="review-panel">
                        {reviewAnalysis.loading && (
                            <div className="loading-state">
                                <div className="spinner-lg" />
                                <p>Extracting and analyzing all reviews...</p>
                                <span className="loading-subtext">
                                    Navigating review pages, extracting all reviews, and running AI analysis.
                                    This may take a moment for products with many reviews.
                                </span>
                            </div>
                        )}

                        {reviewAnalysis.error && !reviewAnalysis.loading && (
                            <div className="error-state">
                                <Icons.AlertCircle size={24} />
                                <p>{reviewAnalysis.error}</p>
                                <div className="error-actions">
                                    <button className="btn btn-sm btn-primary" onClick={handleAIInsightsClick}>
                                        Retry
                                    </button>
                                    <button className="btn btn-sm" onClick={handleCloseReviewPanel}>
                                        Dismiss
                                    </button>
                                </div>
                            </div>
                        )}

                        {reviewAnalysis.data && !reviewAnalysis.loading && (
                            <div className="analysis-results">
                                <div className="results-header">
                                    <h3>AI Review Analysis</h3>
                                    <button
                                        className="close-btn"
                                        onClick={handleCloseReviewPanel}
                                        aria-label="Close"
                                    >
                                        ✕
                                    </button>
                                </div>

                                <div className="analysis-meta">
                                    {reviewAnalysis.data.platform && (
                                        <span className="platform-tag">
                                            {reviewAnalysis.data.platform === 'amazon' ? 'Amazon' :
                                             reviewAnalysis.data.platform === 'flipkart' ? 'Flipkart' :
                                             reviewAnalysis.data.platform === 'reliancedigital' ? 'Reliance Digital' :
                                             reviewAnalysis.data.platform}
                                        </span>
                                    )}
                                    {reviewAnalysis.data.totalScraped > 0 && (
                                        <span className="review-count-badge">
                                            {reviewAnalysis.data.totalScraped} reviews scraped
                                        </span>
                                    )}
                                    {reviewAnalysis.fromCache && (
                                        <span className="cache-badge">Cached</span>
                                    )}
                                </div>

                                <SentimentChart
                                    distribution={reviewAnalysis.data.sentimentDistribution}
                                    score={reviewAnalysis.data.sentimentScore}
                                />

                                <ReviewSummaryTable
                                    pros={reviewAnalysis.data.pros}
                                    cons={reviewAnalysis.data.cons}
                                    summary={reviewAnalysis.data.summary}
                                    totalReviews={reviewAnalysis.data.totalReviews}
                                    totalScraped={reviewAnalysis.data.totalScraped}
                                />

                                {reviewAnalysis.data.processingTimeMs && (
                                    <div className="processing-time">
                                        Analyzed {reviewAnalysis.data.totalReviews} of {reviewAnalysis.data.totalScraped || reviewAnalysis.data.totalReviews} reviews in {(reviewAnalysis.data.pipelineTimeMs / 1000).toFixed(1)}s
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

export default FeatureGrid;
