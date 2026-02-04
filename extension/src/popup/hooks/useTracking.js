import { useState, useCallback } from 'react';
import { addTracking, removeTracking } from '../../shared/services/trackingService';
import { storageService } from '../../shared/services/storageService';

export const useTracking = () => {
    const [trackedProducts, setTrackedProducts] = useState([]);

    const fetchTrackedProducts = useCallback(async () => {
        const products = await storageService.getTrackedProducts();
        
        // Remove duplicates based on URL
        const uniqueProducts = [];
        const seenUrls = new Set();
        
        products.forEach(product => {
            if (!seenUrls.has(product.url)) {
                seenUrls.add(product.url);
                uniqueProducts.push(product);
            }
        });
        
        // Update storage if duplicates were found
        if (uniqueProducts.length !== products.length) {
            await storageService.setTrackedProducts(uniqueProducts);
        }
        
        setTrackedProducts(uniqueProducts);
    }, []);

    const submitTracking = useCallback(async (product, targetPrice, userEmail) => {
        const trackingData = {
            productName: product.name,
            currentPrice: product.price,
            url: product.url,
            platform: product.platform,
            image: product.image,
            currency: product.currency,
            targetPrice: parseFloat(targetPrice),
            userEmail
        };

        const data = await addTracking(trackingData);
        
        if (data.success) {
            // Update local storage only after successful backend save
            const tracked = await storageService.getTrackedProducts();
            const existingIndex = tracked.findIndex(p => p.url === product.url);

            if (existingIndex !== -1) {
                tracked[existingIndex] = trackingData;
            } else {
                tracked.push(trackingData);
            }

            await storageService.setTrackedProducts(tracked);
            await fetchTrackedProducts();
            return { success: true };
        } else {
            throw new Error(data.message || 'Failed to set price alert');
        }
    }, [fetchTrackedProducts]);

    const handleRemoveTracking = useCallback(async (item, index, userEmail, currentProductUrl, setIsTracking, setExistingAlert, setTargetPrice) => {
        // Remove from backend if user is logged in
        if (userEmail) {
            try {
                await removeTracking(userEmail, item.url);
            } catch (err) {
                console.error('Failed to remove from backend:', err);
            }
        }

        // Remove from local storage
        const updated = trackedProducts.filter((_, i) => i !== index);
        await storageService.setTrackedProducts(updated);
        setTrackedProducts(updated);
        
        if (currentProductUrl && item.url === currentProductUrl) {
            setIsTracking(false);
            setExistingAlert(null);
            setTargetPrice('');
        }
    }, [trackedProducts]);

    return {
        trackedProducts,
        fetchTrackedProducts,
        submitTracking,
        handleRemoveTracking
    };
};
