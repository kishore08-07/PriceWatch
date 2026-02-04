console.log("[PriceWatch] Content script v3.0 (Enhanced Image Extraction) injected.");

const trimPrice = (str) => {
    if (!str) return null;
    const match = str.replace(/,/g, '').match(/[0-9.]+/);
    if (!match) return null;
    const value = parseFloat(match[0]);
    return isNaN(value) ? null : Math.floor(value);
};

// Heuristic fallback to find the price anywhere in the page/container
const findPriceByHeuristic = (container = document) => {
    const elements = Array.from(container.querySelectorAll('*'));
    for (const el of elements) {
        if (el.children.length === 0) {
            const text = el.innerText.trim();
            if (text.startsWith('₹') && text.length > 1 && text.length < 20) {
                const price = trimPrice(text);
                if (price && price > 100) return text;
            }
        }
        const label = el.getAttribute('aria-label');
        if (label && label.startsWith('₹') && label.length < 20) {
            const price = trimPrice(label);
            if (price && price > 100) return label;
        }
    }
    return null;
};

const getScopedElement = (containerSelectors, elementSelectors, fieldName, isPrice = false) => {
    for (const cSelector of containerSelectors) {
        const container = document.querySelector(cSelector);
        if (container) {
            for (const eSelector of elementSelectors) {
                const el = container.querySelector(eSelector);
                if (el) {
                    const text = el.innerText.trim();
                    if (text) return text;
                    const label = el.getAttribute('aria-label');
                    if (label && label.includes('₹')) return label;
                }
            }
            if (isPrice) {
                const heuristicPrice = findPriceByHeuristic(container);
                if (heuristicPrice) return heuristicPrice;
            }
        }
    }
    for (const eSelector of elementSelectors) {
        const el = document.querySelector(eSelector);
        if (el) {
            const text = el.innerText.trim();
            if (text) return text;
            const label = el.getAttribute('aria-label');
            if (label && label.includes('₹')) return label;
        }
    }
    if (isPrice) {
        const heuristicPrice = findPriceByHeuristic();
        if (heuristicPrice) return heuristicPrice;
    }
    return null;
};

const scrapers = {
    amazon: () => {
        const containers = ['#ppd', '#centerCol', '#rightCol', '#dp-container'];
        const nameSelectors = ['#productTitle', '#title', '.qa-title-text'];
        const priceSelectors = ['.a-price-whole', '#priceblock_ourprice', '#priceblock_dealprice', '.a-price.a-text-price.a-size-medium .a-offscreen', '.apexPriceToPay .a-offscreen'];

        // Check if product is available
        let available = true;
        const unavailabilitySelectors = [
            '#availability .a-color-price',
            '#availability .a-color-state',
            '#availability span'
        ];
        
        for (const selector of unavailabilitySelectors) {
            const element = document.querySelector(selector);
            if (element) {
                const text = element.innerText.toLowerCase();
                if (text.includes('unavailable') || 
                    text.includes('out of stock') || 
                    text.includes('currently unavailable') ||
                    text.includes('not available')) {
                    available = false;
                    break;
                }
            }
        }

        // Try multiple image selectors for Amazon
        let image = null;
        const imageSelectors = [
            '#landingImage',
            '#imgBlkFront',
            '#main-image',
            '#imgTagWrapperId img',
            '#altImages + div img',
            '.imgTagWrapper img',
            'img[data-old-hires]',
            'img.a-dynamic-image'
        ];

        for (const selector of imageSelectors) {
            const imgEl = document.querySelector(selector);
            if (imgEl?.src && !imgEl.src.includes('transparent-pixel')) {
                image = imgEl.src;
                break;
            }
        }

        const name = getScopedElement(containers, nameSelectors, 'name');
        const priceText = getScopedElement(containers, priceSelectors, 'price', true);
        return { name, price: available ? trimPrice(priceText) : null, platform: 'Amazon', image, currency: '₹', available };
    },
    flipkart: () => {
        const containers = ['.WsoCM9', '.dyCpxm', '._2c2S6L', '#container'];
        const nameSelectors = ['h1.CEn5rD span', 'h1.CEn5rD', 'h1.VU-Z7G', '.B_NuCI', 'h1 span'];
        const priceSelectors = ['.Nx9SaT', '._25b18c ._30jeq3', '._30jeq3._16Jk6d', '._30jeq3', 'div[class*="price"]'];
        const name = getScopedElement(containers, nameSelectors, 'name');
        const priceText = getScopedElement(containers, priceSelectors, 'price', true);

        // Check if product is available
        let available = true;
        const bodyText = document.body.innerText.toLowerCase();
        if (bodyText.includes('currently unavailable') || 
            bodyText.includes('out of stock') || 
            bodyText.includes('sold out')) {
            const unavailabilityElements = document.querySelectorAll('div, span');
            for (const el of unavailabilityElements) {
                const text = el.innerText.toLowerCase();
                if ((text.includes('unavailable') || text.includes('out of stock') || text.includes('sold out')) && text.length < 100) {
                    available = false;
                    break;
                }
            }
        }

        // Try multiple image selectors for Flipkart
        let image = null;
        const imageSelectors = [
            'img.DByuf4[src*="rukminim"]',  // Main product image (current structure)
            'img[class*="UC"][src*="rukminim"]',  // Alternative class pattern
            'img[src*="flipkart.com/image/"]',
            '._396cs4 img',
            '._2r_T1_ img',
            '._1AtV9z img',
            '.CXW8mj img',  // Image container
            'div[class*="image"] img[src*="rukminim"]',  // Generic image container
            'img[loading="eager"][src*="rukminim"]'  // Eager-loaded main image
        ];

        for (const selector of imageSelectors) {
            const imgEl = document.querySelector(selector);
            if (imgEl?.src) {
                image = imgEl.src;
                break;
            }
        }

        return { name, price: available ? trimPrice(priceText) : null, platform: 'Flipkart', image, currency: '₹', available };
    },
    reliancedigital: () => {
        const containers = ['.product-right-container', '.product-description-container', '.pdp-main-product', 'main'];
        const nameSelectors = [
            'h1.product-name',  // Verified selector
            'h1#main-content',  // Verified ID
            '.header-container h1',
            'h1[tabindex="0"]',
            '.pdp__title',
            '#pdp_product_title',
            'h1'
        ];
        const priceSelectors = [
            '.add-to-card-container__product-price',  // Verified selector
            'div.product-price',
            '.pdp__offerPrice',
            '.pdp__priceSection__price',
            '#pdp_price',
            '.price',
            'div[class*="price"]'
        ];
        const name = getScopedElement(containers, nameSelectors, 'name');
        const priceText = getScopedElement(containers, priceSelectors, 'price', true);

        // Check if product is available
        let available = true;
        const bodyText = document.body.innerText.toLowerCase();
        if (bodyText.includes('out of stock') || 
            bodyText.includes('currently unavailable') || 
            bodyText.includes('not available')) {
            available = false;
        }

        // Try multiple image selectors for Reliance Digital
        let image = null;
        const imageSelectors = [
            'img.pdp-image',  // Verified - main product image
            '.image-item img',  // Alternative container
            '.load-image img',
            'img[data-v-597ac81e]',  // Vue component image
            'img[src*="cdn.jiostore.online"]',  // CDN pattern
            'img[src*="cdn.pixelpinch"]',
            '#pdp_main_image',
            '.pdp__mainImage',
            'img[src*="reliancedigital"]',
            '.product-image img',
            '.main-image img',
            'img[alt*="product"]',
            'div[class*="image"] img'
        ];

        for (const selector of imageSelectors) {
            const imgEl = document.querySelector(selector);
            if (imgEl?.src && !imgEl.src.includes('data:image') && imgEl.width > 50) {
                image = imgEl.src;
                break;
            }
        }

        return { name, price: available ? trimPrice(priceText) : null, platform: 'Reliance Digital', image, currency: '₹', available };
    }
};

function getProductData() {
    const url = window.location.href;
    let data = null;
    if (url.includes('amazon.')) data = scrapers.amazon();
    else if (url.includes('flipkart.com')) data = scrapers.flipkart();
    else if (url.includes('reliancedigital.in')) data = scrapers.reliancedigital();

    if (data) {
        data.url = url; // CRITICAL: Add the URL here
    }
    return data;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_PRODUCT_DETAILS') {
        const data = getProductData();
        sendResponse(data);
    }
    return true;
});
