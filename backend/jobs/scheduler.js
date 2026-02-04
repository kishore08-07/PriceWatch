const cron = require('node-cron');
const { runPriceMonitor } = require('./priceMonitor');
const { PRICE_CHECK_INTERVAL } = require('../config/constants');

const startScheduler = () => {
    // Schedule price checks every 5 minutes (backend fallback monitoring)
    // Extension handles more frequent checks for active tabs
    cron.schedule(PRICE_CHECK_INTERVAL, runPriceMonitor);
    console.log(`[Scheduler] Backend price monitoring scheduled: ${PRICE_CHECK_INTERVAL}`);
    console.log('[Scheduler] Note: Extension handles active tab monitoring (45s) and dynamic intervals');
};

module.exports = { startScheduler };
