/**
 * Timeout guard for async operations
 * Ensures operations don't exceed specified time limits
 */

/**
 * Wrap async function with timeout
 */
const withTimeout = async (asyncFn, timeoutMs = 5000) => {
    return Promise.race([
        asyncFn(),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Operation timeout after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
};

/**
 * Execute async function with timeout and fallback
 */
const withTimeoutFallback = async (asyncFn, fallbackValue, timeoutMs = 5000) => {
    try {
        return await Promise.race([
            asyncFn(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Operation timeout after ${timeoutMs}ms`)), timeoutMs)
            )
        ]);
    } catch (error) {
        if (error.message.includes('timeout')) {
            return fallbackValue;
        }
        throw error;
    }
};

/**
 * Create a cancellable timeout promise
 */
class TimeoutGuard {
    constructor(timeoutMs = 5000) {
        this.timeoutMs = timeoutMs;
        this.abortController = new AbortController();
        this.startTime = Date.now();
        this.isTimedOut = false;

        // Set timeout
        this.timeoutId = setTimeout(() => {
            this.isTimedOut = true;
            this.abortController.abort();
        }, timeoutMs);
    }

    /**
     * Check if time limit exceeded
     */
    isExceeded() {
        return Date.now() - this.startTime > this.timeoutMs;
    }

    /**
     * Get remaining time in ms
     */
    getRemainingMs() {
        const remaining = this.timeoutMs - (Date.now() - this.startTime);
        return Math.max(0, remaining);
    }

    /**
     * Get abort signal for fetch/XMLHttpRequest
     */
    getSignal() {
        return this.abortController.signal;
    }

    /**
     * Cancel/cleanup timeout
     */
    cancel() {
        clearTimeout(this.timeoutId);
        this.isTimedOut = true;
    }

    /**
     * Throw error if timed out
     */
    throwIfTimedOut() {
        if (this.isTimedOut) {
            throw new Error(`Operation timed out after ${this.timeoutMs}ms`);
        }
    }

    /**
     * Execute function with this guard
     */
    async execute(asyncFn) {
        try {
            this.throwIfTimedOut();
            const result = await asyncFn();
            this.throwIfTimedOut();
            this.cancel();
            return result;
        } catch (error) {
            this.cancel();
            throw error;
        }
    }
}

/**
 * Process array with timeout guard for each item
 */
const processBatchWithTimeout = async (items, asyncFn, itemTimeoutMs = 5000, totalTimeoutMs = 30000) => {
    const results = [];
    const errors = [];
    const startTime = Date.now();

    for (let i = 0; i < items.length; i++) {
        // Check total timeout
        if (Date.now() - startTime > totalTimeoutMs) {
            errors.push({
                index: i,
                error: `Batch timeout after ${totalTimeoutMs}ms`,
                processed: i,
                total: items.length
            });
            break;
        }

        const guard = new TimeoutGuard(itemTimeoutMs);

        try {
            const result = await guard.execute(() => asyncFn(items[i], i));
            results.push(result);
        } catch (error) {
            errors.push({
                index: i,
                error: error.message,
                item: items[i]
            });
        }
    }

    return {
        results,
        errors,
        total: items.length,
        processed: results.length,
        failed: errors.length,
        totalTimeMs: Date.now() - startTime
    };
};

/**
 * Race multiple async operations with timeout
 */
const raceWithTimeout = async (promises, timeoutMs = 5000) => {
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Race timeout after ${timeoutMs}ms`)), timeoutMs)
    );

    return Promise.race([...promises, timeoutPromise]);
};

module.exports = {
    withTimeout,
    withTimeoutFallback,
    TimeoutGuard,
    processBatchWithTimeout,
    raceWithTimeout
};
