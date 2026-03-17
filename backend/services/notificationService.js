const { sendEmailAlert } = require('./emailService');
const { sendWhatsAppAlert } = require('./whatsappNotificationService');

const sendPushNotification = async (tracking, currentPrice) => {
    console.log(`[Notification] Sending alert for ${tracking.productName}`);

    const productData = {
        productName: tracking.productName,
        currentPrice: currentPrice || tracking.currentPrice,
        previousPrice: tracking.previousPrice,
        targetPrice: tracking.targetPrice,
        url: tracking.url,
        image: tracking.image,
        platform: tracking.platform,
        currency: tracking.currency
    };

    let emailSent = false;
    let whatsappSent = false;

    // Send email notification
    try {
        await sendEmailAlert(tracking.userEmail, productData);
        emailSent = true;
        console.log(`[Notification] ✅ Email sent for ${tracking.productName}`);
    } catch (error) {
        console.error(`[Notification] ❌ Email failed for ${tracking.productName}:`, error.message);
    }

    // Send WhatsApp notification (non-blocking — don't let it block email flow)
    try {
        const waResult = await sendWhatsAppAlert(tracking.userEmail, productData);
        whatsappSent = waResult.success;
        if (waResult.success) {
            console.log(`[Notification] ✅ WhatsApp sent for ${tracking.productName}`);
        } else if (waResult.skipped) {
            console.log(`[Notification] ⏭️ WhatsApp skipped: ${waResult.reason}`);
        } else {
            console.warn(`[Notification] ⚠️ WhatsApp failed: ${waResult.reason}`);
        }
    } catch (error) {
        console.error(`[Notification] ❌ WhatsApp error for ${tracking.productName}:`, error.message);
    }

    // Mark as notified if at least one channel succeeded
    if (emailSent || whatsappSent) {
        tracking.notified = true;
        tracking.notifiedAt = new Date();
        tracking.lastNotifiedPrice = currentPrice || tracking.currentPrice;
        tracking.lastNotificationChannels = {
            email: emailSent,
            whatsapp: whatsappSent,
            timestamp: new Date()
        };
        await tracking.save();

        console.log(`[Notification] ✅ Tracking updated (email: ${emailSent}, whatsapp: ${whatsappSent})`);
        return true;
    }

    console.error(`[Notification] ❌ All notification channels failed for ${tracking.productName}`);
    return false;
};

module.exports = { sendPushNotification };
