import { useState, useRef, useCallback } from 'react';

/**
 * usePriceComparison — Hook for cross-site price comparison.
 *
 * Sends PRICE_COMPARISON_REQUEST to background service worker
 * and manages the loading / data / error state for the UI.
 */
const usePriceComparison = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [fromCache, setFromCache] = useState(false);
    const [elapsedMs, setElapsedMs] = useState(0);
    const timerRef = useRef(null);
    const startTimeRef = useRef(null);

    const startTimer = useCallback(() => {
        startTimeRef.current = Date.now();
        timerRef.current = setInterval(() => {
            setElapsedMs(Date.now() - startTimeRef.current);
        }, 500);
    }, []);

    const stopTimer = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (startTimeRef.current) {
            setElapsedMs(Date.now() - startTimeRef.current);
        }
    }, []);

    const compare = useCallback(async (productUrl) => {
        setLoading(true);
        setError(null);
        setData(null);
        setFromCache(false);
        startTimer();

        try {
            const result = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage(
                    { action: 'PRICE_COMPARISON_REQUEST', productUrl },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                            return;
                        }
                        if (!response) {
                            reject(new Error('No response from background service'));
                            return;
                        }
                        if (!response.success) {
                            reject(new Error(response.error || 'Comparison failed'));
                            return;
                        }
                        resolve(response);
                    }
                );
            });

            setData(result);
            setFromCache(result.fromCache || false);
        } catch (err) {
            console.error('[usePriceComparison] Error:', err.message);
            setError(err.message || 'Price comparison failed. Please try again.');
        } finally {
            stopTimer();
            setLoading(false);
        }
    }, [startTimer, stopTimer]);

    const reset = useCallback(() => {
        stopTimer();
        setData(null);
        setError(null);
        setLoading(false);
        setFromCache(false);
        setElapsedMs(0);
    }, [stopTimer]);

    const cancel = useCallback(() => {
        stopTimer();
        setLoading(false);
    }, [stopTimer]);

    return {
        data,
        loading,
        error,
        fromCache,
        elapsedMs,
        compare,
        reset,
        cancel
    };
};

export default usePriceComparison;
