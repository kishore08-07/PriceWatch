import { getScopedElement, trimPrice } from '../utils/priceParser';
import { extractImage } from '../utils/imageExtractor';
import { RELIANCE_SELECTORS } from '../selectors/relianceSelectors';

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
