const extractPriceFromHtml = (html) => {
    // Remove cashback/offer sections to avoid false positives
    const cleanedHtml = html
        .replace(/cashback[^₹]*₹[\s]*[0-9,]+(?:\.[0-9]{2})?/gi, '') // Remove "cashback ₹XX"
        .replace(/upto\s+₹[\s]*[0-9,]+(?:\.[0-9]{2})?[^₹]*cashback/gi, '') // Remove "Upto ₹XX cashback"
        .replace(/save\s+₹[\s]*[0-9,]+(?:\.[0-9]{2})?/gi, '') // Remove "save ₹XX"
        .replace(/get\s+₹[\s]*[0-9,]+(?:\.[0-9]{2})?[^₹]*off/gi, '') // Remove "get ₹XX off"
        .replace(/extra\s+₹[\s]*[0-9,]+(?:\.[0-9]{2})?[^₹]*off/gi, '') // Remove "extra ₹XX off"
        .replace(/-[0-9]+%/g, ''); // Remove "-70%" type discount percentages
    
    // Multiple extraction strategies for different platforms
    const pricePatterns = [
        // Amazon patterns (enhanced)
        /"priceAmount"[\s]*:[\s]*([0-9,]+(?:\.[0-9]{2})?)/g,
        /"price"[\s]*:[\s]*"?([0-9,]+(?:\.[0-9]{2})?)"?/g,
        /priceToPay[\s]*:[\s]*([0-9,]+(?:\.[0-9]{2})?)/g,
        /"apexPriceToPay"[\s]*:.*?"displayPrice"[\s]*:[\s]*"₹([0-9,]+)"/g,
        /"buyingPrice"[\s]*:[\s]*([0-9,]+(?:\.[0-9]{2})?)/g,
        /"listPrice"[\s]*:[\s]*([0-9,]+(?:\.[0-9]{2})?)/g,
        /data-a-color="price"[^>]*>₹([0-9,]+)/g,
        /class="a-price-whole"[^>]*>([0-9,]+)/g,
        /id="priceblock_ourprice"[^>]*>₹([0-9,]+)/g,
        /id="priceblock_dealprice"[^>]*>₹([0-9,]+)/g,
        
        // Flipkart patterns
        /"price_range"[\s]*:.*?"min_price"[\s]*:[\s]*([0-9,]+)/g,
        /"offerPrice"[\s]*:[\s]*([0-9,]+(?:\.[0-9]{2})?)/g,
        /"sellingPrice"[\s]*:[\s]*([0-9,]+(?:\.[0-9]{2})?)/g,
        
        // Reliance Digital patterns (most specific first)
        /"offerPrice"[\s]*:[\s]*([0-9,]+(?:\.[0-9]{2})?)/g,
        /"dealPrice"[\s]*:[\s]*([0-9,]+(?:\.[0-9]{2})?)/g,
        
        // Generic patterns (prices with rupee symbol)
        /₹[\s]*([0-9,]+(?:\.[0-9]{2})?)/g,
        
        // Generic patterns
        /"amount"[\s]*:[\s]*([0-9,]+(?:\.[0-9]{2})?)/g,
        /₹<\/span>[\s]*<span[^>]*>([0-9,]+)/g,
        /<span[^>]*class="[^"]*price[^"]*"[^>]*>₹?[\s]*([0-9,]+)/gi,
        
        // Structured data (JSON-LD)
        /"@type"[\s]*:[\s]*"Product".*?"price"[\s]*:[\s]*"?([0-9,]+(?:\.[0-9]{2})?)"?/gs,
        /"offers"[\s]*:.*?"price"[\s]*:[\s]*"?([0-9,]+(?:\.[0-9]{2})?)"?/gs
    ];

    const foundPrices = [];

    for (const pattern of pricePatterns) {
        // Use matchAll for global patterns
        const matches = cleanedHtml.matchAll(pattern);
        for (const match of matches) {
            if (match && match[1]) {
                const priceValue = parseFloat(match[1].replace(/,/g, ''));
                // Filter out invalid prices
                // Minimum ₹100 to avoid cashback amounts, discount percentages, and other small numbers
                // Maximum ₹10M to avoid invalid data
                if (!isNaN(priceValue) && priceValue >= 100 && priceValue < 10000000) {
                    foundPrices.push(priceValue);
                }
            }
        }
    }

    if (foundPrices.length === 0) {
        return null;
    }

    // Remove duplicates and sort
    const uniquePrices = [...new Set(foundPrices)].sort((a, b) => a - b);
    
    // Filter out outliers (MRP is usually much higher)
    // If we have multiple prices, take the lowest reasonable one
    if (uniquePrices.length > 1) {
        // Remove prices that are more than 2x the lowest price (likely MRP)
        const lowestPrice = uniquePrices[0];
        const reasonablePrices = uniquePrices.filter(p => p <= lowestPrice * 2);
        
        if (reasonablePrices.length > 0) {
            return Math.floor(reasonablePrices[0]);
        }
    }
    
    return Math.floor(uniquePrices[0]);
};

module.exports = { extractPriceFromHtml };
