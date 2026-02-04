export const showNotification = (product, currentPrice, targetPrice) => {
    const title = 'Price Drop Alert! ⚡';
    const message = `${product.name} is now ${product.currency}${currentPrice.toLocaleString()}! (Target: ${product.currency}${targetPrice.toLocaleString()})`;
    
    chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: title,
        message: message,
        priority: 2,
        requireInteraction: true
    }, (notificationId) => {
        console.log(`[PriceWatch] Notification created: ${notificationId}`);
    });
    
    // Also play a sound if possible
    try {
        // Create an offscreen document for playing sound (Manifest V3 requirement)
        playNotificationSound();
    } catch (error) {
        console.log('[PriceWatch] Could not play notification sound:', error);
    }
};

// Handle notification click to open product page
chrome.notifications.onClicked.addListener((notificationId) => {
    // Get the product URL from storage and open it
    chrome.storage.local.get(['trackedProducts'], (result) => {
        const tracked = result.trackedProducts || [];
        if (tracked.length > 0) {
            // Open the most recently notified product
            chrome.tabs.create({ url: tracked[0].url });
        }
    });
    chrome.notifications.clear(notificationId);
});

function playNotificationSound() {
    // In Manifest V3, audio playback requires offscreen document
    // For now, we'll rely on system notification sound
    console.log('[PriceWatch] Notification sound triggered');
}
