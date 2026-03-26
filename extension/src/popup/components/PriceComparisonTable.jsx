import React from 'react';
import Icons from '../../shared/components/Icons';

/**
 * PriceComparisonTable — Overlay panel showing cross-site price comparison results.
 *
 * Displays a comparison table with platform, price, availability, and product link.
 * Highlights the cheapest price and marks the current (source) platform.
 */

const formatElapsed = (ms) => {
    if (ms < 1000) return 'just started';
    const secs = Math.round(ms / 1000);
    return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
};

const formatPrice = (price) => {
    if (price === null || price === undefined) return '—';
    return `₹${price.toLocaleString('en-IN')}`;
};

const getPriceDeltaLabel = (candidatePrice, currentPrice) => {
    if (candidatePrice == null || currentPrice == null || currentPrice <= 0) return null;
    if (candidatePrice === currentPrice) {
        return { text: 'Same price', kind: 'same' };
    }

    const deltaPct = Math.round((Math.abs(candidatePrice - currentPrice) / currentPrice) * 100);
    if (candidatePrice < currentPrice) {
        return { text: `${deltaPct}% cheaper`, kind: 'cheaper' };
    }
    return { text: `${deltaPct}% higher`, kind: 'higher' };
};

const PriceComparisonTable = ({
    data,
    loading,
    error,
    fromCache,
    elapsedMs,
    onRetry,
    onClose
}) => {
    const results = data?.results || [];
    const currentResult = results.find(r => r.isCurrent);
    const currentPrice = currentResult?.price ?? null;

    // Find cheapest price (excluding null prices and the current platform)
    const validPrices = results.filter(r => r.price != null);
    const cheapestPrice = validPrices.length > 0
        ? Math.min(...validPrices.map(r => r.price))
        : null;

    return (
        <div className="comparison-panel-overlay" id="price-comparison-overlay">
            <div className="comparison-panel">

                {/* ── Loading State ──────────────────────────────────── */}
                {loading && (
                    <div className="loading-state">
                        <div className="spinner-lg" />
                        <p className="loading-phase-label">
                            Searching across platforms…
                        </p>
                        <div className="progress-bar-track">
                            <div
                                className="progress-bar-fill analyzing"
                                style={{ width: '60%' }}
                            />
                        </div>
                        <span className="loading-subtext">
                            Elapsed: {formatElapsed(elapsedMs)}
                        </span>

                        <div className="skeleton-group" aria-hidden="true">
                            <div className="skeleton-line w80" />
                            <div className="skeleton-line w60" />
                            <div className="skeleton-line w90" />
                        </div>

                        <button className="btn btn-sm btn-ghost" onClick={onClose}>
                            Cancel
                        </button>
                    </div>
                )}

                {/* ── Error State ────────────────────────────────────── */}
                {error && !loading && (
                    <div className="error-state">
                        <Icons.AlertCircle size={24} />
                        <p>{error}</p>
                        <div className="error-actions">
                            <button className="btn btn-sm btn-primary" onClick={onRetry}>
                                Retry
                            </button>
                            <button className="btn btn-sm" onClick={onClose}>
                                Dismiss
                            </button>
                        </div>
                    </div>
                )}

                {/* ── Results ────────────────────────────────────────── */}
                {data && !loading && (
                    <div className="comparison-results">
                        <div className="results-header">
                            <h3>Price Comparison</h3>
                            <div className="results-header-actions">
                                <button
                                    className="close-btn"
                                    onClick={onClose}
                                    aria-label="Close"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>

                        {/* Meta badges */}
                        <div className="analysis-meta">
                            {fromCache && (
                                <span className="cache-badge">Cached</span>
                            )}
                            {data.comparedAt && (
                                <span className="comparison-time-badge">
                                    {new Date(data.comparedAt).toLocaleTimeString('en-IN', {
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    })}
                                </span>
                            )}
                        </div>

                        {/* Comparison Table */}
                        <div className="comparison-table-wrapper">
                            <table className="comparison-table" id="price-comparison-table">
                                <thead>
                                    <tr>
                                        <th>Platform</th>
                                        <th>Price</th>
                                        <th>Availability</th>
                                        <th>Link</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.map((item, index) => {
                                        const isCheapest = item.price != null && item.price === cheapestPrice;
                                        const isOutOfStock = item.availability === 'Out of Stock' ||
                                            item.availability === 'Not Found' ||
                                            item.availability === 'Error';
                                        const hasError = item.error && !item.price;
                                        const delta = !item.isCurrent
                                            ? getPriceDeltaLabel(item.price, currentPrice)
                                            : null;

                                        return (
                                            <tr
                                                key={`${item.platform}-${index}`}
                                                className={`comparison-row ${isCheapest ? 'cheapest' : ''} ${isOutOfStock ? 'out-of-stock' : ''}`}
                                                id={`comparison-row-${item.platform?.toLowerCase().replace(/\s+/g, '-')}`}
                                            >
                                                <td className="platform-cell">
                                                    <span className="comparison-platform-name">
                                                        {item.platform}
                                                    </span>
                                                    {item.isCurrent && (
                                                        <span className="current-badge">Current</span>
                                                    )}
                                                    {delta && (
                                                        <span className={`price-delta-badge ${delta.kind}`}>
                                                            {delta.text}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className={`price-cell ${isCheapest ? 'price-cheapest' : ''}`}>
                                                    {hasError ? (
                                                        <span className="price-error" title={item.error}>—</span>
                                                    ) : (
                                                        formatPrice(item.price)
                                                    )}
                                                </td>
                                                <td>
                                                    <span className={`availability-badge ${isOutOfStock ? 'availability-out-of-stock' : 'availability-in-stock'}`}>
                                                        {item.availability || 'Unknown'}
                                                    </span>
                                                </td>
                                                <td>
                                                    {item.url ? (
                                                        <a
                                                            href={item.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="view-link"
                                                            id={`view-link-${item.platform?.toLowerCase().replace(/\s+/g, '-')}`}
                                                        >
                                                            View
                                                        </a>
                                                    ) : (
                                                        <span className="no-link">—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Savings summary */}
                        {validPrices.length >= 2 && (
                            <div className="savings-summary">
                                {(() => {
                                    if (currentPrice && cheapestPrice && cheapestPrice < currentPrice) {
                                        const savings = currentPrice - cheapestPrice;
                                        const cheapestPlatform = results.find(r => r.price === cheapestPrice)?.platform;
                                        return (
                                            <span className="savings-text">
                                                💰 Save <strong>{formatPrice(savings)}</strong> on {cheapestPlatform}!
                                            </span>
                                        );
                                    }
                                    if (currentPrice && currentPrice === cheapestPrice) {
                                        return (
                                            <span className="savings-text best-price">
                                                ✅ You're already getting the best price!
                                            </span>
                                        );
                                    }
                                    return null;
                                })()}
                            </div>
                        )}

                        {/* Footer */}
                        <div className="processing-time">
                            {data.processingTimeMs != null && (
                                <span>Search: {(data.processingTimeMs / 1000).toFixed(1)}s</span>
                            )}
                            {elapsedMs > 0 && (
                                <span> · Total: {formatElapsed(elapsedMs)}</span>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PriceComparisonTable;
