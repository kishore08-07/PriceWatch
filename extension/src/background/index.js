import { showNotification } from './notificationService.js';

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

// Store active tab tracking state
let activeProductUrl = null;
let activeProductTabId = null;

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PRODUCT_DETECTED') {
        console.log("[PriceWatch] Product detected:", request.data);
        handleProductDetected(request.data, sender.tab?.id);
    }
    return true;
});

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
