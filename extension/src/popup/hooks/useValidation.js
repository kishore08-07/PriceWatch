import { useState, useCallback } from 'react';
import { validateTargetPrice } from '../../shared/utils/validators';

export const useValidation = (currentPrice) => {
    const [targetPrice, setTargetPrice] = useState('');
    const [validationError, setValidationError] = useState('');
    const [isInputFocused, setIsInputFocused] = useState(false);

    const handleTargetPriceChange = useCallback((e) => {
        const value = e.target.value;
        setTargetPrice(value);
        
        const validation = validateTargetPrice(value, currentPrice);
        setValidationError(validation.error);
    }, [currentPrice]);

    const isValid = useCallback(() => {
        if (!targetPrice) return false;
        const validation = validateTargetPrice(targetPrice, currentPrice);
        return validation.isValid;
    }, [targetPrice, currentPrice]);

    return {
        targetPrice,
        setTargetPrice,
        validationError,
        isInputFocused,
        setIsInputFocused,
        handleTargetPriceChange,
        isValid
    };
};
