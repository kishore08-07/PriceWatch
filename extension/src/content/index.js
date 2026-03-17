import { getProductData, getProductDataExtended } from './productScraper';
import { getRealReviews } from './reviewExtractor';

console.log("[PriceWatch] Content script v6.0 (Price Comparison + Review Extraction) injected.");

// Listen for messages from background / popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_PRODUCT_DETAILS') {
        const data = getProductData();
        sendResponse(data);
        return true;
    }

    if (request.action === 'GET_PRODUCT_DETAILS_EXTENDED') {
        const data = getProductDataExtended();
        sendResponse(data);
        return true;
    }

    if (request.action === 'GET_REVIEWS') {
        // getRealReviews ALWAYS resolves (never rejects) — returns { reviews, platform, totalPages, totalRaw }
        getRealReviews()
            .then((result) => {
                const reviews = result.reviews || [];
                const platform = result.platform || 'unknown';
                const totalPages = result.totalPages || 1;
                const totalRaw = result.totalRaw || reviews.length;
                console.log(`[PriceWatch] Extracted ${reviews.length} reviews from ${platform} (${totalPages} pages, ${totalRaw} raw)`);
                sendResponse({
                    success: reviews.length > 0,
                    reviews: reviews,
                    count: reviews.length,
                    platform: platform,
                    totalPages: totalPages,
                    totalRaw: totalRaw,
                    url: window.location.href,
                    ...(reviews.length === 0
                        ? { error: 'No reviews found on this page. The product may not have any reviews yet.' }
                        : {}),
                });
            })
            .catch((err) => {
                console.error('[PriceWatch] Unexpected review extraction error:', err);
                sendResponse({
                    success: false,
                    reviews: [],
                    count: 0,
                    platform: 'unknown',
                    totalPages: 0,
                    totalRaw: 0,
                    error: err.message || 'Review extraction failed',
                });
            });

        return true; // Keep message channel open for async sendResponse
    }

    // Silently acknowledge unknown actions
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
