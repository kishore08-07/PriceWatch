import { getScopedElement, trimPrice } from '../utils/priceParser';
import { extractImage } from '../utils/imageExtractor';
import { FLIPKART_SELECTORS } from '../selectors/flipkartSelectors';


// Helper: fallback to scan for product name
function findProductNameFallback() {
    // Try any h1 with text
    const h1 = document.querySelector('h1');
    if (h1 && h1.innerText.trim().length > 2) return h1.innerText.trim();
    // Try meta og:title
    const meta = document.querySelector('meta[property="og:title"]');
    if (meta && meta.content) return meta.content;
    // Try title tag
    if (document.title) return document.title.split('|')[0].trim();
    return null;
}

/**
 * Extracts Flipkart price from VISIBLE DOM only (never meta/schema/hidden nodes)
 * Resilient to DOM/class changes with multi-level fallback strategy
 */
function getFlipkartPrice() {
    // Strategy 1: Try known visible price classes
    const knownSelectors = [
        '._30jeq3._16Jk6d',  // Common product page price
        '._30jeq3',           // Alternative class
    ];
    
    for (const selector of knownSelectors) {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null) { // Must be visible
            const text = el.innerText && el.innerText.trim();
            if (text && text.includes('₹')) {
                const price = trimPrice(text);
                // Reject values with < 4 digits (like 183)
                if (price && price >= 1000) {
                    return text;
                }
            }
        }
    }
    
    // Strategy 2: Try observed React container pattern
    const reactContainer = document.querySelector("div.vzwn2j[class*='1psv1ze']");
    if (reactContainer && reactContainer.offsetParent !== null) {
        const text = reactContainer.innerText && reactContainer.innerText.trim();
        if (text && text.includes('₹')) {
            const price = trimPrice(text);
            if (price && price >= 1000) {
                return text;
            }
        }
    }
    
    // Strategy 3: Scan all visible <div> and <span> elements
    const priceCandidates = [];
    const elements = document.querySelectorAll('div, span');
    
    for (const el of elements) {
        // Skip if element has children (we want leaf text nodes)
        if (el.children.length > 0) continue;
        
        // Must be visible to user
        if (el.offsetParent === null) continue;
        
        // Skip hidden containers (meta, script, style, etc.)
        const tagName = el.tagName.toLowerCase();
        if (['meta', 'script', 'style', 'link', 'noscript'].includes(tagName)) continue;
        
        const text = el.innerText && el.innerText.trim();
        if (!text || !text.includes('₹')) continue;
        
        // Text should be reasonably short (not a paragraph)
        if (text.length > 30) continue;
        
        // Exclude strikethrough (original/MRP price)
        const style = window.getComputedStyle(el);
        if (style.textDecoration.includes('line-through')) continue;
        
        // Exclude discount/offer text
        if (/off|save|discount|%|\bMRP\b|\blist price\b|\bdeal\b/i.test(text)) continue;
        
        const price = trimPrice(text);
        
        // Guard: reject values with < 4 digits
        if (!price || price < 1000) continue;
        
        // Get font size for comparison (real price is usually largest)
        const fontSize = parseFloat(style.fontSize);
        
        priceCandidates.push({
            price,
            text,
            fontSize: isNaN(fontSize) ? 0 : fontSize,
            el
        });
    }
    
    if (priceCandidates.length === 0) {
        return null; // No valid price found
    }
    
    // Pick the element with largest font-size (current price is visually prominent)
    priceCandidates.sort((a, b) => b.fontSize - a.fontSize);
    
    return priceCandidates[0].text;
}

export const scrapeFlipkart = () => {
    const { containers, name: nameSelectors, price: priceSelectors, unavailabilityKeywords, image: imageSelectors } = FLIPKART_SELECTORS;

    // Try selectors first
    let name = getScopedElement(containers, nameSelectors, 'name');
    if (!name) name = findProductNameFallback();

    // Use Flipkart-specific visible DOM extraction
    let priceText = getFlipkartPrice();

    // Check availability - if we found a valid price, product is available
    // Price presence indicates the selected variant is in stock
    let available = true;
    
    if (!priceText || trimPrice(priceText) === null) {
        // Only check unavailability if no price was found
        // Look for prominent unavailability messages (large text, near top of page)
        const unavailabilityElements = document.querySelectorAll('div, span, p');
        for (const el of unavailabilityElements) {
            // Only check visible, prominent elements (large font, high up on page)
            if (el.offsetParent === null) continue;
            
            const text = el.innerText && el.innerText.toLowerCase().trim();
            if (!text || text.length > 150) continue; // Skip long paragraphs
            
            // Check if it's a prominent message (font size > 14px)
            const style = window.getComputedStyle(el);
            const fontSize = parseFloat(style.fontSize);
            if (fontSize < 14) continue;
            
            // Check for unavailability keywords in prominent locations
            for (const keyword of unavailabilityKeywords) {
                if (text.includes(keyword)) {
                    // Make sure it's not inside variant selector or review text
                    const upperText = el.innerText.toUpperCase();
                    if (upperText.includes('VARIANT') || upperText.includes('REVIEW')) continue;
                    
                    available = false;
                    break;
                }
            }
            if (!available) break;
        }
    }

    const image = extractImage(imageSelectors);

    return {
        name,
        price: available ? trimPrice(priceText) : null,
        platform: 'Flipkart',
        image,
        currency: '\u20b9',
        available
    };
};
