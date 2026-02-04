const validateTrackingInput = (userEmail, url, targetPrice, currentPrice) => {
    // Check required fields
    if (!userEmail || !url || !targetPrice) {
        return {
            isValid: false,
            error: "Missing required fields: userEmail, url, and targetPrice are mandatory"
        };
    }

    // Validate target price is a positive number >= 1
    const parsedTargetPrice = parseFloat(targetPrice);
    if (isNaN(parsedTargetPrice) || parsedTargetPrice < 1) {
        return {
            isValid: false,
            error: "Target price must be at least ₹1"
        };
    }

    // Validate target price is less than or equal to current price
    const parsedCurrentPrice = parseFloat(currentPrice);
    if (!isNaN(parsedCurrentPrice) && parsedTargetPrice > parsedCurrentPrice) {
        return {
            isValid: false,
            error: "Target price must be less than or equal to current price"
        };
    }

    return {
        isValid: true,
        parsedTargetPrice,
        parsedCurrentPrice
    };
};

module.exports = { validateTrackingInput };
