const User = require('../models/User');
const whatsappService = require('./whatsappService');

// Minimum interval between WhatsApp alerts per user (prevents spam)
const MIN_ALERT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Format and send a WhatsApp price drop alert to a user.
 * 
 * @param {string} userEmail - User's email to look up their WhatsApp number
 * @param {Object} product - Product details
 * @returns {Object} Result with success/skipped/reason
 */
const sendWhatsAppAlert = async (userEmail, product) => {
    try {
        // Look up user
        const user = await User.findOne({ email: userEmail });

        if (!user) {
            return { success: false, skipped: true, reason: 'User not found' };
        }

        // Check if user has verified WhatsApp and has notifications enabled
        if (!user.whatsappVerified || !user.whatsappNumber) {
            return { success: false, skipped: true, reason: 'WhatsApp not verified' };
        }

        if (!user.whatsappNotificationsEnabled) {
            return { success: false, skipped: true, reason: 'WhatsApp notifications disabled by user' };
        }

        // Rate limit: prevent alert spam per user
        if (user.lastWhatsappNotification) {
            const timeSinceLast = Date.now() - user.lastWhatsappNotification.getTime();
            if (timeSinceLast < MIN_ALERT_INTERVAL_MS) {
                return {
                    success: false,
                    skipped: true,
                    reason: `Rate limited — last alert sent ${Math.round(timeSinceLast / 1000)}s ago`
                };
            }
        }

        // Check WhatsApp service connection
        const status = whatsappService.getStatus();
        if (!status.connected) {
            return { success: false, skipped: false, reason: 'WhatsApp service not connected' };
        }

        // Format the message
        const message = formatPriceAlertMessage(product);

        // Send the message
        const result = await whatsappService.sendMessage(user.whatsappNumber, message);

        if (result.success) {
            // Update last notification timestamp
            user.lastWhatsappNotification = new Date();
            await user.save();
            return { success: true };
        }

        return { success: false, skipped: false, reason: result.reason };

    } catch (error) {
        console.error(`[WhatsApp Alert] Error sending alert to ${userEmail}:`, error.message);
        return { success: false, skipped: false, reason: error.message };
    }
};

/**
 * Format a price drop alert message for WhatsApp.
 */
const formatPriceAlertMessage = (product) => {
    const currency = product.currency || '₹';
    const currentPrice = Number(product.currentPrice).toLocaleString('en-IN');
    const targetPrice = Number(product.targetPrice).toLocaleString('en-IN');

    let priceDropInfo = '';
    if (product.previousPrice && product.previousPrice !== product.currentPrice) {
        const previousPrice = Number(product.previousPrice).toLocaleString('en-IN');
        const savings = Number(product.previousPrice - product.currentPrice).toLocaleString('en-IN');
        priceDropInfo = `\n📊 Previous Price: ${currency}${previousPrice}\n💰 You Save: ${currency}${savings}`;
    }

    return `📉 *Price Drop Alert!*

🛍️ *${product.productName}*
🏪 Platform: ${product.platform || 'Unknown'}
${priceDropInfo}
💵 Current Price: *${currency}${currentPrice}*
🎯 Your Target Price: ${currency}${targetPrice}

🔗 Buy Now:
${product.url}

— _PriceWatch_ 🔔`;
};

/**
 * Send a custom WhatsApp message to a user (for admin/testing).
 */
const sendCustomWhatsAppMessage = async (userEmail, message) => {
    const user = await User.findOne({ email: userEmail });
    if (!user || !user.whatsappNumber || !user.whatsappVerified) {
        return { success: false, reason: 'User WhatsApp not configured or verified' };
    }

    return await whatsappService.sendMessage(user.whatsappNumber, message);
};

module.exports = {
    sendWhatsAppAlert,
    formatPriceAlertMessage,
    sendCustomWhatsAppMessage
};
