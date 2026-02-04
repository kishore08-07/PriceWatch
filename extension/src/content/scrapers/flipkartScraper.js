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

// Helper: fallback to scan for price
function findPriceFallback() {
    // 1. Try the product detail price selector (._30jeq3 or ._16Jk6d inside #container)
    const container = document.querySelector('#container');
    if (container) {
        // Try ._30jeq3._16Jk6d (current price)
        let priceEl = container.querySelector('._30jeq3._16Jk6d');
        if (priceEl && priceEl.innerText && priceEl.innerText.includes('₹')) {
            const price = trimPrice(priceEl.innerText);
            if (price && price > 10) return priceEl.innerText.trim();
        }
        // Try ._30jeq3 (sometimes only this class)
        priceEl = container.querySelector('._30jeq3');
        if (priceEl && priceEl.innerText && priceEl.innerText.includes('₹')) {
            const price = trimPrice(priceEl.innerText);
            if (price && price > 10) return priceEl.innerText.trim();
        }
    }

    // 2. Try the exact class pattern from listing: div[class*='1psv1ze']
    const priceDiv = document.querySelector("div[class*='1psv1ze']");
    if (priceDiv && priceDiv.innerText && priceDiv.innerText.includes('₹')) {
        const price = trimPrice(priceDiv.innerText);
        if (price && price > 10) return priceDiv.innerText.trim();
    }

    // 3. Try visible price elements with ₹ and not strikethrough/discount
    const priceCandidates = [];
    const elements = Array.from(document.querySelectorAll('*'));
    for (const el of elements) {
        if (el.children.length === 0 && el.offsetParent !== null) { // visible only
            const text = el.innerText && el.innerText.trim();
            if (text && text.includes('₹') && text.length < 20) {
                // Exclude strikethrough (original price) and discount/offer
                const style = window.getComputedStyle(el);
                if (style.textDecoration.includes('line-through')) continue;
                if (/off|save|discount|%|\bMRP\b|\bList\b|\bDeal\b/i.test(text)) continue;
                const price = trimPrice(text);
                if (price && price > 10) priceCandidates.push({price, text, el});
            }
        }
    }
    // Pick the lowest visible price (usually the current price)
    if (priceCandidates.length > 0) {
        priceCandidates.sort((a, b) => a.price - b.price);
        return priceCandidates[0].text;
    }
    // 4. Try meta og:price:amount
    const meta = document.querySelector('meta[property="product:price:amount"]');
    if (meta && meta.content) return meta.content;
    // 5. Try aria-labels
    for (const el of elements) {
        const label = el.getAttribute && el.getAttribute('aria-label');
        if (label && label.includes('₹')) {
            const price = trimPrice(label);
            if (price && price > 10) return label;
        }
    }
    return null;
}

export const scrapeFlipkart = () => {
    const { containers, name: nameSelectors, price: priceSelectors, unavailabilityKeywords, image: imageSelectors } = FLIPKART_SELECTORS;

    // Try selectors first
    let name = getScopedElement(containers, nameSelectors, 'name');
    if (!name) name = findProductNameFallback();

    let priceText = getScopedElement(containers, priceSelectors, 'price', true);
    if (!priceText || trimPrice(priceText) < 10) priceText = findPriceFallback();

    // Check availability
    let available = true;
    const bodyText = document.body.innerText.toLowerCase();
    for (const keyword of unavailabilityKeywords) {
        if (bodyText.includes(keyword)) {
            const unavailabilityElements = document.querySelectorAll('div, span');
            for (const el of unavailabilityElements) {
                const text = el.innerText.toLowerCase();
                if (text.includes(keyword) && text.length < 100) {
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
