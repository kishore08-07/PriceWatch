// Set up tracking alarm
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create('checkPrices', { periodInMinutes: 30 });
});

// Alarm listener
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'checkPrices') {
        checkAllTrackedPrices();
    }
});

async function checkAllTrackedPrices() {
    const result = await chrome.storage.local.get(['trackedProducts']);
    const products = result.trackedProducts || [];

    for (const product of products) {
        // In a real production app, the backend would do this check and send a push.
        // Here we simulate the check via a backend call or direct fetch.
        try {
            // Simulate backend check
            const response = await fetch(`http://localhost:8000/api/price/check`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: product.url,
                    productName: product.name,
                    targetPrice: product.targetPrice,
                    userEmail: product.userEmail
                })
            });

            const latestData = await response.json();

            if (latestData.currentPrice <= product.targetPrice) {
                showNotification(product, latestData.currentPrice);
            }
        } catch (err) {
            console.error("Price check failed for", product.name, err);
        }
    }
}

function showNotification(product, latestPrice) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Price Drop Alert! ⚡',
        message: `${product.name} is now ₹${latestPrice.toLocaleString()}! (Target: ₹${product.targetPrice.toLocaleString()})`,
        priority: 2
    });
}

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PRODUCT_DETECTED') {
        // Optional: Auto-notify popup if it's open
        console.log("Product detected:", request.data);
    }
});
