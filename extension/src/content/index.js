import { getProductData } from './productScraper';

console.log("[PriceWatch] Content script v4.0 (Dynamic Monitoring) injected.");

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_PRODUCT_DETAILS') {
        const data = getProductData();
        sendResponse(data);
    }
    return true;
});

// Auto-detect product and notify background service for active tab monitoring
function detectAndNotify() {
    const productData = getProductData();
    if (productData && productData.name && productData.price) {
        chrome.runtime.sendMessage({
            action: 'PRODUCT_DETECTED',
            data: productData
        }).catch(err => {
            // Background service might not be ready yet
            console.log('[PriceWatch] Could not notify background service:', err);
        });
    }
}

// Run detection after page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(detectAndNotify, 1000);
    });
} else {
    setTimeout(detectAndNotify, 1000);
}

// Also run on dynamic content changes (for SPAs)
const observer = new MutationObserver(() => {
    // Debounce to avoid excessive checks
    clearTimeout(window.priceWatchTimeout);
    window.priceWatchTimeout = setTimeout(detectAndNotify, 2000);
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});
