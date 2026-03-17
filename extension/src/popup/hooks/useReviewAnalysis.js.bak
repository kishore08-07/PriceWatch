/**
 * useReviewAnalysis Hook
 * ======================
 * Manages the AI review analysis lifecycle inside the popup.
 *
 * Flow (strictly no direct API calls from the popup):
 *   1. Popup calls analyze(url)
 *   2. Hook sends AI_INSIGHTS_REQUEST to the background service worker
 *   3. Background extracts reviews from the active tab (content script)
 *      then calls the Node API → Python AI pipeline
 *   4. Background returns the structured result back here
 *   5. Hook updates state → popup renders results
 *
 * Public API:
 *   data        — analysis result (null until complete)
 *   loading     — true while the background is working
 *   error       — string error message (null on success)
 *   fromCache   — true if the result was served from cache
 *   analyze(url, options?) — start analysis
 *   cancel()    — abort in-progress analysis
 *   reset()     — clear all state
 *   invalidateCache(url) — bust server-side cache for a URL
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const NODE_API_BASE = 'http://localhost:8000';

const useReviewAnalysis = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [fromCache, setFromCache] = useState(false);

    // Cancellation flag — set to true when the user closes the panel mid-flight
    const cancelledRef = useRef(false);
    const isAnalyzingRef = useRef(false);

    // ── Main analysis trigger ─────────────────────────────────────────────────

    /**
     * Start AI review analysis for a product URL.
     * Delegates all heavy lifting to the background service worker.
     *
     * @param {string} url         Product page URL
     * @param {Object} [options]
     * @param {boolean} [options.skipCache=false] Force fresh analysis
     */
    const analyze = useCallback(async (url, options = {}) => {
        if (isAnalyzingRef.current) {
            console.log('[ReviewAnalysis] Already analyzing — ignoring duplicate call');
            return;
        }

        cancelledRef.current = false;
        isAnalyzingRef.current = true;

        setLoading(true);
        setError(null);
        setData(null);
        setFromCache(false);

        console.log('[ReviewAnalysis] 🚀 Sending AI_INSIGHTS_REQUEST to background for:', url);

        try {
            // Ask the background service worker to orchestrate the full pipeline:
            //   Tab content script → Node API → Python ML → result
            const result = await chrome.runtime.sendMessage({
                action: 'AI_INSIGHTS_REQUEST',
                productUrl: url,
                skipCache: options.skipCache || false,
            });

            // If the user cancelled while we were waiting, silently exit
            if (cancelledRef.current) {
                console.log('[ReviewAnalysis] Result discarded — user cancelled');
                return;
            }

            if (!result) {
                throw new Error('No response from background service. Please try again.');
            }

            if (!result.success) {
                throw new Error(result.error || result.message || 'Analysis failed');
            }

            console.log(
                '[ReviewAnalysis] ✅ Success — score:', result.sentimentScore,
                '| reviews:', result.totalReviews,
                '| cached:', result.fromCache
            );

            setData(result);
            setFromCache(result.fromCache || false);
        } catch (err) {
            if (cancelledRef.current) return; // Ignore errors after cancel

            const msg =
                err?.message === 'The message port closed before a response was received.'
                    ? 'Connection lost. Please try again.'
                    : err?.message || 'Failed to analyse reviews';

            console.error('[ReviewAnalysis] ❌ Error:', msg);
            setError(msg);
            setData(null);
        } finally {
            isAnalyzingRef.current = false;
            if (!cancelledRef.current) {
                setLoading(false);
            }
            console.log('[ReviewAnalysis] 🏁 Analysis finished');
        }
    }, []);

    // ── Cancel ────────────────────────────────────────────────────────────────

    /**
     * Cancel an in-progress analysis.
     * The background request cannot be aborted (Chrome messaging has no cancel),
     * but we discard the result and reset loading state immediately.
     */
    const cancel = useCallback(() => {
        console.log('[ReviewAnalysis] Cancelling…');
        cancelledRef.current = true;
        isAnalyzingRef.current = false;
        setLoading(false);
    }, []);

    // ── Reset ─────────────────────────────────────────────────────────────────

    /** Reset all state to the initial idle state. */
    const reset = useCallback(() => {
        console.log('[ReviewAnalysis] Resetting state');
        cancelledRef.current = false;
        isAnalyzingRef.current = false;
        setData(null);
        setLoading(false);
        setError(null);
        setFromCache(false);
    }, []);

    // ── Cache invalidation ────────────────────────────────────────────────────

    /**
     * Bust the server-side cache for a specific product URL.
     * @param {string} url
     * @returns {Promise<Object|null>}
     */
    const invalidateCache = useCallback(async (url) => {
        try {
            console.log('[ReviewAnalysis] Invalidating cache for:', url);
            const response = await fetch(`${NODE_API_BASE}/api/reviews/invalidate-cache`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
            const result = await response.json();
            console.log('[ReviewAnalysis] Cache invalidated:', result);
            return result;
        } catch (err) {
            console.error('[ReviewAnalysis] Cache invalidation failed:', err);
            return null;
        }
    }, []);

    // ── Cleanup ───────────────────────────────────────────────────────────────

    useEffect(() => {
        return () => {
            cancelledRef.current = true;
        };
    }, []);

    return {
        data,
        loading,
        error,
        fromCache,
        analyze,
        cancel,
        reset,
        invalidateCache,
        isAnalyzing: isAnalyzingRef.current,
    };
};

export default useReviewAnalysis;

