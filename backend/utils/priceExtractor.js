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
    // CRITICAL: Order matters - most reliable patterns FIRST
    const pricePatterns = [
        // Amazon - Most reliable patterns first (visible DOM prices)
        /"apexPriceToPay"[\s]*:.*?"displayPrice"[\s]*:[\s]*"₹([0-9,]+)"/g,  // Primary Amazon price
        /class="a-price-whole"[^>]*>([0-9,]+)<\/span>/g,  // Visible price element
        /id="priceblock_ourprice"[^>]*>₹[\s]*([0-9,]+)/g,
        /id="priceblock_dealprice"[^>]*>₹[\s]*([0-9,]+)/g,
        /"priceToPay"[\s]*:[\s]*([0-9,]+(?:\.[0-9]{2})?)/g,
        /"priceAmount"[\s]*:[\s]*([0-9,]+(?:\.[0-9]{2})?)/g,
        
        // Flipkart - Visible DOM patterns only
        /"sellingPrice"[\s]*:[\s]*([0-9,]+(?:\.[0-9]{2})?)/g,
        /"offerPrice"[\s]*:[\s]*([0-9,]+(?:\.[0-9]{2})?)/g,
        
        // Reliance Digital patterns
        /"dealPrice"[\s]*:[\s]*([0-9,]+(?:\.[0-9]{2})?)/g,
        
        // Structured data - JSON-LD (more reliable than meta)
        /"@type"[\s]*:[\s]*"Product".*?"offers"[\s]*:.*?"price"[\s]*:[\s]*"?([0-9,]+(?:\.[0-9]{2})?)"?/gs,
        
        // Generic fallbacks (use with caution)
        /data-a-color="price"[^>]*>₹([0-9,]+)/g,
        /<span[^>]*class="[^"]*a-price-whole[^"]*"[^>]*>([0-9,]+)/gi
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

    // Remove duplicates
    const uniquePrices = [...new Set(foundPrices)];
    
    // CRITICAL FIX: Don't blindly pick lowest price
    // Instead, use frequency-based selection - the price that appears most often
    // is likely the real current price (appears in multiple DOM locations)
    const priceFrequency = {};
    foundPrices.forEach(price => {
        priceFrequency[price] = (priceFrequency[price] || 0) + 1;
    });
    
    // Sort by frequency (most common first), then by value (higher first for same frequency)
    const sortedByFrequency = uniquePrices.sort((a, b) => {
        const freqDiff = priceFrequency[b] - priceFrequency[a];
        if (freqDiff !== 0) return freqDiff;
        // If same frequency, prefer higher price (current price usually > offers/cashback)
        return b - a;
    });
    
    // Return the most frequently occurring price
    return Math.floor(sortedByFrequency[0]);
};

module.exports = { extractPriceFromHtml };
