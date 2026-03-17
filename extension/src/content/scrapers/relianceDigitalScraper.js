import { getScopedElement, trimPrice } from '../utils/priceParser';
import { extractImage } from '../utils/imageExtractor';
import { RELIANCE_SELECTORS } from '../selectors/relianceSelectors';

/**
 * Extract brand and model from Reliance Digital product page.
 */
export const extractRelianceBrandModel = () => {
    let brand = '';
    let model = '';

    // Try specification table rows
    const specRows = document.querySelectorAll('.sp__specContent tr, .specification-table tr, [class*="spec"] tr, .pdp__keySpec li');
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

    // Breadcrumb fallback for brand
    if (!brand) {
        const breadcrumbs = document.querySelectorAll('.breadcrumb a, nav a');
        for (const bc of breadcrumbs) {
            const text = bc.innerText.trim();
            // Often the 2nd-to-last breadcrumb is the brand
            if (text.length > 1 && text.length < 30 && !/home|search|all/i.test(text)) {
                brand = text;
            }
        }
    }

    return { brand, model };
};

export const scrapeRelianceDigital = () => {
    const { containers, name: nameSelectors, price: priceSelectors, unavailabilityKeywords, image: imageSelectors } = RELIANCE_SELECTORS;

    const name = getScopedElement(containers, nameSelectors, 'name');
    const priceText = getScopedElement(containers, priceSelectors, 'price', true);

    // Check availability
    let available = true;
    const bodyText = document.body.innerText.toLowerCase();
    for (const keyword of unavailabilityKeywords) {
        if (bodyText.includes(keyword)) {
            available = false;
            break;
        }
    }

    const image = extractImage(imageSelectors);

    return {
        name,
        price: available ? trimPrice(priceText) : null,
        platform: 'Reliance Digital',
        image,
        currency: '₹',
        available
    };
};

export const scrapeRelianceDigitalExtended = () => {
    const base = scrapeRelianceDigital();
    const { brand, model } = extractRelianceBrandModel();
    return { ...base, brand, model };
};

