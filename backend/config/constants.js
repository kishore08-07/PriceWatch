module.exports = {
    MAX_FAILURES: 5,
    PRICE_CHECK_INTERVAL: '*/5 * * * *', // Every 5 minutes (backend fallback)
    SCRAPE_DELAY: 2000, // 2 seconds between scrapes
    PRICE_BUFFER_PERCENTAGE: 0.02, // 2% buffer for repeat alerts (deprecated - now using state-based)
    SCRAPE_TIMEOUT: 10000, // 10 seconds
    DEFAULT_CURRENCY: '₹',
    
    // Dynamic interval thresholds
    NEAR_TARGET_THRESHOLD: 0.10, // 10% above target
    
    // Monitoring intervals (in minutes)
    INTERVAL_ACTIVE_TAB: 45 / 60,    // 45 seconds (when user is on product page)
    INTERVAL_BACKGROUND: 5,           // 5 minutes (background monitoring)
    INTERVAL_NEAR_TARGET: 2,          // 2 minutes (within 10% of target)
    INTERVAL_POST_ALERT: 15           // 15 minutes (after alert triggered)
};
