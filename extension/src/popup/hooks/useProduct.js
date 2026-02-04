import { useState, useEffect } from 'react';
import { getActiveTab, sendMessageToTab } from '../../shared/utils/chromeHelpers';
import { checkTracking } from '../../shared/services/trackingService';
import { storageService } from '../../shared/services/storageService';

export const useProduct = () => {
    const [product, setProduct] = useState(null);
    const [error, setError] = useState(null);
    const [isTracking, setIsTracking] = useState(false);
    const [existingAlert, setExistingAlert] = useState(null);

    const fetchProduct = async () => {
        setError(null);
        setProduct(null);

        const fetchTimeout = setTimeout(() => {
            if (!product) {
                setError("Unable to detect product information. Please ensure you're on a product details page.");
            }
        }, 5000);

        try {
            const tab = await getActiveTab();
            if (!tab?.id) {
                setError("Please navigate to a supported e-commerce platform.");
                return;
            }

            const response = await sendMessageToTab(tab.id, { action: 'GET_PRODUCT_DETAILS' });

            if (response && response.name) {
                setProduct(response);
                clearTimeout(fetchTimeout);

                // Check both local storage and backend for existing alerts
                const result = await storageService.get(['userEmail', 'trackedProducts']);
                const tracked = result.trackedProducts || [];
                const isAlreadyTracked = tracked.some(p => p.url === response.url);
                setIsTracking(isAlreadyTracked);

                // If user is logged in, also check backend for existing alert
                if (result.userEmail && response.url) {
                    try {
                        const data = await checkTracking(result.userEmail, response.url);
                        if (data.exists && data.tracking) {
                            setIsTracking(true);
                            setExistingAlert(data.tracking);
                        }
                    } catch (err) {
                        console.log("Could not check for existing alert:", err);
                    }
                }
            } else {
                setError("Product information unavailable. Please refresh and ensure you're viewing a product page.");
            }
        } catch (err) {
            setError("Connection error. Please refresh the product page and try again.");
        }
    };

    return {
        product,
        error,
        setError,
        isTracking,
        setIsTracking,
        existingAlert,
        setExistingAlert,
        fetchProduct
    };
};
