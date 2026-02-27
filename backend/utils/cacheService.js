/**
 * Cache service with TTL support
 * Stores analysis results for quick retrieval
 */

// In-memory cache store
const cacheStore = new Map();

/**
 * Generate cache key from platform and product ID
 */
const generateCacheKey = (platform, productId) => {
    if (!platform || !productId) return null;
    return `${platform}:${productId}`;
};

/**
 * Set cache value with TTL
 */
const setCache = (key, value, ttlMs = 6 * 60 * 60 * 1000) => {
    if (!key) return false;

    const expiresAt = Date.now() + ttlMs;

    cacheStore.set(key, {
        value,
        expiresAt,
        createdAt: Date.now(),
        ttlMs
    });

    return true;
};

/**
 * Get cache value if not expired
 */
const getCache = (key) => {
    if (!key) return null;

    const cached = cacheStore.get(key);

    if (!cached) {
        return null;
    }

    // Check if expired
    if (Date.now() > cached.expiresAt) {
        cacheStore.delete(key);
        return null;
    }

    return cached.value;
};

/**
 * Check if cache key exists and is valid
 */
const hasCache = (key) => {
    if (!key) return false;

    const cached = cacheStore.get(key);

    if (!cached) {
        return false;
    }

    // Check if expired
    if (Date.now() > cached.expiresAt) {
        cacheStore.delete(key);
        return false;
    }

    return true;
};

/**
 * Delete cache entry
 */
const deleteCache = (key) => {
    if (!key) return false;
    return cacheStore.delete(key);
};

/**
 * Clear all cache
 */
const clearAllCache = () => {
    cacheStore.clear();
};

/**
 * Invalidate cache for a product
 */
const invalidateProduct = (platform, productId) => {
    const key = generateCacheKey(platform, productId);
    return deleteCache(key);
};

/**
 * Get cache statistics
 */
const getCacheStats = () => {
    let validCount = 0;
    let expiredCount = 0;
    let totalMemory = 0;

    cacheStore.forEach((cached, key) => {
        if (Date.now() > cached.expiresAt) {
            expiredCount++;
            cacheStore.delete(key);
        } else {
            validCount++;
            totalMemory += JSON.stringify(cached.value).length;
        }
    });

    return {
        validEntries: validCount,
        expiredEntries: expiredCount,
        totalEntries: cacheStore.size,
        approximateMemoryBytes: totalMemory,
        approximateMemoryMB: (totalMemory / 1024 / 1024).toFixed(2)
    };
};

/**
 * Clean up expired entries
 */
const cleanupExpired = () => {
    let cleaned = 0;
    const now = Date.now();

    cacheStore.forEach((cached, key) => {
        if (now > cached.expiresAt) {
            cacheStore.delete(key);
            cleaned++;
        }
    });

    return cleaned;
};

/**
 * Get cache with metadata
 */
const getCacheWithMetadata = (key) => {
    if (!key) return null;

    const cached = cacheStore.get(key);

    if (!cached) {
        return null;
    }

    // Check if expired
    if (Date.now() > cached.expiresAt) {
        cacheStore.delete(key);
        return null;
    }

    return {
        value: cached.value,
        createdAt: cached.createdAt,
        expiresAt: cached.expiresAt,
        ttlMs: cached.ttlMs,
        ageMs: Date.now() - cached.createdAt,
        remainingTtlMs: cached.expiresAt - Date.now()
    };
};

/**
 * List all valid cache keys
 */
const getAllCacheKeys = () => {
    const keys = [];
    const now = Date.now();

    cacheStore.forEach((cached, key) => {
        if (now <= cached.expiresAt) {
            keys.push(key);
        }
    });

    return keys;
};

module.exports = {
    generateCacheKey,
    setCache,
    getCache,
    hasCache,
    deleteCache,
    clearAllCache,
    invalidateProduct,
    getCacheStats,
    cleanupExpired,
    getCacheWithMetadata,
    getAllCacheKeys
};
