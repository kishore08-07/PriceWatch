/**
 * useReviewAnalysis Hook — Production Build
 * ===========================================
 * Manages the AI review analysis lifecycle inside the popup.
 *
 * Flow (strictly no direct API calls from popup):
 *   1. Popup calls analyze(url)
 *   2. Hook sends AI_INSIGHTS_REQUEST to the background service worker
 *   3. Background extracts reviews → Node API → Python AI pipeline
 *   4. Background returns the structured result back here
 *   5. Hook updates state → popup renders results
 *
 * Features:
 *   - Debounced duplicate-click prevention
 *   - Progress phase tracking (extracting → analyzing → done)
 *   - Retry support with attempt counter
 *   - Elapsed time tracking
 *   - Cache invalidation
 *   - Graceful error messages
 *
 * Public API:
 *   data          — analysis result (null until complete)
 *   loading       — true while the background is working
 *   error         — string error message (null on success)
 *   fromCache     — true if served from cache
 *   phase         — 'idle' | 'extracting' | 'analyzing' | 'done' | 'error'
 *   elapsedMs     — milliseconds since analysis started
 *   retryCount    — number of retries attempted
 *   analyze(url)  — start analysis
 *   retry()       — retry the last analysis
 *   cancel()      — abort in-progress analysis
 *   reset()       — clear all state
 *   invalidateCache(url) — bust server-side cache
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const NODE_API_BASE = 'http://localhost:8000';

const useReviewAnalysis = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | extracting | analyzing | done | error
  const [elapsedMs, setElapsedMs] = useState(0);
  const [retryCount, setRetryCount] = useState(0);

  const cancelledRef = useRef(false);
  const isAnalyzingRef = useRef(false);
  const lastUrlRef = useRef(null);
  const lastOptionsRef = useRef({});
  const startTimeRef = useRef(0);
  const timerRef = useRef(null);

  // Elapsed-time ticker
  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    setElapsedMs(0);
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 250);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsedMs((prev) => (startTimeRef.current ? Date.now() - startTimeRef.current : prev));
  }, []);

  // ── Main analysis trigger ─────────────────────────────────────────────────

  const analyze = useCallback(
    async (url, options = {}) => {
      if (isAnalyzingRef.current) {
        console.log('[ReviewAnalysis] Already analyzing — ignoring duplicate call');
        return;
      }

      cancelledRef.current = false;
      isAnalyzingRef.current = true;
      lastUrlRef.current = url;
      lastOptionsRef.current = options;

      setLoading(true);
      setError(null);
      setData(null);
      setFromCache(false);
      setPhase('extracting');
      startTimer();

      console.log('[ReviewAnalysis] 🚀 AI_INSIGHTS_REQUEST for:', url);

      try {
        // Phase transitions happen based on timing heuristic:
        // extraction ~2-15s, then analysis takes longer
        const phaseTimer = setTimeout(() => {
          if (!cancelledRef.current) setPhase('analyzing');
        }, 3000);

        const result = await chrome.runtime.sendMessage({
          action: 'AI_INSIGHTS_REQUEST',
          productUrl: url,
          skipCache: options.skipCache || false,
        });

        clearTimeout(phaseTimer);

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
          '[ReviewAnalysis] ✅ score:', result.sentimentScore,
          '| reviews:', result.totalReviews,
          '| analyzed:', result.totalAnalyzed,
          '| cached:', result.fromCache
        );

        setData(result);
        setFromCache(result.fromCache || false);
        setPhase('done');
        setRetryCount(0);
      } catch (err) {
        if (cancelledRef.current) return;

        let msg = err?.message || 'Failed to analyse reviews';

        // Friendly error messages
        if (msg === 'The message port closed before a response was received.') {
          msg = 'Connection lost. The extension was reloaded. Please try again.';
        } else if (msg.includes('ECONNREFUSED') || msg.includes('not running')) {
          msg = 'Backend server is not running. Please start the backend and try again.';
        } else if (msg.includes('circuit is OPEN')) {
          msg = 'AI service is temporarily unavailable. Please wait a moment and retry.';
        } else if (msg.includes('timeout') || msg.includes('Timeout')) {
          msg = 'Analysis took too long. This may happen with very large review sets. Please try again.';
        } else if (msg.includes('No reviews found')) {
          msg = 'No reviews found on this page. Please scroll to the reviews section and try again.';
        }

        console.error('[ReviewAnalysis] ❌ Error:', msg);
        setError(msg);
        setData(null);
        setPhase('error');
      } finally {
        isAnalyzingRef.current = false;
        stopTimer();
        if (!cancelledRef.current) {
          setLoading(false);
        }
      }
    },
    [startTimer, stopTimer]
  );

  // ── Retry ───────────────────────────────────────────────────────────────────

  const retry = useCallback(() => {
    if (!lastUrlRef.current) return;
    setRetryCount((c) => c + 1);
    analyze(lastUrlRef.current, { ...lastOptionsRef.current, skipCache: true });
  }, [analyze]);

  // ── Cancel ──────────────────────────────────────────────────────────────────

  const cancel = useCallback(() => {
    console.log('[ReviewAnalysis] Cancelling…');
    cancelledRef.current = true;
    isAnalyzingRef.current = false;
    stopTimer();
    setLoading(false);
    setPhase('idle');
  }, [stopTimer]);

  // ── Reset ───────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    cancelledRef.current = false;
    isAnalyzingRef.current = false;
    stopTimer();
    setData(null);
    setLoading(false);
    setError(null);
    setFromCache(false);
    setPhase('idle');
    setElapsedMs(0);
    setRetryCount(0);
  }, [stopTimer]);

  // ── Cache invalidation ──────────────────────────────────────────────────────

  const invalidateCache = useCallback(async (url) => {
    try {
      const response = await fetch(`${NODE_API_BASE}/api/reviews/invalidate-cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      return await response.json();
    } catch (err) {
      console.error('[ReviewAnalysis] Cache invalidation failed:', err);
      return null;
    }
  }, []);

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return {
    data,
    loading,
    error,
    fromCache,
    phase,
    elapsedMs,
    retryCount,
    analyze,
    retry,
    cancel,
    reset,
    invalidateCache,
    isAnalyzing: isAnalyzingRef.current,
  };
};

export default useReviewAnalysis;
