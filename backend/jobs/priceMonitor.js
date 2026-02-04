const Tracking = require('../models/Tracking');
const { checkPriceForTracking } = require('../services/trackingService');
const { SCRAPE_DELAY } = require('../config/constants');

const runPriceMonitor = async () => {
    console.log(`[Cron] ============ Starting scheduled price check at ${new Date().toISOString()} ============`);

    try {
        const trackings = await Tracking.find({ isActive: true });
        console.log(`[Cron] Found ${trackings.length} active price alerts`);

        if (trackings.length === 0) {
            console.log('[Cron] No active alerts to check');
            return;
        }

        // Process alerts sequentially to avoid overwhelming the system
        for (const item of trackings) {
            try {
                await checkPriceForTracking(item);
                // Add a small delay between checks to be respectful to servers
                await new Promise(resolve => setTimeout(resolve, SCRAPE_DELAY));
            } catch (error) {
                console.error(`[Cron] Failed to check ${item.productName}:`, error);
            }
        }

        console.log(`[Cron] ============ Completed scheduled price check ============`);
    } catch (error) {
        console.error('[Cron] Fatal error in scheduled job:', error);
    }
};

module.exports = { runPriceMonitor };
