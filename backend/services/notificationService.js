const { sendEmailAlert } = require('./emailService');

const sendPushNotification = async (tracking, currentPrice) => {
    console.log(`[Notification] Sending alert for ${tracking.productName}`);

    try {
        // Send email notification (await to ensure it completes)
        await sendEmailAlert(tracking.userEmail, {
            productName: tracking.productName,
            currentPrice: currentPrice || tracking.currentPrice,
            previousPrice: tracking.previousPrice,  // Pass previous observed price
            targetPrice: tracking.targetPrice,
            url: tracking.url,
            image: tracking.image,
            platform: tracking.platform,
            currency: tracking.currency
        });

        // Mark as notified ONLY after successful email send
        tracking.notified = true;
        tracking.notifiedAt = new Date();
        tracking.lastNotifiedPrice = currentPrice || tracking.currentPrice;
        await tracking.save();

        console.log(`[Notification] ✅ Email sent and tracking updated for ${tracking.productName}`);
        return true;
    } catch (error) {
        console.error(`[Notification] ❌ Failed to send notification for ${tracking.productName}:`, error);
        // Don't mark as notified if email fails
        return false;
    }
};

module.exports = { sendPushNotification };
