import { getScopedElement, trimPrice } from '../utils/priceParser';
import { extractImage } from '../utils/imageExtractor';
import { checkAvailability } from '../utils/availabilityChecker';
import { AMAZON_SELECTORS } from '../selectors/amazonSelectors';

/**
 * Extract brand and model from Amazon product page.
 */
export const extractAmazonBrandModel = () => {
    let brand = '';
    let model = '';

    // Brand — try byline first, then details table
    const byline = document.querySelector('#bylineInfo');
    if (byline) {
        const text = byline.innerText.replace(/Visit the|Brand:|Store/gi, '').trim();
        brand = text.replace(/\s+Store$/, '').trim();
    }

    // Product details table
    const detailRows = document.querySelectorAll('#productDetails_techSpec_section_1 tr, #detailBullets_feature_div li, #prodDetails tr, .po-brand .po-break-word');
    for (const row of detailRows) {
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

    // Fallback: try meta tags
    if (!brand) {
        const metaBrand = document.querySelector('meta[name="brand"], meta[property="product:brand"]');
        if (metaBrand) brand = metaBrand.content || '';
    }

    return { brand, model };
};

export const scrapeAmazon = () => {
    const { containers, name: nameSelectors, price: priceSelectors, unavailability, unavailabilityKeywords, image: imageSelectors } = AMAZON_SELECTORS;

    const available = checkAvailability(unavailability, unavailabilityKeywords);
    const name = getScopedElement(containers, nameSelectors, 'name');
    const priceText = getScopedElement(containers, priceSelectors, 'price', true);
    const image = extractImage(imageSelectors);

    return {
        name,
        price: available ? trimPrice(priceText) : null,
        platform: 'Amazon',
        image,
        currency: '₹',
        available
    };
};

export const scrapeAmazonExtended = () => {
    const base = scrapeAmazon();
    const { brand, model } = extractAmazonBrandModel();
    return { ...base, brand, model };
};

