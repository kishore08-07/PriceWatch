export const validateTargetPrice = (value, currentPrice) => {
    if (!value || value.trim() === '') {
        return { isValid: false, error: '' };
    }

    const parsedValue = parseFloat(value);

    if (isNaN(parsedValue)) {
        return { isValid: false, error: 'Please enter a valid number' };
    }

    if (parsedValue <= 0) {
        return { isValid: false, error: 'Price must be greater than ₹0' };
    }

    if (currentPrice && parsedValue > currentPrice) {
        return { isValid: false, error: `Must be ≤ current price (₹${currentPrice})` };
    }

    return { isValid: true, error: '' };
};
