import { showNotification } from './notificationService.js';

// Base URL for the Node backend API
const NODE_API_BASE = 'http://localhost:8000';

// Alarm intervals (in minutes)
const INTERVALS = {
    ACTIVE_TAB: 45 / 60,           // 45 seconds
    BACKGROUND: 5,                  // 5 minutes
    NEAR_TARGET: 2,                 // 2 minutes (within 10% of target)
    POST_ALERT: 15,                 // 15 minutes after alert triggered
    STARTUP_DELAY: 0.5              // 30 seconds after startup
};

const ALARM_NAMES = {
    STARTUP_CHECK: 'startup-price-check',
    ACTIVE_TAB_CHECK: 'active-tab-check',
    BACKGROUND_CHECK: 'background-check'
};

// Supported platforms for auto-popup
const SUPPORTED_PLATFORMS = [
    'amazon.',
    'flipkart.com',
    'reliancedigital.in'
];

// Store active tab tracking state
let activeProductUrl = null;
let activeProductTabId = null;
let popupOpenedTabs = new Set(); // Track tabs where popup has been opened

// Check if URL is a supported platform product page
function isSupportedProductPage(url) {
    if (!url) return false;
    const urlLower = url.toLowerCase();

    // Amazon product pages
    if (urlLower.includes('amazon.') && urlLower.includes('/dp/')) {
        return true;
    }

    // Flipkart product pages
    if (urlLower.includes('flipkart.com') && urlLower.includes('/p/itm')) {
        return true;
    }

    // Reliance Digital product pages
    if (urlLower.includes('reliancedigital.in') && urlLower.includes('/p/')) {
        return true;
    }

    return false;
}

// Auto-open popup on product pages
async function autoOpenPopup(tabId, url) {
    // Only open popup once per tab
    if (popupOpenedTabs.has(tabId)) {
        return;
    }

    if (!isSupportedProductPage(url)) {
        return;
    }

    try {
        // Open popup by calling popup.html
        popupOpenedTabs.add(tabId);

        console.log(`[PriceWatch] Auto-opening popup on tab ${tabId} for ${url}`);

        // The popup will open automatically when the user clicks the extension icon
        // We mark the tab so we can restore state if needed
        await chrome.tabs.sendMessage(tabId, {
            action: 'PRODUCT_PAGE_DETECTED',
            url
        }).catch(err => {
            // Content script might not be loaded yet
            console.log('[PriceWatch] Content script not ready, will retry');
        });
    } catch (error) {
        console.error('[PriceWatch] Error auto-opening popup:', error);
    }
}

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PRODUCT_DETECTED') {
        console.log('[PriceWatch] Product detected:', request.data);
        handleProductDetected(request.data, sender.tab?.id);

        // Auto-open popup on supported platforms
        if (isSupportedProductPage(sender.tab?.url)) {
            autoOpenPopup(sender.tab?.id, sender.tab?.url);
        }
        return true;
    }

    if (request.action === 'AI_INSIGHTS_REQUEST') {
        handleAiInsightsRequest(request, sendResponse);
        return true; // keep message channel open for async response
    }

    if (request.action === 'PRICE_COMPARISON_REQUEST') {
        handlePriceComparisonRequest(request, sendResponse);
        return true; // keep message channel open for async response
    }

    // ── Fetch proxy for content script pagination ─────────────────────────
    // ROOT CAUSE FIX: Fetching from the service worker OR content script sends
    // Origin: chrome-extension://... — Amazon bot detection sees this as
    // non-browser and returns CAPTCHA/empty page.
    // Solution: chrome.scripting.executeScript with world:'MAIN' runs the
    // fetch inside the actual Amazon page's JS context, so Origin/Referer
    // look exactly like a same-origin request. No bot detection triggered.
    if (request.action === 'FETCH_PAGE') {
        const url = request.url;
        const tabId = sender.tab?.id;

        if (!url || typeof url !== 'string') {
            sendResponse({ error: 'Missing or invalid URL' });
            return true;
        }

        if (tabId) {
            // ── Strategy A: execute fetch in the page's MAIN world ────────
            // This is the key: fetch() runs as amazon.in's own JS, not extension
            chrome.scripting.executeScript({
                target: { tabId },
                world: 'MAIN',
                func: async (fetchUrl) => {
                    try {
                        const resp = await fetch(fetchUrl, {
                            credentials: 'include',
                            headers: {
                                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                            },
                            redirect: 'follow',
                        });
                        if (!resp.ok) return { error: `HTTP ${resp.status}` };
                        return { html: await resp.text() };
                    } catch (e) {
                        return { error: e.message };
                    }
                },
                args: [url],
            })
                .then(([result]) => {
                    sendResponse(result?.result || { error: 'No result from script' });
                })
                .catch((err) => {
                    // ── Strategy B: service-worker fetch fallback ─────────────
                    console.warn('[PriceWatch] MAIN-world fetch failed, using sw fetch:', err.message);
                    fetch(url, {
                        credentials: 'include',
                        headers: { 'Accept': 'text/html,application/xhtml+xml' },
                        redirect: 'follow',
                    })
                        .then((r) => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
                        .then((html) => sendResponse({ html }))
                        .catch((e2) => sendResponse({ error: e2.message }));
                });
        } else {
            // No tabId — service-worker fetch only
            fetch(url, {
                credentials: 'include',
                headers: { 'Accept': 'text/html,application/xhtml+xml' },
                redirect: 'follow',
            })
                .then((r) => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
                .then((html) => sendResponse({ html }))
                .catch((err) => {
                    console.warn('[PriceWatch] FETCH_PAGE error:', err.message);
                    sendResponse({ error: err.message });
                });
        }
        return true; // async sendResponse
    }

    return true;
});

/**
 * Handle AI review analysis requests from the popup.
 *
 * Pipeline:
 *   1. Find the active product tab
 *   2. Ask the content script to extract reviews from the DOM
 *   3. POST the extracted reviews to the Node API orchestrator
 *   4. Return the structured ML result to the popup via sendResponse
 *
 * @param {Object} request       - { productUrl, skipCache }
 * @param {Function} sendResponse - Chrome messaging callback
 */
async function handleAiInsightsRequest(request, sendResponse) {
    const { productUrl, skipCache = false } = request;
    console.log('[PriceWatch] 🤖 AI_INSIGHTS_REQUEST for:', productUrl);

    try {
        // ── Step 1: Locate the tab that has this product URL open ──────────
        // Query all tabs (requires 'tabs' permission in manifest).
        // Prefer the active tab in the current window; fall back to any tab
        // whose URL matches the requested product URL.
        const [activeTabs, allTabs] = await Promise.all([
            chrome.tabs.query({ active: true, currentWindow: true }),
            chrome.tabs.query({}),
        ]);

        let targetTab = activeTabs[0] || null;

        // If the active tab URL doesn't match, find the product tab by URL string
        if (!targetTab || (productUrl && targetTab.url !== productUrl)) {
            const match = allTabs.find((t) => t.url === productUrl);
            if (match) targetTab = match;
        }

        if (!targetTab) {
            console.warn('[PriceWatch] No matching tab found for:', productUrl);
            sendResponse({
                success: false,
                error: 'Product tab not found. Please navigate to the product page and try again.',
            });
            return;
        }

        const tabId = targetTab.id;
        const effectiveUrl = productUrl || targetTab.url;

        // ── Step 2: Extract reviews from the content script ────────────────
        console.log('[PriceWatch] Requesting reviews from tab:', tabId);
        let reviews = [];
        let contentPlatform = 'unknown';
        let contentTotalPages = 0; let totalScraped = 0;
        try {
            const contentResponse = await chrome.tabs.sendMessage(tabId, { action: 'GET_REVIEWS' });

            if (contentResponse && Array.isArray(contentResponse.reviews)) {
                reviews = contentResponse.reviews;
                contentPlatform = contentResponse.platform || 'unknown';
                contentTotalPages = contentResponse.totalPages || 1;
                totalScraped = contentResponse.totalRaw || reviews.length;
                console.log(`[PriceWatch] Content script returned ${reviews.length} reviews from ${contentPlatform} (${contentTotalPages} pages, ${totalScraped} raw)`);
            } else if (contentResponse && contentResponse.error) {
                console.warn('[PriceWatch] Content script error:', contentResponse.error);
            }
        } catch (contentErr) {
            console.warn('[PriceWatch] Could not reach content script:', contentErr.message);
        }

        if (!reviews || reviews.length === 0) {
            sendResponse({
                success: false,
                error: 'No reviews found on this page. The product may not have any reviews yet, or the page hasn\'t fully loaded. Please scroll to the reviews section and try again.',
            });
            return;
        }

        // ── Step 2b: Extract browser cookies for server-side scraping ───────
        //    The backend uses these cookies to fetch additional review pages
        //    when the extension's client-side pagination is blocked.
        let domainCookies = '';
        try {
            const tabUrl = new URL(targetTab.url);
            const cookieUrl = `${tabUrl.protocol}//${tabUrl.hostname}`;
            const cookies = await chrome.cookies.getAll({ url: cookieUrl });
            domainCookies = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            console.log(`[PriceWatch] Extracted ${cookies.length} cookies for ${tabUrl.hostname}`);
        } catch (cookieErr) {
            console.warn('[PriceWatch] Cookie extraction failed:', cookieErr.message);
        }

        // ── Step 3: Send to Node API orchestrator → Python ML ──────────────
        console.log(`[PriceWatch] Sending ${reviews.length} reviews to Node API for ML analysis…`);

        const apiResponse = await fetch(`${NODE_API_BASE}/api/reviews/analyze-direct`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: effectiveUrl,
                reviews,
                skipCache,
                platform: contentPlatform,
                totalPages: contentTotalPages,
                totalScraped: totalScraped || reviews.length,
                cookies: domainCookies,
            }),
        });

        if (!apiResponse.ok) {
            const errBody = await apiResponse.json().catch(() => ({}));
            throw new Error(errBody.error || errBody.message || `API error ${apiResponse.status}`);
        }

        const result = await apiResponse.json();

        if (!result.success && result.error) {
            throw new Error(result.error);
        }

        console.log('[PriceWatch] ✅ Analysis complete — score:', result.sentimentScore, '| cached:', result.fromCache);
        sendResponse(result);

    } catch (err) {
        console.error('[PriceWatch] ❌ AI_INSIGHTS_REQUEST failed:', err.message);
        sendResponse({ success: false, error: err.message || 'Analysis failed. Please try again.' });
    }
}

/**
 * Handle price comparison requests from the popup.
 *
 * Pipeline:
 *   1. Find the active product tab
 *   2. Ask the content script to extract extended product details (brand/model)
 *   3. POST to the Node API comparison endpoint
 *   4. Return results to popup via sendResponse
 *
 * @param {Object} request       - { productUrl }
 * @param {Function} sendResponse - Chrome messaging callback
 */
async function handlePriceComparisonRequest(request, sendResponse) {
    const { productUrl } = request;
    console.log('[PriceWatch] 🔄 PRICE_COMPARISON_REQUEST for:', productUrl);

    try {
        // ── Step 1: Locate the product tab ─────────────────────────────────
        const [activeTabs, allTabs] = await Promise.all([
            chrome.tabs.query({ active: true, currentWindow: true }),
            chrome.tabs.query({}),
        ]);

        let targetTab = activeTabs[0] || null;

        if (!targetTab || (productUrl && targetTab.url !== productUrl)) {
            const match = allTabs.find((t) => t.url === productUrl);
            if (match) targetTab = match;
        }

        if (!targetTab) {
            console.warn('[PriceWatch] No matching tab found for:', productUrl);
            sendResponse({
                success: false,
                error: 'Product tab not found. Please navigate to the product page and try again.',
            });
            return;
        }

        const tabId = targetTab.id;

        // ── Step 2: Get extended product details from content script ───────
        console.log('[PriceWatch] Requesting extended product details from tab:', tabId);
        let productData = null;

        try {
            productData = await chrome.tabs.sendMessage(tabId, { action: 'GET_PRODUCT_DETAILS_EXTENDED' });
        } catch (contentErr) {
            console.warn('[PriceWatch] Could not reach content script:', contentErr.message);
        }

        if (!productData || !productData.name) {
            sendResponse({
                success: false,
                error: 'Could not extract product details. Please ensure you are on a product page.',
            });
            return;
        }

        // ── Step 3: POST to comparison API ─────────────────────────────────
        console.log(`[PriceWatch] Sending comparison request for "${productData.name}" on ${productData.platform}`);

        const apiResponse = await fetch(`${NODE_API_BASE}/api/comparison/compare`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: productData.name,
                brand: productData.brand || '',
                model: productData.model || '',
                price: productData.price,
                platform: productData.platform,
                url: productData.url || productUrl,
            }),
        });

        if (!apiResponse.ok) {
            const errBody = await apiResponse.json().catch(() => ({}));
            throw new Error(errBody.error || `API error ${apiResponse.status}`);
        }

        const result = await apiResponse.json();

        if (!result.success && result.error) {
            throw new Error(result.error);
        }

        console.log('[PriceWatch] ✅ Comparison complete —', result.results?.length, 'platforms');
        sendResponse(result);

    } catch (err) {
        console.error('[PriceWatch] ❌ PRICE_COMPARISON_REQUEST failed:', err.message);
        sendResponse({ success: false, error: err.message || 'Price comparison failed. Please try again.' });
    }
}

// Handle product detection on a tab
async function handleProductDetected(productData, tabId) {
    activeProductUrl = productData.url;
    activeProductTabId = tabId;

    // Update current price in watchlist if this product is being tracked
    await updateTrackedProductPrice(productData);

    // If user is on a product page, set up active tab monitoring
    await scheduleActiveTabCheck(productData);
}

// Update the current price of a tracked product
async function updateTrackedProductPrice(productData) {
    const result = await chrome.storage.local.get(['trackedProducts']);
    const tracked = result.trackedProducts || [];

    const existingIndex = tracked.findIndex(p => p.url === productData.url);

    if (existingIndex !== -1) {
        // Product is being tracked - update its current price
        tracked[existingIndex].currentPrice = productData.price;
        tracked[existingIndex].lastChecked = new Date().toISOString();

        await chrome.storage.local.set({ trackedProducts: tracked });
        console.log(`[PriceWatch] Updated price for ${productData.name}: ₹${productData.price}`);
    }
}

// Schedule price check for active tab (45 seconds)
async function scheduleActiveTabCheck(productData) {
    const alarmName = `${ALARM_NAMES.ACTIVE_TAB_CHECK}-${activeProductTabId}`;

    // Clear any existing alarm for this tab
    await chrome.alarms.clear(alarmName);

    // Create new alarm for active tab checking
    chrome.alarms.create(alarmName, {
        delayInMinutes: INTERVALS.ACTIVE_TAB,
        periodInMinutes: INTERVALS.ACTIVE_TAB
    });

    console.log(`[PriceWatch] Active tab monitoring started for tab ${activeProductTabId}`);
}

// Schedule background price checks for watchlist
async function scheduleBackgroundChecks() {
    const result = await chrome.storage.local.get(['trackedProducts', 'userEmail']);
    const trackedProducts = result.trackedProducts || [];

    if (trackedProducts.length === 0) {
        console.log('[PriceWatch] No products in watchlist');
        return;
    }

    console.log(`[PriceWatch] Scheduling background checks for ${trackedProducts.length} products`);

    // Clear existing background alarm
    await chrome.alarms.clear(ALARM_NAMES.BACKGROUND_CHECK);

    // Create new background check alarm
    chrome.alarms.create(ALARM_NAMES.BACKGROUND_CHECK, {
        delayInMinutes: INTERVALS.BACKGROUND,
        periodInMinutes: INTERVALS.BACKGROUND
    });
}

// Calculate dynamic interval based on price proximity
function calculateInterval(currentPrice, targetPrice, wasNotified) {
    if (wasNotified) {
        return INTERVALS.POST_ALERT;
    }

    const percentAboveTarget = ((currentPrice - targetPrice) / targetPrice) * 100;

    if (percentAboveTarget <= 10 && percentAboveTarget > 0) {
        return INTERVALS.NEAR_TARGET;
    }

    return INTERVALS.BACKGROUND;
}

// Perform price check
async function checkPrice(productUrl, tabId = null) {
    try {
        // If tab is specified, get fresh data from content script
        if (tabId) {
            const response = await chrome.tabs.sendMessage(tabId, {
                action: 'GET_PRODUCT_DETAILS'
            });

            if (response && response.price) {
                await handlePriceUpdate(response);
            }
        } else {
            // Background check - use backend API
            const result = await chrome.storage.local.get(['userEmail', 'trackedProducts']);
            const tracked = result.trackedProducts || [];

            for (const product of tracked) {
                // Here we would call backend API to check price
                // For now, we'll rely on backend cron job
                console.log(`[PriceWatch] Background check scheduled for ${product.productName}`);
            }
        }
    } catch (error) {
        console.error('[PriceWatch] Price check error:', error);
    }
}

// Handle price update and notification
async function handlePriceUpdate(productData) {
    const result = await chrome.storage.local.get(['trackedProducts']);
    const tracked = result.trackedProducts || [];

    const alert = tracked.find(p => p.url === productData.url);

    if (!alert) {
        return; // No alert set for this product
    }

    const currentPrice = productData.price;
    const targetPrice = alert.targetPrice;

    // Check if alert condition is met
    if (currentPrice <= targetPrice) {
        // Check if we should notify (state-based logic)
        const lastNotifiedPrice = alert.lastNotifiedPrice || null;

        if (lastNotifiedPrice === null || lastNotifiedPrice !== currentPrice) {
            // Price changed or first notification
            showNotification(productData, currentPrice, targetPrice);

            // Update local storage with notification state
            alert.lastNotifiedPrice = currentPrice;
            alert.notifiedAt = new Date().toISOString();

            const updatedTracked = tracked.map(p =>
                p.url === productData.url ? alert : p
            );

            await chrome.storage.local.set({ trackedProducts: updatedTracked });

            console.log(`[PriceWatch] ✅ Notification shown for ${productData.name}`);
        } else {
            console.log(`[PriceWatch] ⏭️ Price unchanged, skipping notification`);
        }
    }
}

// Listen for alarm triggers
chrome.alarms.onAlarm.addListener(async (alarm) => {
    console.log(`[PriceWatch] Alarm triggered: ${alarm.name}`);

    if (alarm.name === ALARM_NAMES.STARTUP_CHECK) {
        console.log('[PriceWatch] Running startup price check');
        await scheduleBackgroundChecks();
    } else if (alarm.name.startsWith(ALARM_NAMES.ACTIVE_TAB_CHECK)) {
        const tabId = parseInt(alarm.name.split('-').pop());
        if (activeProductUrl && tabId === activeProductTabId) {
            await checkPrice(activeProductUrl, tabId);
        }
    } else if (alarm.name === ALARM_NAMES.BACKGROUND_CHECK) {
        console.log('[PriceWatch] Running background price check');
        await checkPrice(null);
    }
});

// Listen for tab updates to detect when user navigates away
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId === activeProductTabId && changeInfo.url) {
        // User navigated away from product page
        const alarmName = `${ALARM_NAMES.ACTIVE_TAB_CHECK}-${tabId}`;
        chrome.alarms.clear(alarmName);

        if (activeProductTabId === tabId) {
            activeProductUrl = null;
            activeProductTabId = null;
        }
    }
});

// Listen for tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === activeProductTabId) {
        const alarmName = `${ALARM_NAMES.ACTIVE_TAB_CHECK}-${tabId}`;
        chrome.alarms.clear(alarmName);
        activeProductUrl = null;
        activeProductTabId = null;
    }

    // Also clear from popup tracking
    popupOpenedTabs.delete(tabId);
});

// Initialize on extension startup
chrome.runtime.onStartup.addListener(() => {
    console.log('[PriceWatch] Extension started - scheduling startup check');

    chrome.alarms.create(ALARM_NAMES.STARTUP_CHECK, {
        delayInMinutes: INTERVALS.STARTUP_DELAY
    });
});

// Also run on install/update
chrome.runtime.onInstalled.addListener(() => {
    console.log('[PriceWatch] Extension installed/updated - scheduling startup check');

    chrome.alarms.create(ALARM_NAMES.STARTUP_CHECK, {
        delayInMinutes: INTERVALS.STARTUP_DELAY
    });
});

console.log("[PriceWatch] Background service worker initialized with dynamic interval monitoring");
