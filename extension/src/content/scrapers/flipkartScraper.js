import { getScopedElement, trimPrice } from '../utils/priceParser';
import { extractImage } from '../utils/imageExtractor';
import { FLIPKART_SELECTORS } from '../selectors/flipkartSelectors';

/**
 * Extract brand and model from Flipkart product page.
 */
export const extractFlipkartBrandModel = () => {
    let brand = '';
    let model = '';

    // Try specification table (Flipkart uses various class patterns)
    const specRows = document.querySelectorAll('table._14cfVK tr, ._3k-BhJ tr, [class*="spec"] tr, ._1UhVsV tr');
    for (const row of specRows) {
        const text = row.innerText || '';
        if (/brand/i.test(text) && !brand) {
            const parts = text.split(/\n|:/).map(s => s.trim()).filter(Boolean);
            brand = parts[parts.length - 1] || '';
        }
        if (/model\s*(number|name)?/i.test(text) && !model) {
            const parts = text.split(/\n|:/).map(s => s.trim()).filter(Boolean);
            model = parts[parts.length - 1] || '';
        }
    }

    // Breadcrumb for brand (Flipkart breadcrumbs often include brand)
    if (!brand) {
        const breadcrumbs = document.querySelectorAll('._1MR4o5 a, ._2whKao a, [class*="breadcrumb"] a');
        const bcTexts = Array.from(breadcrumbs).map(a => a.innerText.trim());
        // Brand is often the 3rd or 4th breadcrumb
        for (const text of bcTexts) {
            if (text.length > 1 && text.length < 30 && !/home|flipkart|all/i.test(text)) {
                brand = text;
            }
        }
    }

    // Meta tag fallback
    if (!brand) {
        const metaBrand = document.querySelector('meta[property="og:brand"], meta[name="brand"]');
        if (metaBrand) brand = metaBrand.content || '';
    }

    return { brand, model };
};


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
        '.Nx9bqj.CxhGGd',      // New Flipkart PDP current-price class
        '.Nx9bqj',             // New generic class fallback
        '[data-testid*="final-price"]',
        '[data-testid*="price"] [class*="Nx9"]',
        '._30jeq3._16Jk6d',  // Common product page price
        '._30jeq3',           // Alternative class
    ];

    for (const selector of knownSelectors) {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null) { // Must be visible
            const text = el.innerText && el.innerText.trim();
            if (text && text.includes('₹')) {
                const price = trimPrice(text);
                // Reject obviously invalid tiny values, but allow valid sub-1000 prices (e.g. ₹899)
                if (price && price >= 50) {
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
            if (price && price >= 50) {
                return text;
            }
        }
    }

    // Strategy 3: Scan visible <div>/<span> leaves and score candidates.
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

        // Exclude discount/offer text-only entries
        if (/off|save|discount|%|\bMRP\b|\blist price\b|\bdeal\b/i.test(text) && !/^\s*₹\s*[\d,]+(?:\.\d+)?\s*$/.test(text)) continue;

        const price = trimPrice(text);

        // Guard: reject obviously invalid tiny values
        if (!price || price < 50) continue;

        // Score candidate likelihood for "current selling price"
        const className = (el.className || '').toString();
        const parentClass = (el.parentElement?.className || '').toString();
        const rect = el.getBoundingClientRect();
        const fontSize = parseFloat(style.fontSize);
        let score = 0;

        // Prefer known current-price class patterns
        if (/Nx9bqj|_30jeq3|_16Jk6d/i.test(className)) score += 5;
        if (/Nx9bqj|_30jeq3|_16Jk6d/i.test(parentClass)) score += 3;

        // Prefer visually prominent text
        if (!isNaN(fontSize)) score += Math.min(6, fontSize / 4);
        if (style.fontWeight && parseInt(style.fontWeight, 10) >= 500) score += 2;

        // Prefer content near main product section (top portion)
        if (rect.top >= 0 && rect.top < window.innerHeight * 0.8) score += 2;

        // Prefer price nodes near buy/add-to-cart controls
        const isNearCta = el.closest('div, section')?.innerText?.match(/add to cart|buy now|buy at/i);
        if (isNearCta) score += 2;

        priceCandidates.push({
            price,
            text,
            fontSize: isNaN(fontSize) ? 0 : fontSize,
            score,
            el
        });
    }

    if (priceCandidates.length === 0) {
        return null; // No valid price found
    }

    // Pick the highest-scoring candidate; tie-break on larger font and lower price
    // (lower usually represents discounted current price vs MRP on Flipkart PDP).
    priceCandidates.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.fontSize !== a.fontSize) return b.fontSize - a.fontSize;
        return a.price - b.price;
    });

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

export const scrapeFlipkartExtended = () => {
    const base = scrapeFlipkart();
    const { brand, model } = extractFlipkartBrandModel();
    return { ...base, brand, model };
};

