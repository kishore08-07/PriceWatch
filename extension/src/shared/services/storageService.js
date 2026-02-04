import { STORAGE_KEYS } from '../constants/storage';

export const storageService = {
    get: (keys) => {
        return new Promise((resolve) => {
            chrome.storage.local.get(keys, resolve);
        });
    },

    set: (data) => {
        return new Promise((resolve) => {
            chrome.storage.local.set(data, resolve);
        });
    },

    remove: (keys) => {
        return new Promise((resolve) => {
            chrome.storage.local.remove(keys, resolve);
        });
    },

    getUserEmail: async () => {
        const result = await storageService.get([STORAGE_KEYS.USER_EMAIL]);
        return result[STORAGE_KEYS.USER_EMAIL] || null;
    },

    setUserEmail: async (email) => {
        await storageService.set({ [STORAGE_KEYS.USER_EMAIL]: email });
    },

    getTrackedProducts: async () => {
        const result = await storageService.get([STORAGE_KEYS.TRACKED_PRODUCTS]);
        const products = result[STORAGE_KEYS.TRACKED_PRODUCTS] || [];
        
        // Validate data structure
        if (!Array.isArray(products)) {
            console.warn('[Storage] Invalid tracked products data, resetting');
            return [];
        }
        
        return products;
    },

    setTrackedProducts: async (products) => {
        // Validate data before saving
        if (!Array.isArray(products)) {
            console.error('[Storage] Attempted to save invalid tracked products');
            return;
        }
        
        await storageService.set({ [STORAGE_KEYS.TRACKED_PRODUCTS]: products });
    },
    
    // Update notification state for a product
    updateProductNotification: async (productUrl, notificationData) => {
        const products = await storageService.getTrackedProducts();
        const updatedProducts = products.map(p => {
            if (p.url === productUrl) {
                return {
                    ...p,
                    ...notificationData,
                    lastUpdated: new Date().toISOString()
                };
            }
            return p;
        });
        
        await storageService.setTrackedProducts(updatedProducts);
    }
};
