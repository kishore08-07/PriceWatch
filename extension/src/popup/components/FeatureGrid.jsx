import React, { useState } from 'react';
import Icons from '../../shared/components/Icons';
import useReviewAnalysis from '../hooks/useReviewAnalysis';
import usePriceComparison from '../hooks/usePriceComparison';
import ReviewSummaryTable from './ReviewSummaryTable';
import SentimentChart from './SentimentChart';
import PriceComparisonTable from './PriceComparisonTable';

/**
 * FeatureGrid — Production Build
 * Renders the feature cards and the full-screen review analysis overlay.
 *
 * Enhancements over v1:
 *  • Skeleton loading state with phase indicator & progress bar
 *  • Elapsed time counter while loading
 *  • Retry button with attempt counter
 *  • Refresh (re-analyse bypassing cache) action
 *  • Processing time in the result footer
 *  • Cross-site price comparison
 */

const PHASE_LABELS = {
    extracting: 'Extracting reviews from the page…',
    analyzing: 'Running AI sentiment & summary pipeline…',
    done: 'Analysis complete',
    error: 'Analysis failed',
    idle: '',
};

const formatElapsed = (ms) => {
    if (ms < 1000) return 'just started';
    const secs = Math.round(ms / 1000);
    return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
};

const FeatureGrid = ({ product }) => {
    const [showReviewPanel, setShowReviewPanel] = useState(false);
    const [showComparisonPanel, setShowComparisonPanel] = useState(false);
    const reviewAnalysis = useReviewAnalysis();
    const priceComparison = usePriceComparison();

    const handleAIInsightsClick = async () => {
        if (!product?.url) return;
        if (reviewAnalysis.loading) return;

        setShowReviewPanel(true);
        await reviewAnalysis.analyze(product.url);
    };

    const handlePriceComparisonClick = async () => {
        if (!product?.url) return;
        if (priceComparison.loading) return;

        setShowComparisonPanel(true);
        await priceComparison.compare(product.url);
    };

    const handleRefresh = async () => {
        if (!product?.url || reviewAnalysis.loading) return;
        await reviewAnalysis.invalidateCache(product.url);
        await reviewAnalysis.analyze(product.url, { skipCache: true });
    };

    const handleCloseReviewPanel = () => {
        reviewAnalysis.cancel();
        reviewAnalysis.reset();
        setShowReviewPanel(false);
    };

    const handleCloseComparisonPanel = () => {
        priceComparison.cancel();
        priceComparison.reset();
        setShowComparisonPanel(false);
    };

    const handleRetryComparison = async () => {
        if (!product?.url) return;
        await priceComparison.compare(product.url);
    };

    const { data, loading, error, fromCache, phase, elapsedMs, retryCount } = reviewAnalysis;

    return (
        <>
            <section className="features-grid">
                <button
                    className="feature-item glass feature-btn"
                    onClick={handlePriceComparisonClick}
                    disabled={!product || priceComparison.loading}
                    title="Compare prices across Amazon, Flipkart & Reliance Digital"
                    id="price-comparison-btn"
                >
                    <div className="feature-icon">
                        <Icons.BarChart />
                    </div>
                    <div className="feature-content">
                        <span className="feature-title">
                            {priceComparison.loading ? 'Comparing…' : 'Price Comparison'}
                        </span>
                        <span className="feature-desc">Cross-platform analysis</span>
                    </div>
                </button>
                <button
                    className="feature-item glass feature-btn"
                    onClick={handleAIInsightsClick}
                    disabled={!product || loading}
                    title="Analyze customer reviews with AI"
                    id="ai-insights-btn"
                >
                    <div className="feature-icon">
                        <Icons.Sparkles />
                    </div>
                    <div className="feature-content">
                        <span className="feature-title">
                            {loading ? 'Analyzing…' : 'AI Insights'}
                        </span>
                        <span className="feature-desc">Smart review summary</span>
                    </div>
                </button>
            </section>

            {/* Price Comparison Overlay */}
            {showComparisonPanel && (
                <PriceComparisonTable
                    data={priceComparison.data}
                    loading={priceComparison.loading}
                    error={priceComparison.error}
                    fromCache={priceComparison.fromCache}
                    elapsedMs={priceComparison.elapsedMs}
                    onRetry={handleRetryComparison}
                    onClose={handleCloseComparisonPanel}
                />
            )}

            {showReviewPanel && (
                <div className="review-panel-overlay">
                    <div className="review-panel">

                        {/* ── Loading / Skeleton ────────────────────────── */}
                        {loading && (
                            <div className="loading-state">
                                <div className="spinner-lg" />

                                <p className="loading-phase-label">
                                    {PHASE_LABELS[phase] || 'Processing…'}
                                </p>

                                {/* Progress bar */}
                                <div className="progress-bar-track">
                                    <div
                                        className={`progress-bar-fill ${phase}`}
                                        style={{
                                            width: phase === 'extracting' ? '35%' :
                                                phase === 'analyzing' ? '75%' : '10%',
                                        }}
                                    />
                                </div>

                                {/* Phase dots */}
                                <div className="phase-indicator">
                                    <span className={`phase-dot ${phase === 'extracting' || phase === 'analyzing' ? 'active' : ''} ${phase === 'analyzing' ? 'complete' : ''}`} />
                                    <span className="phase-connector" />
                                    <span className={`phase-dot ${phase === 'analyzing' ? 'active' : ''}`} />
                                </div>
                                <div className="phase-labels">
                                    <span className={phase === 'extracting' ? 'active' : ''}>Extract</span>
                                    <span className={phase === 'analyzing' ? 'active' : ''}>Analyze</span>
                                </div>

                                <span className="loading-subtext">
                                    Elapsed: {formatElapsed(elapsedMs)}
                                </span>

                                {/* Skeleton placeholders */}
                                <div className="skeleton-group" aria-hidden="true">
                                    <div className="skeleton-line w80" />
                                    <div className="skeleton-line w60" />
                                    <div className="skeleton-line w90" />
                                    <div className="skeleton-bar" />
                                </div>

                                <button className="btn btn-sm btn-ghost" onClick={handleCloseReviewPanel}>
                                    Cancel
                                </button>
                            </div>
                        )}

                        {/* ── Error ─────────────────────────────────────── */}
                        {error && !loading && (
                            <div className="error-state">
                                <Icons.AlertCircle size={24} />
                                <p>{error}</p>
                                {retryCount > 0 && (
                                    <span className="retry-count-label">
                                        Attempt {retryCount + 1}
                                    </span>
                                )}
                                <div className="error-actions">
                                    <button className="btn btn-sm btn-primary" onClick={() => reviewAnalysis.retry()}>
                                        Retry
                                    </button>
                                    <button className="btn btn-sm" onClick={handleCloseReviewPanel}>
                                        Dismiss
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ── Results ───────────────────────────────────── */}
                        {data && !loading && (
                            <div className="analysis-results">
                                <div className="results-header">
                                    <h3>AI Review Analysis</h3>
                                    <div className="results-header-actions">
                                        <button
                                            className="btn btn-sm btn-ghost"
                                            onClick={handleRefresh}
                                            title="Re-analyse (bypass cache)"
                                            aria-label="Refresh"
                                        >
                                            <Icons.RefreshCw />
                                        </button>
                                        <button
                                            className="close-btn"
                                            onClick={handleCloseReviewPanel}
                                            aria-label="Close"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                </div>

                                {/* Meta badges */}
                                <div className="analysis-meta">
                                    {data.platform && (
                                        <span className="platform-tag">
                                            {data.platform === 'amazon' ? 'Amazon' :
                                                data.platform === 'flipkart' ? 'Flipkart' :
                                                    data.platform === 'reliancedigital' ? 'Reliance Digital' :
                                                        data.platform}
                                        </span>
                                    )}

                                    {fromCache && (
                                        <span className="cache-badge">Cached</span>
                                    )}
                                </div>

                                <SentimentChart
                                    distribution={data.sentimentDistribution}
                                    score={data.sentimentScore}
                                    noReviewsFound={data.noReviewsFound}
                                />

                                <ReviewSummaryTable
                                    pros={data.pros}
                                    cons={data.cons}
                                    summary={data.summary}
                                />

                                {/* Footer with timing */}
                                <div className="processing-time">
                                    {data.processingTimeMs != null && (
                                        <span>AI pipeline: {(data.processingTimeMs / 1000).toFixed(1)}s</span>
                                    )}
                                    {elapsedMs > 0 && (
                                        <span> · Total: {formatElapsed(elapsedMs)}</span>
                                    )}
                                    {data.modelDetails && (
                                        <span className="model-details-label">
                                            {' '}· {data.modelDetails.summarizer} + {data.modelDetails.sentimentPrimary}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

export default FeatureGrid;
