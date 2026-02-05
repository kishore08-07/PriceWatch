const Tracking = require('../models/Tracking');
const { scrapeProductPrice } = require('./scrapingService');
const { sendPushNotification } = require('./notificationService');
const { MAX_FAILURES, PRICE_BUFFER_PERCENTAGE, DEFAULT_CURRENCY } = require('../config/constants');

const createOrUpdateTracking = async (trackingData) => {
    const { userEmail, url, productName, currentPrice, targetPrice, platform, image, currency } = trackingData;

    // Check if alert already exists for this user + product URL
    const existingTracking = await Tracking.findOne({ userEmail, url });

    if (existingTracking) {
        // Update existing alert instead of creating duplicate
        existingTracking.productName = productName || existingTracking.productName;
        existingTracking.currentPrice = currentPrice || existingTracking.currentPrice;
        existingTracking.targetPrice = targetPrice;
        existingTracking.platform = platform || existingTracking.platform;
        existingTracking.image = image || existingTracking.image;
        existingTracking.currency = currency || existingTracking.currency;
        existingTracking.isActive = true;
        existingTracking.updatedAt = new Date();

        // Reset notification status if target price changed
        if (existingTracking.notified && !existingTracking.repeatAlerts) {
            existingTracking.notified = false;
            existingTracking.notifiedAt = null;
            existingTracking.lastNotifiedPrice = null;
        }

        await existingTracking.save();
        console.log(`[Backend] Updated existing alert for ${productName} for ${userEmail}`);

        return {
            tracking: existingTracking,
            message: "Price alert updated successfully"
        };
    }

    // Create new tracking entry
    const newTracking = new Tracking({
        userEmail,
        productName,
        currentPrice,
        targetPrice,
        url,
        platform,
        image,
        currency: currency || DEFAULT_CURRENCY,
        isActive: true,
        notified: false,
        failureCount: 0
    });

    await newTracking.save();
    console.log(`[Backend] New product tracked: ${productName} for ${userEmail}`);
    
    return {
        tracking: newTracking,
        message: "Price alert created successfully"
    };
};

const checkIfTrackingExists = async (email, url) => {
    const tracking = await Tracking.findOne({ userEmail: email, url });
    return {
        exists: !!tracking,
        tracking: tracking || null
    };
};

const getUserWatchlist = async (email) => {
    return await Tracking.find({ userEmail: email, isActive: true });
};

const deactivateTracking = async (id) => {
    const tracking = await Tracking.findById(id);

    if (!tracking) {
        throw new Error("Alert not found");
    }

    tracking.isActive = false;
    tracking.updatedAt = new Date();
    await tracking.save();

    return { message: "Alert deactivated successfully" };
};

const deleteTrackingByUrl = async (email, url) => {
    const result = await Tracking.deleteOne({ userEmail: email, url });

    if (result.deletedCount === 0) {
        throw new Error("Alert not found");
    }

    return { message: "Alert permanently deleted" };
};

const checkPriceForTracking = async (tracking) => {
    try {
        console.log(`[Cron] Checking price for ${tracking.productName} (${tracking.platform})`);

        // Skip if too many failures
        if (tracking.failureCount >= MAX_FAILURES) {
            console.log(`[Cron] ⚠️ Skipping ${tracking.productName} - too many failures (${tracking.failureCount})`);
            
            // Auto-deactivate after excessive failures
            if (tracking.failureCount >= MAX_FAILURES * 2 && tracking.isActive) {
                tracking.isActive = false;
                tracking.lastError = `Auto-deactivated after ${tracking.failureCount} consecutive failures`;
                await tracking.save();
                console.log(`[Cron] ❌ Alert auto-deactivated for ${tracking.productName}`);
            }
            return;
        }

        // Try to scrape the current price
        let currentPrice = null;
        try {
            currentPrice = await scrapeProductPrice(tracking.url);
        } catch (scrapeError) {
            // Handle scraping failure
            tracking.failureCount += 1;
            tracking.lastError = scrapeError.message;
            tracking.updatedAt = new Date();
            await tracking.save();

            console.error(`[Cron] Scraping failed for ${tracking.productName}: ${scrapeError.message}`);
            return;
        }

        if (currentPrice === null) {
            tracking.failureCount += 1;
            tracking.lastError = 'Price not found - product may be unavailable';
            tracking.updatedAt = new Date();
            await tracking.save();
            console.log(`[Cron] Could not extract price for ${tracking.productName}`);
            return;
        }

        // Successfully scraped - reset failure count
        tracking.failureCount = 0;
        tracking.lastError = null;
        
        // Store previous price before updating to new price
        if (tracking.currentPrice !== null && tracking.currentPrice !== currentPrice) {
            tracking.previousPrice = tracking.currentPrice;
        }
        
        tracking.currentPrice = currentPrice;
        tracking.lastChecked = new Date();
        tracking.updatedAt = new Date();
        await tracking.save();

        console.log(`[Cron] Current price for ${tracking.productName}: ${tracking.currency}${currentPrice}, Target: ${tracking.currency}${tracking.targetPrice}`);

        // Check if target price is reached (currentPrice <= targetPrice)
        if (currentPrice <= tracking.targetPrice) {
            console.log(`[Cron] 🎯 Target reached for ${tracking.productName}!`);

            // STATE-BASED NOTIFICATION LOGIC:
            // Only notify if price has CHANGED since last notification
            const shouldNotify = !tracking.notified || 
                                 tracking.lastNotifiedPrice === null || 
                                 tracking.lastNotifiedPrice !== currentPrice;

            if (shouldNotify) {
                await sendPushNotification(tracking, currentPrice);
                console.log(`[Cron] ✅ Notification sent for ${tracking.productName} at ${tracking.currency}${currentPrice}`);
            } else {
                console.log(`[Cron] ⏭️ Price unchanged (${tracking.currency}${currentPrice}), skipping duplicate notification`);
            }
        } else {
            // Price is above target - reset notification state
            if (tracking.notified) {
                tracking.notified = false;
                tracking.notifiedAt = null;
                tracking.lastNotifiedPrice = null;
                tracking.updatedAt = new Date();
                await tracking.save();
                console.log(`[Cron] 🔄 Price above target again (${tracking.currency}${currentPrice} > ${tracking.currency}${tracking.targetPrice}), reset notification state`);
            }
        }

    } catch (error) {
        console.error(`[Cron] Error checking ${tracking.productName}:`, error);
        tracking.failureCount += 1;
        tracking.lastError = error.message;
        tracking.updatedAt = new Date();
        await tracking.save();
    }
};

const triggerManualPriceCheck = async (id) => {
    const tracking = await Tracking.findById(id);

    if (!tracking) {
        throw new Error("Alert not found");
    }

    if (!tracking.isActive) {
        throw new Error("Alert is not active");
    }

    // Trigger immediate price check
    await checkPriceForTracking(tracking);

    // Fetch updated tracking data
    const updatedTracking = await Tracking.findById(id);

    return {
        tracking: updatedTracking,
        priceReached: updatedTracking.currentPrice <= updatedTracking.targetPrice,
        emailSent: updatedTracking.notified
    };
};

const testEmailNotification = async (id) => {
    const tracking = await Tracking.findById(id);

    if (!tracking) {
        throw new Error("Alert not found");
    }

    // Simulate price drop to below target
    const simulatedPrice = tracking.targetPrice * 0.9; // 10% below target
    tracking.currentPrice = simulatedPrice;
    tracking.lastChecked = new Date();
    await tracking.save();

    // Send notification
    await sendPushNotification(tracking);

    return {
        simulatedPrice,
        targetPrice: tracking.targetPrice,
        emailSent: tracking.notified,
        notifiedAt: tracking.notifiedAt
    };
};

module.exports = {
    createOrUpdateTracking,
    checkIfTrackingExists,
    getUserWatchlist,
    deactivateTracking,
    deleteTrackingByUrl,
    checkPriceForTracking,
    triggerManualPriceCheck,
    testEmailNotification
};
